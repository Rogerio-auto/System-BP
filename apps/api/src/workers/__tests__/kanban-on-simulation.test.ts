// =============================================================================
// kanban-on-simulation.test.ts — Testes do handler F2-S09.
//
// Estratégia: injeção de db mock via parâmetro de handleSimulationGenerated().
//   Não depende de banco real. Todos os efeitos colaterais são mockados.
//
// Cenários cobertos:
//   1. Evento válido, card em Pré-atendimento → card movido para Simulação
//      (insertHistory + updateCardStage + emit + auditLog chamados)
//   2. Reprocessamento (card já em Simulação) → no-op idempotente
//   3. Card em stage avançado (Documentação, Concluído) → no-op sem regressão
//   4. Falha em um evento não propaga para os outros (testado pelo throw)
//   5. Payload inválido (lead_id ausente) → skip sem erro
//   6. Card não encontrado → skip sem erro
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
// Mock drizzle-orm (evita imports pesados + fornece stubs de eq/and)
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
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
import { handleSimulationGenerated } from '../kanban-on-simulation.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const LEAD_ID = '22222222-2222-2222-2222-222222222222';
const CARD_ID = '33333333-3333-3333-3333-333333333333';
const SIM_ID = '44444444-4444-4444-4444-444444444444';
const STAGE_PRE_ID = 'aaaa0000-0000-0000-0000-000000000000';
const STAGE_SIM_ID = 'aaaa0001-0000-0000-0000-000000000001';
const STAGE_DOC_ID = 'aaaa0002-0000-0000-0000-000000000002';
const EVENT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

function makeEvent(overrides: Partial<EventOutbox> = {}): EventOutbox {
  return {
    id: EVENT_ID,
    organizationId: ORG_ID,
    eventName: 'simulations.generated',
    eventVersion: 1,
    aggregateType: 'credit_simulation',
    aggregateId: SIM_ID,
    payload: {
      simulation_id: SIM_ID,
      lead_id: LEAD_ID,
      product_id: 'prod-1',
      rule_version_id: 'rule-1',
      amount: 2000,
      term_months: 12,
      monthly_payment: 187.53,
      origin: 'manual',
    },
    correlationId: null,
    idempotencyKey: `simulations.generated:${SIM_ID}`,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const stagePreAtendimento = {
  id: STAGE_PRE_ID,
  organizationId: ORG_ID,
  name: 'Pré-atendimento',
  orderIndex: 0,
  color: '#1B3A8C',
  isTerminalWon: false,
  isTerminalLost: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const stageSimulacao = {
  id: STAGE_SIM_ID,
  organizationId: ORG_ID,
  name: 'Simulação',
  orderIndex: 1,
  color: '#F2C200',
  isTerminalWon: false,
  isTerminalLost: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const stageDocumentacao = {
  id: STAGE_DOC_ID,
  organizationId: ORG_ID,
  name: 'Documentação',
  orderIndex: 2,
  color: '#6B7280',
  isTerminalWon: false,
  isTerminalLost: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const cardInPre = {
  id: CARD_ID,
  organizationId: ORG_ID,
  leadId: LEAD_ID,
  stageId: STAGE_PRE_ID,
  assigneeUserId: null,
  priority: 0,
  notes: null,
  enteredStageAt: new Date(),
  productId: null,
  lastSimulationId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// DB mock builder
// ---------------------------------------------------------------------------

interface SelectChain {
  from: () => { where: () => { limit: () => Promise<unknown[]> } };
}

/**
 * Constrói um mock mínimo de Database para injeção em handleSimulationGenerated.
 *
 * selectResponses: mapa de "call index → resultado"
 *   Chamadas select() são feitas em ordem determinística no handler:
 *     0: findCardByLeadId
 *     1: findStageById (fromStage)
 *     2: findStageByOrderIndex (preAtendimento, orderIndex=0)
 *     3: findStageByOrderIndex (simulacao, orderIndex=1)
 */
function makeMockDb(options: {
  card?: unknown | null;
  fromStage?: unknown | null;
  preAtendimentoStage?: unknown | null;
  simulacaoStage?: unknown | null;
  updateResult?: unknown;
  txInsertHistory?: () => Promise<void>;
  txUpdateCard?: () => Promise<void>;
}): {
  db: unknown;
  insertedHistoryValues: unknown[];
  updatedCardValues: unknown[];
  updatedCardMain: unknown[];
} {
  const insertedHistoryValues: unknown[] = [];
  const updatedCardValues: unknown[] = [];
  const updatedCardMain: unknown[] = [];

  let selectCallIndex = 0;

  const selectResponses = [
    options.card !== undefined ? (options.card !== null ? [options.card] : []) : [],
    options.fromStage !== undefined ? (options.fromStage !== null ? [options.fromStage] : []) : [],
    options.preAtendimentoStage !== undefined
      ? options.preAtendimentoStage !== null
        ? [options.preAtendimentoStage]
        : []
      : [],
    options.simulacaoStage !== undefined
      ? options.simulacaoStage !== null
        ? [options.simulacaoStage]
        : []
      : [],
  ];

  function makeSelectChain(): SelectChain {
    const callIdx = selectCallIndex++;
    const result = selectResponses[callIdx] ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(result),
        }),
      }),
    };
  }

  const mockUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((vals: unknown) => {
      updatedCardMain.push(vals);
      return {
        where: vi.fn().mockResolvedValue([]),
      };
    }),
  }));

  const txMockInsert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      insertedHistoryValues.push(vals);
      return Promise.resolve([]);
    }),
  }));

  const txMockUpdate = vi.fn().mockImplementation(() => ({
    set: vi.fn().mockImplementation((vals: unknown) => {
      updatedCardValues.push(vals);
      return {
        where: vi.fn().mockResolvedValue([]),
      };
    }),
  }));

  const txMock = {
    insert: txMockInsert,
    update: txMockUpdate,
    select: vi.fn().mockImplementation(() => makeSelectChain()),
  };

  const db = {
    select: vi.fn().mockImplementation(() => makeSelectChain()),
    update: mockUpdate,
    insert: vi.fn(),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn(txMock);
    }),
  };

  return { db, insertedHistoryValues, updatedCardValues, updatedCardMain };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleSimulationGenerated', () => {
  beforeEach(() => {
    mockEmit.mockClear();
    mockAuditLog.mockClear();
  });

  // -------------------------------------------------------------------------
  // Cenário 1: Caminho feliz — card em Pré-atendimento → move para Simulação
  // -------------------------------------------------------------------------
  it('move card de Pré-atendimento para Simulação no caminho feliz', async () => {
    const { db, insertedHistoryValues, updatedCardValues } = makeMockDb({
      card: cardInPre,
      fromStage: stagePreAtendimento,
      preAtendimentoStage: stagePreAtendimento,
      simulacaoStage: stageSimulacao,
    });

    await handleSimulationGenerated(db as never, makeEvent());

    // 1. insertHistory chamado 1x com actorUserId null (transição de sistema)
    expect(insertedHistoryValues).toHaveLength(1);
    const histEntry = insertedHistoryValues[0] as Record<string, unknown>;
    expect(histEntry['cardId']).toBe(CARD_ID);
    expect(histEntry['fromStageId']).toBe(STAGE_PRE_ID);
    expect(histEntry['toStageId']).toBe(STAGE_SIM_ID);
    expect(histEntry['actorUserId']).toBeNull();
    expect((histEntry['metadata'] as Record<string, unknown>)['source']).toBe(
      'worker:kanban-on-simulation',
    );

    // 2. updateCardStage chamado dentro da transação
    expect(updatedCardValues).toHaveLength(1);
    const updateEntry = updatedCardValues[0] as Record<string, unknown>;
    expect(updateEntry['stageId']).toBe(STAGE_SIM_ID);
    expect(updateEntry['enteredStageAt']).toBeInstanceOf(Date);

    // 3. emit kanban.stage_updated chamado 1x
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitArgs = mockEmit.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(emitArgs['eventName']).toBe('kanban.stage_updated');
    expect((emitArgs['data'] as Record<string, unknown>)['card_id']).toBe(CARD_ID);
    expect((emitArgs['data'] as Record<string, unknown>)['from_stage']).toBe('Pré-atendimento');
    expect((emitArgs['data'] as Record<string, unknown>)['to_stage']).toBe('Simulação');
    expect((emitArgs['data'] as Record<string, unknown>)['reason']).toBe('simulation_generated');

    // 4. auditLog chamado 1x com actor = null (sistema)
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const auditArgs = mockAuditLog.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditArgs['actor']).toBeNull();
    expect(auditArgs['action']).toBe('kanban.stage_updated');
    expect(auditArgs['correlationId']).toBe(EVENT_ID);
  });

  // -------------------------------------------------------------------------
  // Cenário 2: last_simulation_id atualizado mesmo quando card já avançou
  // -------------------------------------------------------------------------
  it('atualiza last_simulation_id mesmo quando card já avançou além de Pré-atendimento', async () => {
    const cardInSim = { ...cardInPre, stageId: STAGE_SIM_ID };

    const { db, updatedCardMain } = makeMockDb({
      card: cardInSim,
      fromStage: stageSimulacao,
      preAtendimentoStage: stagePreAtendimento,
    });

    await handleSimulationGenerated(db as never, makeEvent());

    // last_simulation_id deve ter sido atualizado (update fora da transação)
    expect(updatedCardMain.length).toBeGreaterThanOrEqual(1);
    const mainUpdate = updatedCardMain[0] as Record<string, unknown>;
    expect(mainUpdate['lastSimulationId']).toBe(SIM_ID);

    // Transação não deve ter sido executada (card além de Pré-atendimento)
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 3: Reprocessamento — card já em Simulação → no-op idempotente
  // -------------------------------------------------------------------------
  it('não move card que já está em Simulação (idempotência)', async () => {
    const cardInSim = { ...cardInPre, stageId: STAGE_SIM_ID };

    const { db } = makeMockDb({
      card: cardInSim,
      fromStage: stageSimulacao,
      preAtendimentoStage: stagePreAtendimento,
    });

    await handleSimulationGenerated(db as never, makeEvent());

    // Nem emit nem auditLog devem ter sido chamados
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 4: Card em estágio avançado (Documentação) → sem regressão
  // -------------------------------------------------------------------------
  it('não regride card que está em Documentação', async () => {
    const cardInDoc = { ...cardInPre, stageId: STAGE_DOC_ID };

    const { db } = makeMockDb({
      card: cardInDoc,
      fromStage: stageDocumentacao,
      preAtendimentoStage: stagePreAtendimento,
    });

    await handleSimulationGenerated(db as never, makeEvent());

    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 5: Payload inválido (lead_id ausente) → skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip sem lançar erro quando lead_id está ausente no payload', async () => {
    const { db } = makeMockDb({});

    const event = makeEvent({ payload: { simulation_id: SIM_ID } as never });

    await expect(handleSimulationGenerated(db as never, event)).resolves.toBeUndefined();

    expect(mockEmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 6: Card não encontrado → skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip sem lançar erro quando card não existe para o lead', async () => {
    const { db } = makeMockDb({ card: null });

    await expect(handleSimulationGenerated(db as never, makeEvent())).resolves.toBeUndefined();

    expect(mockEmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 7: Erro de DB em transação → propaga (para que o outbox-publisher
  //            registre a falha e recontabilize tentativas)
  // -------------------------------------------------------------------------
  it('propaga erro de transação para que o outbox-publisher registre a falha', async () => {
    const { db } = makeMockDb({
      card: cardInPre,
      fromStage: stagePreAtendimento,
      preAtendimentoStage: stagePreAtendimento,
      simulacaoStage: stageSimulacao,
    });

    // Substituir transaction mock para simular falha
    (db as Record<string, unknown>)['transaction'] = vi
      .fn()
      .mockRejectedValue(new Error('DB error simulado'));

    await expect(handleSimulationGenerated(db as never, makeEvent())).rejects.toThrow(
      'DB error simulado',
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 8: Stage Pré-atendimento não encontrado na org → skip sem throw
  // -------------------------------------------------------------------------
  it('faz skip quando stage Pré-atendimento não é encontrado na org', async () => {
    const { db } = makeMockDb({
      card: cardInPre,
      fromStage: stagePreAtendimento,
      preAtendimentoStage: null, // não encontrado
    });

    await expect(handleSimulationGenerated(db as never, makeEvent())).resolves.toBeUndefined();

    expect(mockEmit).not.toHaveBeenCalled();
  });
});
