// =============================================================================
// sla-sources.test.ts — F24-S16.
//
// F24-S07 entregou apenas 1 dos 7 eixos (kanban_stage), delegado
// incondicionalmente por findSlaSources, e com um bug de chave (comparava o
// NOME do stage contra a chave inteira 'kanban_stage:*' — nenhuma regra criada
// pela API real disparava). Este arquivo cobre a correção: um teste por eixo
// (fonte real + entityType do catálogo), o roteador findSlaSources, a
// parametrização kanban_stage:<stageId>, e a regressão do bug de chave usando
// SOMENTE trigger_key reais do TRIGGER_CATALOG — 'Qualificacao' (nome de stage)
// é proibido em qualquer teste deste arquivo.
//
// Estratégia: mock de 'drizzle-orm' (eq/and/lt/isNotNull/isNull/inArray como
// spies pass-through) + mock de db.select() com uma chain configurável.
// Isso permite (a) inspecionar quais condições/colunas foram usadas nas
// queries e (b) controlar quais linhas "o banco" devolve, sem precisar de
// Postgres real — mesmo padrão de spc-overdue-scan.test.ts/winback-scan.test.ts.
// =============================================================================
import { eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    eq: vi.fn((col: unknown, val: unknown) => ({ __eq: [col, val] })),
    and: vi.fn((...args: unknown[]) => ({ __and: args })),
    lt: vi.fn((col: unknown, val: unknown) => ({ __lt: [col, val] })),
    isNotNull: vi.fn((col: unknown) => ({ __isNotNull: col })),
    isNull: vi.fn((col: unknown) => ({ __isNull: col })),
    inArray: vi.fn((col: unknown, vals: unknown) => ({ __inArray: [col, vals] })),
  };
});

import {
  chatwootHandoffs,
  contracts,
  conversations,
  creditAnalyses,
  creditSimulations,
  kanbanCards,
  paymentDues,
} from '../../../db/schema/index.js';
import { AppError } from '../../../shared/errors.js';
import {
  computeCutoff,
  computeCutoffDateString,
  findOverduePaymentDues,
  findSlaSources,
  findStagnantKanbanCards,
  findStalledAnalyses,
  findStalledConversations,
  findStalledDraftContracts,
  findStalledHandoffRequests,
  findStalledSimulations,
} from '../sla-sources.js';
import type { SlaSourceDb } from '../sla-sources.js';

// ---------------------------------------------------------------------------
// Mock de DB — chain configurável (from/innerJoin/leftJoin/where)
// ---------------------------------------------------------------------------

function makeDb(rows: unknown[]): SlaSourceDb {
  const chain = {
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn().mockResolvedValue(rows),
  };
  chain.innerJoin.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  const from = vi.fn().mockReturnValue(chain);
  const select = vi.fn().mockReturnValue({ from });
  return { select };
}

const ORG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LEAD_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CITY_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const STAGE_ID = '11111111-1111-4111-8111-111111111111';
const CARD_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers de threshold (puros)
// ---------------------------------------------------------------------------

describe('computeCutoff', () => {
  it('subtrai exatamente thresholdHours da referência', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const cutoff = computeCutoff(48, now);
    expect(cutoff.toISOString()).toBe('2026-07-08T12:00:00.000Z');
  });

  it('threshold 0 = corte igual à referência', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    expect(computeCutoff(0, now).getTime()).toBe(now.getTime());
  });
});

describe('computeCutoffDateString', () => {
  it('formata YYYY-MM-DD a partir do corte', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    expect(computeCutoffDateString(24, now)).toBe('2026-07-09');
  });
});

// ---------------------------------------------------------------------------
// kanban_stage — kanban_cards.entered_stage_at
// ---------------------------------------------------------------------------

describe('findStagnantKanbanCards', () => {
  it('mapeia entityId=cardId, entityType do catálogo, cityId, leadId e templateContext', async () => {
    const enteredStageAt = new Date(Date.now() - 48 * 60 * 60 * 1_000);
    const db = makeDb([
      {
        cardId: CARD_ID,
        leadId: LEAD_ID,
        cityId: CITY_ID,
        enteredStageAt,
        stageName: 'Estagio Teste',
      },
    ]);
    const result = await findStagnantKanbanCards(db, ORG_ID, 24, null, 'kanban_card');
    expect(result).toEqual([
      {
        entityId: CARD_ID,
        entityType: 'kanban_card',
        cityId: CITY_ID,
        leadId: LEAD_ID,
        sinceAt: enteredStageAt,
        // F26-S02: templateContext alimenta {{card_id}}/{{stage_name}} do catálogo.
        templateContext: { card_id: CARD_ID, stage_name: 'Estagio Teste' },
      },
    ]);
  });

  it('stageId fornecido -> filtra por kanban_cards.stage_id', async () => {
    const db = makeDb([]);
    await findStagnantKanbanCards(db, ORG_ID, 24, STAGE_ID, 'kanban_card');
    const stageCalls = vi
      .mocked(eq)
      .mock.calls.filter(([col, val]) => col === kanbanCards.stageId && val === STAGE_ID);
    expect(stageCalls).toHaveLength(1);
  });

  it("stageId=null ('*') -> NÃO filtra por stage_id no WHERE (só o JOIN com kanban_stages)", async () => {
    const db = makeDb([]);
    await findStagnantKanbanCards(db, ORG_ID, 24, null, 'kanban_card');
    // F26-S02: o JOIN com kanban_stages (para {{stage_name}}) sempre chama
    // eq(kanbanCards.stageId, kanbanStages.id) — segundo argumento é uma
    // coluna, não o STAGE_ID (string) do filtro WHERE condicional. Filtra só
    // chamadas com valor string para isolar o WHERE do JOIN.
    const stageWhereCalls = vi
      .mocked(eq)
      .mock.calls.filter(([col, val]) => col === kanbanCards.stageId && typeof val === 'string');
    expect(stageWhereCalls).toHaveLength(0);
  });

  it('cityId ausente (leads.cityId null) -> mapeado como null', async () => {
    const db = makeDb([
      { cardId: CARD_ID, leadId: LEAD_ID, cityId: null, enteredStageAt: new Date() },
    ]);
    const [entity] = await findStagnantKanbanCards(db, ORG_ID, 24, null, 'kanban_card');
    expect(entity?.cityId).toBeNull();
  });

  it('sem PII: apenas as 6 chaves esperadas no resultado', async () => {
    const db = makeDb([
      {
        cardId: CARD_ID,
        leadId: LEAD_ID,
        cityId: CITY_ID,
        enteredStageAt: new Date(),
        stageName: 'Estagio Teste',
      },
    ]);
    const [entity] = await findStagnantKanbanCards(db, ORG_ID, 24, null, 'kanban_card');
    expect(Object.keys(entity ?? {}).sort()).toEqual(
      ['cityId', 'entityId', 'entityType', 'leadId', 'sinceAt', 'templateContext'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// handoff:requested — chatwoot_handoffs.created_at
// ---------------------------------------------------------------------------

describe('findStalledHandoffRequests', () => {
  it('filtra status=requested e deleted_at IS NULL', async () => {
    const db = makeDb([]);
    await findStalledHandoffRequests(db, ORG_ID, 2, 'conversation');
    expect(vi.mocked(eq)).toHaveBeenCalledWith(chatwootHandoffs.status, 'requested');
    expect(vi.mocked(isNull)).toHaveBeenCalledWith(chatwootHandoffs.deletedAt);
  });

  it('mapeia entityId=handoffId, entityType=conversation (do catálogo) e templateContext', async () => {
    const createdAt = new Date(Date.now() - 3 * 60 * 60 * 1_000);
    const db = makeDb([
      {
        handoffId: 'h1',
        leadId: LEAD_ID,
        cityId: CITY_ID,
        createdAt,
        chatwootConversationId: 'cw-conv-1',
      },
    ]);
    const result = await findStalledHandoffRequests(db, ORG_ID, 2, 'conversation');
    expect(result).toEqual([
      {
        entityId: 'h1',
        entityType: 'conversation',
        cityId: CITY_ID,
        leadId: LEAD_ID,
        sinceAt: createdAt,
        // F26-S02: templateContext alimenta {{chatwoot_conversation_id}} do catálogo.
        templateContext: { chatwoot_conversation_id: 'cw-conv-1' },
      },
    ]);
  });

  it('leadId null (handoff sem lead vinculado) -> cityId/leadId null', async () => {
    const db = makeDb([{ handoffId: 'h1', leadId: null, cityId: null, createdAt: new Date() }]);
    const [entity] = await findStalledHandoffRequests(db, ORG_ID, 2, 'conversation');
    expect(entity?.leadId).toBeNull();
    expect(entity?.cityId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// simulation:sent_no_reply — credit_simulations.sent_at
// ---------------------------------------------------------------------------

describe('findStalledSimulations', () => {
  it('filtra sent_at IS NOT NULL', async () => {
    const db = makeDb([]);
    await findStalledSimulations(db, ORG_ID, 24, 'simulation');
    expect(vi.mocked(isNotNull)).toHaveBeenCalledWith(creditSimulations.sentAt);
  });

  it('mapeia entityId=simulationId, entityType=simulation e templateContext', async () => {
    const sentAt = new Date(Date.now() - 30 * 60 * 60 * 1_000);
    const db = makeDb([{ simulationId: 's1', leadId: LEAD_ID, cityId: CITY_ID, sentAt }]);
    const result = await findStalledSimulations(db, ORG_ID, 24, 'simulation');
    expect(result).toEqual([
      {
        entityId: 's1',
        entityType: 'simulation',
        cityId: CITY_ID,
        leadId: LEAD_ID,
        sinceAt: sentAt,
        // F26-S02: templateContext alimenta {{simulation_id}} do catálogo.
        templateContext: { simulation_id: 's1' },
      },
    ]);
  });

  it('descarta defensivamente linha com sentAt null (SQL já filtra, TS narrow)', async () => {
    const db = makeDb([{ simulationId: 's1', leadId: LEAD_ID, cityId: CITY_ID, sentAt: null }]);
    const result = await findStalledSimulations(db, ORG_ID, 24, 'simulation');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// analysis:pendente — credit_analyses.updated_at
// ---------------------------------------------------------------------------

describe('findStalledAnalyses', () => {
  it('filtra status=pendente e usa updated_at (não created_at)', async () => {
    const db = makeDb([]);
    await findStalledAnalyses(db, ORG_ID, 24, 'credit_analysis');
    expect(vi.mocked(eq)).toHaveBeenCalledWith(creditAnalyses.status, 'pendente');
    expect(vi.mocked(lt)).toHaveBeenCalledWith(creditAnalyses.updatedAt, expect.any(Date));
  });

  it('mapeia entityId=analysisId, entityType=credit_analysis e templateContext', async () => {
    const updatedAt = new Date(Date.now() - 30 * 60 * 60 * 1_000);
    const db = makeDb([{ analysisId: 'a1', leadId: LEAD_ID, cityId: CITY_ID, updatedAt }]);
    const result = await findStalledAnalyses(db, ORG_ID, 24, 'credit_analysis');
    expect(result).toEqual([
      {
        entityId: 'a1',
        entityType: 'credit_analysis',
        cityId: CITY_ID,
        leadId: LEAD_ID,
        sinceAt: updatedAt,
        // F26-S02: templateContext alimenta {{analysis_id}} do catálogo.
        templateContext: { analysis_id: 'a1' },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// contract:draft_unsigned — contracts.created_at
// ---------------------------------------------------------------------------

describe('findStalledDraftContracts', () => {
  it('filtra status=draft e signed_at IS NULL', async () => {
    const db = makeDb([]);
    await findStalledDraftContracts(db, ORG_ID, 24, 'contract');
    expect(vi.mocked(eq)).toHaveBeenCalledWith(contracts.status, 'draft');
    expect(vi.mocked(isNull)).toHaveBeenCalledWith(contracts.signedAt);
  });

  it(
    'mapeia entityId=contractId, entityType=contract, leadId via ' +
      'customers.primary_lead_id e templateContext',
    async () => {
      const createdAt = new Date(Date.now() - 30 * 60 * 60 * 1_000);
      const db = makeDb([
        { contractId: 'c1', customerId: 'cust1', leadId: LEAD_ID, cityId: CITY_ID, createdAt },
      ]);
      const result = await findStalledDraftContracts(db, ORG_ID, 24, 'contract');
      expect(result).toEqual([
        {
          entityId: 'c1',
          entityType: 'contract',
          cityId: CITY_ID,
          leadId: LEAD_ID,
          sinceAt: createdAt,
          // F26-S02: templateContext alimenta {{contract_id}}/{{customer_id}}.
          templateContext: { contract_id: 'c1', customer_id: 'cust1' },
        },
      ]);
    },
  );
});

// ---------------------------------------------------------------------------
// payment_due:overdue — payment_dues.due_date
// ---------------------------------------------------------------------------

describe('findOverduePaymentDues', () => {
  it("filtra status IN ('pending','overdue')", async () => {
    const db = makeDb([]);
    await findOverduePaymentDues(db, ORG_ID, 24, 'payment_due');
    expect(vi.mocked(inArray)).toHaveBeenCalledWith(paymentDues.status, ['pending', 'overdue']);
  });

  it(
    'mapeia entityId=paymentDueId, entityType=payment_due, sinceAt a partir de ' +
      'due_date (string) e templateContext',
    async () => {
      const db = makeDb([
        {
          paymentDueId: 'p1',
          customerId: 'cust1',
          leadId: LEAD_ID,
          cityId: CITY_ID,
          dueDate: '2026-06-01',
        },
      ]);
      const result = await findOverduePaymentDues(db, ORG_ID, 24, 'payment_due');
      expect(result).toEqual([
        {
          entityId: 'p1',
          entityType: 'payment_due',
          cityId: CITY_ID,
          leadId: LEAD_ID,
          sinceAt: new Date('2026-06-01T00:00:00.000Z'),
          // F26-S02: templateContext alimenta {{payment_due_id}}/{{customer_id}}.
          templateContext: { payment_due_id: 'p1', customer_id: 'cust1' },
        },
      ]);
    },
  );
});

// ---------------------------------------------------------------------------
// conversation:no_reply — conversations.last_inbound_at
// ---------------------------------------------------------------------------

describe('findStalledConversations', () => {
  it('filtra status=open, last_inbound_at IS NOT NULL e deleted_at IS NULL', async () => {
    const db = makeDb([]);
    await findStalledConversations(db, ORG_ID, 4, 'conversation');
    expect(vi.mocked(eq)).toHaveBeenCalledWith(conversations.status, 'open');
    expect(vi.mocked(isNotNull)).toHaveBeenCalledWith(conversations.lastInboundAt);
    expect(vi.mocked(isNull)).toHaveBeenCalledWith(conversations.deletedAt);
  });

  it('mapeia cityId direto de conversations.city_id (sem JOIN) e templateContext', async () => {
    const lastInboundAt = new Date(Date.now() - 5 * 60 * 60 * 1_000);
    const db = makeDb([
      { conversationId: 'conv1', leadId: LEAD_ID, cityId: CITY_ID, lastInboundAt },
    ]);
    const result = await findStalledConversations(db, ORG_ID, 4, 'conversation');
    expect(result).toEqual([
      {
        entityId: 'conv1',
        entityType: 'conversation',
        cityId: CITY_ID,
        leadId: LEAD_ID,
        sinceAt: lastInboundAt,
        // F26-S02: reusa o próprio UUID da conversa nativa (sem chatwoot_conversation_id
        // real equivalente — ver comentário em sla-sources.ts).
        templateContext: { chatwoot_conversation_id: 'conv1' },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// findSlaSources — dispatcher (regressão do bug de F24-S07)
// ---------------------------------------------------------------------------

describe('findSlaSources', () => {
  it("regressão: trigger_key REAL do catálogo ('kanban_stage:*') dispara a fonte certa", async () => {
    const db = makeDb([
      { cardId: CARD_ID, leadId: LEAD_ID, cityId: CITY_ID, enteredStageAt: new Date() },
    ]);
    const result = await findSlaSources(db, ORG_ID, 24, 'kanban_stage:*');
    expect(result).toHaveLength(1);
    expect(result[0]?.entityType).toBe('kanban_card');
  });

  it('kanban_stage:<stageId> (UUID) roteia para findStagnantKanbanCards filtrando o stage', async () => {
    const db = makeDb([]);
    await findSlaSources(db, ORG_ID, 24, `kanban_stage:${STAGE_ID}`);
    const stageCalls = vi
      .mocked(eq)
      .mock.calls.filter(([col, val]) => col === kanbanCards.stageId && val === STAGE_ID);
    expect(stageCalls).toHaveLength(1);
  });

  const AXES: Array<[string, string]> = [
    ['handoff:requested', 'conversation'],
    ['simulation:sent_no_reply', 'simulation'],
    ['analysis:pendente', 'credit_analysis'],
    ['contract:draft_unsigned', 'contract'],
    ['payment_due:overdue', 'payment_due'],
    ['conversation:no_reply', 'conversation'],
  ];

  it.each(AXES)('%s roteia para uma fonte real com entityType=%s do catálogo', async (key) => {
    const db = makeDb([]);
    // Não deve lançar — chave existe no catálogo e tem fonte implementada.
    await expect(findSlaSources(db, ORG_ID, 24, key)).resolves.toEqual([]);
  });

  it('trigger_key desconhecido -> lança AppError explícito (nunca fallback silencioso)', async () => {
    const db = makeDb([]);
    await expect(findSlaSources(db, ORG_ID, 24, 'eixo.inexistente')).rejects.toThrow(AppError);
  });

  it("trigger_key de EVENTO (kind='event', não stage_inactivity) -> lança", async () => {
    const db = makeDb([]);
    await expect(findSlaSources(db, ORG_ID, 24, 'simulations.generated')).rejects.toThrow(AppError);
  });

  it("PROIBIDO: 'Qualificacao' (nome de stage, não trigger_key) não é aceito", async () => {
    const db = makeDb([]);
    await expect(findSlaSources(db, ORG_ID, 24, 'Qualificacao')).rejects.toThrow(AppError);
  });
});
