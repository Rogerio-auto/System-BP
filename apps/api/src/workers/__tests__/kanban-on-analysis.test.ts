// =============================================================================
// kanban-on-analysis.test.ts — Testes do handler F4-S05.
//
// Estratégia: injeção de db mock via parâmetro de handleAnalysisStatusChanged().
//   Não depende de banco real. Todos os efeitos colaterais são mockados.
//
// Chamadas db.select() no handler — ordem determinística:
//   [0] findCardByLeadId
//   [1] resolveTargetStage →
//         aprovado:  findTerminalWonStage (1 select)
//         recusado:  findTerminalLostStage (1 select)
//         em_analise+aprovado/recusado: findAnaliseCreditorStage tentativa 1 (orderIndex=3)
//   [2] aprovado/recusado: findStageById (fromStage)
//       em_analise (tentativa 1 encontrou): findStageById (fromStage)
//       em_analise (tentativa 1 não encontrou): findAnaliseCreditorStage tentativa 2 (fallback)
//   [3] em_analise com fallback: findStageById (fromStage)
//
// Cenários cobertos:
//   1.  to_status='aprovado' → card movido para stage terminal won
//   2.  to_status='recusado' → card movido para stage terminal lost
//   3.  to_status='em_analise' com from_status='aprovado' → card movido para Análise de Crédito
//   4.  to_status='em_analise' com from_status='recusado' → card movido para Análise de Crédito
//   5.  Idempotência: card já no stage destino → no-op (sem insertHistory/emit/auditLog)
//   6.  leads.last_analysis_id atualizado mesmo em no-op de idempotência
//   7.  Payload inválido (lead_id ausente) → skip sem erro
//   8.  Card não encontrado → skip sem erro
//   9.  Stage destino não encontrado na org → skip sem loop de erro
//  10.  Transição não gerenciada (ex: pendente → em_analise) → no-op
//  11.  Stage atual do card não encontrado → skip sem erro
//  12.  Erro em transação propaga para o outbox-publisher registrar falha
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (DEVE ser o primeiro mock)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real)
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm (evita imports pesados + fornece stubs de eq/and/or)
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  or: vi.fn((...args: unknown[]) => ({ __or: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock db/client (singleton — não conecta ao Postgres)
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock emit (outbox) — captura chamadas
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('evt-uuid');
vi.mock('../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Mock auditLog — captura chamadas
// ---------------------------------------------------------------------------
const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Import do handler (após mocks)
// ---------------------------------------------------------------------------
import type { EventOutbox } from '../../db/schema/events.js';
import { handleAnalysisStatusChanged } from '../kanban-on-analysis.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '22222222-2222-2222-2222-222222222222';
const CARD_ID = '33333333-3333-3333-3333-333333333333';
const ANALYSIS_ID = '55555555-5555-5555-5555-555555555555';
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

// Stage IDs
const STAGE_ANALISE_ID = 'bbbb0003-0000-0000-0000-000000000003';
const STAGE_CONCLUIDO_WON_ID = 'cccc0004-0000-0000-0000-000000000004';
const STAGE_CONCLUIDO_LOST_ID = 'dddd0005-0000-0000-0000-000000000005';

const stageAnaliseCreditoBefore = {
  id: STAGE_ANALISE_ID,
  organizationId: ORG_ID,
  name: 'Análise de Crédito',
  orderIndex: 3,
  color: '#3B82F6',
  isTerminalWon: false,
  isTerminalLost: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const stageConcluídoWon = {
  id: STAGE_CONCLUIDO_WON_ID,
  organizationId: ORG_ID,
  name: 'Concluído',
  orderIndex: 4,
  color: '#22C55E',
  isTerminalWon: true,
  isTerminalLost: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const stageConcluídoLost = {
  id: STAGE_CONCLUIDO_LOST_ID,
  organizationId: ORG_ID,
  name: 'Concluído',
  orderIndex: 4,
  color: '#EF4444',
  isTerminalWon: false,
  isTerminalLost: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const cardInAnalise = {
  id: CARD_ID,
  organizationId: ORG_ID,
  leadId: LEAD_ID,
  stageId: STAGE_ANALISE_ID,
  assigneeUserId: null,
  priority: 0,
  notes: null,
  enteredStageAt: new Date(),
  productId: null,
  lastSimulationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeEvent(
  toStatus: string,
  fromStatus: string,
  overrides: Partial<EventOutbox> = {},
): EventOutbox {
  return {
    id: EVENT_ID,
    organizationId: ORG_ID,
    eventName: 'credit_analysis.status_changed',
    eventVersion: 1,
    aggregateType: 'credit_analysis',
    aggregateId: ANALYSIS_ID,
    payload: {
      analysis_id: ANALYSIS_ID,
      lead_id: LEAD_ID,
      from_status: fromStatus,
      to_status: toStatus,
      version_id: 'vvvv0001-0000-0000-0000-000000000001',
    },
    correlationId: null,
    idempotencyKey: `credit_analysis.status_changed:${ANALYSIS_ID}`,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DB mock builder
// ---------------------------------------------------------------------------

/**
 * Constrói um mock mínimo de Database para injeção em handleAnalysisStatusChanged.
 *
 * selectResponses: array na ordem exata das chamadas db.select() no handler.
 * Use null para simular "não encontrado" (retorna []).
 *
 * Ordem para caminho aprovado/recusado:
 *   [0] findCardByLeadId
 *   [1] findTerminalWonStage | findTerminalLostStage
 *   [2] findStageById (fromStage)
 *
 * Ordem para caminho em_analise (orderIndex encontrado):
 *   [0] findCardByLeadId
 *   [1] findAnaliseCreditorStage (tentativa 1 — orderIndex=3)
 *   [2] findStageById (fromStage)
 *
 * Ordem para caminho em_analise (orderIndex NÃO encontrado, fallback chamado):
 *   [0] findCardByLeadId
 *   [1] findAnaliseCreditorStage tentativa 1 → null
 *   [2] findAnaliseCreditorStage tentativa 2 (fallback)
 *   [3] findStageById (fromStage)
 */
function makeMockDb(selectResponses: (unknown | null)[]): {
  db: unknown;
  insertedHistoryValues: unknown[];
  updatedCardValues: unknown[];
  updatedLeadValues: unknown[];
} {
  const insertedHistoryValues: unknown[] = [];
  const updatedCardValues: unknown[] = [];
  const updatedLeadValues: unknown[] = [];

  let selectCallIndex = 0;

  function makeSelectChain(): { from: () => { where: () => { limit: () => Promise<unknown[]> } } } {
    const callIdx = selectCallIndex++;
    const raw = selectResponses[callIdx];
    const result = raw !== null && raw !== undefined ? [raw] : [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    };
  }

  // leads.update é chamado fora da transação — vai para updatedLeadValues
  const mockUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((vals: unknown) => {
      updatedLeadValues.push(vals);
      return { where: vi.fn().mockResolvedValue([]) };
    }),
  }));

  const txMockInsert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      insertedHistoryValues.push(vals);
      return Promise.resolve([]);
    }),
  }));

  // kanbanCards.update dentro da tx vai para updatedCardValues
  const txMockUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((vals: unknown) => {
      updatedCardValues.push(vals);
      return { where: vi.fn().mockResolvedValue([]) };
    }),
  }));

  const txMock = {
    insert: txMockInsert,
    update: txMockUpdate,
    // txMock.select não é chamado no handler — todas as selects ocorrem antes da tx
    select: vi.fn().mockImplementation(() => makeSelectChain()),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    update: mockUpdate,
    insert: vi.fn(),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(txMock);
    }),
  };

  return { db: mockDb, insertedHistoryValues, updatedCardValues, updatedLeadValues };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleAnalysisStatusChanged', () => {
  beforeEach(() => {
    mockEmit.mockClear();
    mockAuditLog.mockClear();
  });

  // -------------------------------------------------------------------------
  // Cenário 1: to_status='aprovado' → move card para stage terminal won
  // -------------------------------------------------------------------------
  it('move card para stage terminal won quando to_status=aprovado', async () => {
    // selectResponses[0]=card, [1]=terminalWon, [2]=fromStage(analise)
    const { db, insertedHistoryValues, updatedCardValues, updatedLeadValues } = makeMockDb([
      cardInAnalise,
      stageConcluídoWon,
      stageAnaliseCreditoBefore,
    ]);

    await handleAnalysisStatusChanged(db as never, makeEvent('aprovado', 'em_analise'));

    // leads.last_analysis_id atualizado
    expect(updatedLeadValues).toHaveLength(1);
    const leadUpdate = updatedLeadValues[0] as Record<string, unknown>;
    expect(leadUpdate['lastAnalysisId']).toBe(ANALYSIS_ID);

    // insertHistory chamado 1x com actorUserId null (sistema)
    expect(insertedHistoryValues).toHaveLength(1);
    const histEntry = insertedHistoryValues[0] as Record<string, unknown>;
    expect(histEntry['cardId']).toBe(CARD_ID);
    expect(histEntry['fromStageId']).toBe(STAGE_ANALISE_ID);
    expect(histEntry['toStageId']).toBe(STAGE_CONCLUIDO_WON_ID);
    expect(histEntry['actorUserId']).toBeNull();
    const meta = histEntry['metadata'] as Record<string, unknown>;
    expect(meta['source']).toBe('worker:kanban-on-analysis');
    expect(meta['toStatus']).toBe('aprovado');
    expect(meta['reason']).toBe('analysis_approved');

    // kanbanCards atualizado para stage terminal won
    expect(updatedCardValues).toHaveLength(1);
    const cardUpdate = updatedCardValues[0] as Record<string, unknown>;
    expect(cardUpdate['stageId']).toBe(STAGE_CONCLUIDO_WON_ID);
    expect(cardUpdate['enteredStageAt']).toBeInstanceOf(Date);

    // emit chamado 1x com reason correto
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArgs = mockEmit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(emitArgs['eventName']).toBe('kanban.stage_updated');
    const emitData = emitArgs['data'] as Record<string, unknown>;
    expect(emitData['card_id']).toBe(CARD_ID);
    expect(emitData['to_status']).toBe('won');
    expect(emitData['reason']).toBe('analysis_approved');

    // auditLog chamado 1x com actor = null (sistema)
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const auditArgs = mockAuditLog.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditArgs['actor']).toBeNull();
    expect(auditArgs['action']).toBe('kanban.stage_updated');
    expect(auditArgs['correlationId']).toBe(EVENT_ID);
  });

  // -------------------------------------------------------------------------
  // Cenário 2: to_status='recusado' → move card para stage terminal lost
  // -------------------------------------------------------------------------
  it('move card para stage terminal lost quando to_status=recusado', async () => {
    // selectResponses[0]=card, [1]=terminalLost, [2]=fromStage(analise)
    const { db, insertedHistoryValues, updatedCardValues } = makeMockDb([
      cardInAnalise,
      stageConcluídoLost,
      stageAnaliseCreditoBefore,
    ]);

    await handleAnalysisStatusChanged(db as never, makeEvent('recusado', 'em_analise'));

    expect(insertedHistoryValues).toHaveLength(1);
    const histEntry = insertedHistoryValues[0] as Record<string, unknown>;
    expect(histEntry['toStageId']).toBe(STAGE_CONCLUIDO_LOST_ID);
    const meta = histEntry['metadata'] as Record<string, unknown>;
    expect(meta['reason']).toBe('analysis_recusado');

    expect(updatedCardValues).toHaveLength(1);
    const cardUpdate = updatedCardValues[0] as Record<string, unknown>;
    expect(cardUpdate['stageId']).toBe(STAGE_CONCLUIDO_LOST_ID);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitData = (mockEmit.mock.calls[0]?.[1] as Record<string, unknown>)['data'] as Record<
      string,
      unknown
    >;
    expect(emitData['to_status']).toBe('lost');
    expect(emitData['reason']).toBe('analysis_recusado');
  });

  // -------------------------------------------------------------------------
  // Cenário 3: to_status='em_analise' com from_status='aprovado' → reabertura
  // -------------------------------------------------------------------------
  it('move card para Análise de Crédito quando to_status=em_analise e from_status=aprovado', async () => {
    const cardInWon = { ...cardInAnalise, stageId: STAGE_CONCLUIDO_WON_ID };

    // selectResponses[0]=card, [1]=analiseStage(orderIndex=3), [2]=fromStage(won)
    const { db, insertedHistoryValues, updatedCardValues } = makeMockDb([
      cardInWon,
      stageAnaliseCreditoBefore,
      stageConcluídoWon,
    ]);

    await handleAnalysisStatusChanged(db as never, makeEvent('em_analise', 'aprovado'));

    expect(insertedHistoryValues).toHaveLength(1);
    const histEntry = insertedHistoryValues[0] as Record<string, unknown>;
    expect(histEntry['toStageId']).toBe(STAGE_ANALISE_ID);
    const meta = histEntry['metadata'] as Record<string, unknown>;
    expect(meta['reason']).toBe('analysis_review_requested');

    expect(updatedCardValues).toHaveLength(1);
    const cardUpdate = updatedCardValues[0] as Record<string, unknown>;
    expect(cardUpdate['stageId']).toBe(STAGE_ANALISE_ID);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitData = (mockEmit.mock.calls[0]?.[1] as Record<string, unknown>)['data'] as Record<
      string,
      unknown
    >;
    expect(emitData['reason']).toBe('analysis_review_requested');
    expect(emitData['from_status']).toBe('won');
    expect(emitData['to_status']).toBe('normal');
  });

  // -------------------------------------------------------------------------
  // Cenário 4: to_status='em_analise' com from_status='recusado' → reabertura
  // -------------------------------------------------------------------------
  it('move card para Análise de Crédito quando to_status=em_analise e from_status=recusado', async () => {
    const cardInLost = { ...cardInAnalise, stageId: STAGE_CONCLUIDO_LOST_ID };

    // selectResponses[0]=card, [1]=analiseStage(orderIndex=3), [2]=fromStage(lost)
    const { db, insertedHistoryValues } = makeMockDb([
      cardInLost,
      stageAnaliseCreditoBefore,
      stageConcluídoLost,
    ]);

    await handleAnalysisStatusChanged(db as never, makeEvent('em_analise', 'recusado'));

    expect(insertedHistoryValues).toHaveLength(1);
    const histEntry = insertedHistoryValues[0] as Record<string, unknown>;
    expect(histEntry['toStageId']).toBe(STAGE_ANALISE_ID);
    const meta = histEntry['metadata'] as Record<string, unknown>;
    expect(meta['reason']).toBe('analysis_review_requested');

    expect(mockEmit).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Cenário 5: Idempotência — card já no stage destino → no-op
  // -------------------------------------------------------------------------
  it('não move card que já está no stage destino (idempotência)', async () => {
    // Card já está no stage terminal won — processar evento aprovado novamente
    const cardAlreadyWon = { ...cardInAnalise, stageId: STAGE_CONCLUIDO_WON_ID };

    // [0]=card(already won), [1]=terminalWon, [2]=fromStage(won — para check)
    // O handler detecta card.stageId === toStage.id e retorna antes do findStageById
    const { db, updatedLeadValues } = makeMockDb([
      cardAlreadyWon,
      stageConcluídoWon,
      // fromStage não é carregado (early return antes)
    ]);

    await handleAnalysisStatusChanged(db as never, makeEvent('aprovado', 'em_analise'));

    // leads.last_analysis_id ainda deve ser atualizado
    expect(updatedLeadValues).toHaveLength(1);

    // Sem movimento: nem emit nem auditLog
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 6: leads.last_analysis_id sempre atualizado mesmo em no-op
  // -------------------------------------------------------------------------
  it('atualiza leads.last_analysis_id mesmo quando transição é no-op de idempotência', async () => {
    const cardAlreadyWon = { ...cardInAnalise, stageId: STAGE_CONCLUIDO_WON_ID };

    const { db, updatedLeadValues } = makeMockDb([cardAlreadyWon, stageConcluídoWon]);

    await handleAnalysisStatusChanged(db as never, makeEvent('aprovado', 'em_analise'));

    expect(updatedLeadValues).toHaveLength(1);
    const leadUpdate = updatedLeadValues[0] as Record<string, unknown>;
    expect(leadUpdate['lastAnalysisId']).toBe(ANALYSIS_ID);
  });

  // -------------------------------------------------------------------------
  // Cenário 7: Payload inválido → skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip sem lançar erro quando lead_id está ausente no payload', async () => {
    const { db } = makeMockDb([]);

    const event = makeEvent('aprovado', 'em_analise', {
      payload: { analysis_id: ANALYSIS_ID, to_status: 'aprovado' } as never,
    });

    await expect(handleAnalysisStatusChanged(db as never, event)).resolves.toBeUndefined();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 8: Card não encontrado → skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip sem lançar erro quando card não existe para o lead', async () => {
    const { db } = makeMockDb([null]);

    await expect(
      handleAnalysisStatusChanged(db as never, makeEvent('aprovado', 'em_analise')),
    ).resolves.toBeUndefined();

    expect(mockEmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 9: Stage terminal won não encontrado → skip sem loop de erro
  // -------------------------------------------------------------------------
  it('faz skip quando stage terminal won não encontrado (não entra em loop)', async () => {
    // [0]=card, [1]=null (terminalWon não encontrado)
    const { db } = makeMockDb([cardInAnalise, null]);

    await expect(
      handleAnalysisStatusChanged(db as never, makeEvent('aprovado', 'em_analise')),
    ).resolves.toBeUndefined();

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 10: Transição não gerenciada → no-op sem erro
  // -------------------------------------------------------------------------
  it('não move card quando to_status não é gerenciado (ex: pendente → em_analise)', async () => {
    // to_status='em_analise' mas from_status='pendente' → não é reabertura gerenciada
    const { db, updatedLeadValues } = makeMockDb([cardInAnalise]);

    await handleAnalysisStatusChanged(db as never, makeEvent('em_analise', 'pendente'));

    // last_analysis_id ainda é atualizado
    expect(updatedLeadValues).toHaveLength(1);

    // Sem movimento de stage
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 11: Stage atual do card não encontrado → skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip quando stage atual do card não encontrado na org', async () => {
    // [0]=card, [1]=terminalWon, [2]=null (fromStage não encontrado)
    const { db } = makeMockDb([cardInAnalise, stageConcluídoWon, null]);

    await expect(
      handleAnalysisStatusChanged(db as never, makeEvent('aprovado', 'em_analise')),
    ).resolves.toBeUndefined();

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 12: Erro em transação → propaga para outbox-publisher registrar falha
  // -------------------------------------------------------------------------
  it('propaga erro de transação para que o outbox-publisher registre a falha', async () => {
    // [0]=card, [1]=terminalWon, [2]=fromStage(analise)
    const { db } = makeMockDb([cardInAnalise, stageConcluídoWon, stageAnaliseCreditoBefore]);

    // Substituir transaction mock para simular falha
    (db as Record<string, unknown>)['transaction'] = vi
      .fn()
      .mockRejectedValue(new Error('DB error simulado'));

    await expect(
      handleAnalysisStatusChanged(db as never, makeEvent('aprovado', 'em_analise')),
    ).rejects.toThrow('DB error simulado');
  });
});
