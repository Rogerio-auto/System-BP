// =============================================================================
// winback-scan.test.ts — Testes do worker F17-S09.
//
// Estratégia: injeção de db mock + mock de isFlagEnabled + mock de emit.
//   Todos os efeitos colaterais (selects, inserts, eventos) são mockados.
//
// Cenários cobertos por scan:
//
// Scan 1 — winback_renovation (contrato perto do fim):
//   1. Contrato com ≤2 parcelas não pagas → dispara tarefa winback
//   2. Contrato com 3+ parcelas não pagas → NÃO dispara
//   3. Idempotência: tarefa winback ativa existente → skip sem duplicata
//   4. Evento contract.near_end emitido no scan 1
//
// Scan 2 — winback_lost (lead closed_lost):
//   5. Lead closed_lost há 31 dias → dispara tarefa winback
//   6. Lead closed_lost há 29 dias → NÃO dispara (não chega à query)
//   7. Idempotência: tarefa winback ativa existente → skip sem duplicata
//
// Scan 3 — winback_stagnant (kanban estagnado):
//   8. Kanban sem mover há 46 dias → dispara tarefa winback
//   9. Kanban sem mover há 44 dias → NÃO dispara (não chega à query)
//  10. Idempotência: tarefa winback ativa existente → skip sem duplicata
//
// Utilitários:
//  11. calcClosedLostThreshold() → subtrai exatamente 30 dias
//  12. calcStagnantThreshold()   → subtrai exatamente 45 dias
//
// Flag-gating:
//  13. winback.enabled=disabled → 0 queries, 0 inserts
//  14. winback.scan.enabled=disabled → dry_run=true, 0 inserts
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
    FX_BRL_PER_USD: 5.75,
    LGPD_DEDUPE_PEPPER: 'a'.repeat(32),
    FOLLOWUP_SCHEDULER_TICK_MS: undefined,
  },
}));

// ---------------------------------------------------------------------------
// Mock pg
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
// Mock drizzle-orm
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  or: vi.fn((...args: unknown[]) => ({ __or: args })),
  lt: vi.fn((_col: unknown, val: unknown) => ({ __lt: val })),
  lte: vi.fn((_col: unknown, val: unknown) => ({ __lte: val })),
  isNotNull: vi.fn((_col: unknown) => ({ __isNotNull: true })),
  notInArray: vi.fn((_col: unknown, vals: unknown[]) => ({ __notInArray: vals })),
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
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {},
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock isFlagEnabled
// ---------------------------------------------------------------------------
const mockIsFlagEnabled = vi.fn();
vi.mock('../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
  invalidateFlagCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock emit
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('event-uuid-1');
vi.mock('../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Import das funções sob teste
// ---------------------------------------------------------------------------
import {
  calcClosedLostThreshold,
  calcStagnantThreshold,
  findClosedLostLeads,
  findContractsNearEnd,
  findStagnantKanbanCards,
  hasActiveWinbackTask,
  processClosedLostWinback,
  processContractWinback,
  processStagnantWinback,
  runWinbackScan,
  WINBACK_CLOSED_LOST_DAYS,
  WINBACK_INSTALLMENTS_THRESHOLD,
  WINBACK_STAGNANT_DAYS,
} from '../winback-scan.js';
import type {
  ClosedLostLead,
  ContractNearEnd,
  StagnantCard,
  WinbackLogger,
} from '../winback-scan.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const CONTRACT_ID = 'cccc0001-0000-0000-0000-000000000001';
const CUSTOMER_ID = 'cccc0002-0000-0000-0000-000000000002';
const LEAD_ID_A = 'aaaa0001-0000-0000-0000-000000000001';
const LEAD_ID_B = 'aaaa0002-0000-0000-0000-000000000002';
const CITY_ID = 'dddd0001-0000-0000-0000-000000000001';
const TASK_UUID = 'bbbb0001-0000-0000-0000-000000000001';

/** Logger silencioso para testes. */
const mockLoggerFns = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const mockLogger = mockLoggerFns as unknown as WinbackLogger;

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

function makeContract(overrides: Partial<ContractNearEnd> = {}): ContractNearEnd {
  return {
    contractId: overrides.contractId ?? CONTRACT_ID,
    customerId: overrides.customerId ?? CUSTOMER_ID,
    organizationId: overrides.organizationId ?? ORG_ID,
    cityId: overrides.cityId ?? CITY_ID,
    installmentsRemaining: overrides.installmentsRemaining ?? 1,
  };
}

function makeClosedLostLead(overrides: Partial<ClosedLostLead> = {}): ClosedLostLead {
  return {
    leadId: overrides.leadId ?? LEAD_ID_A,
    organizationId: overrides.organizationId ?? ORG_ID,
    cityId: overrides.cityId ?? CITY_ID,
  };
}

function makeStagnantCard(overrides: Partial<StagnantCard> = {}): StagnantCard {
  return {
    leadId: overrides.leadId ?? LEAD_ID_B,
    organizationId: overrides.organizationId ?? ORG_ID,
    cityId: overrides.cityId ?? CITY_ID,
    daysSinceLastMove: overrides.daysSinceLastMove ?? 46,
  };
}

// ---------------------------------------------------------------------------
// Helpers de flag
// ---------------------------------------------------------------------------

function setFlagsAllOn(): void {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'winback.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'winback.scan.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

function setFlagWinbackDisabled(): void {
  mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });
}

function setFlagScanDisabled(): void {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'winback.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

// ---------------------------------------------------------------------------
// Mock de DB para testes de scan completo
// ---------------------------------------------------------------------------

/**
 * Cria mocks individuais para as queries dos 3 scans do winback.
 *
 * Cada função de scan é mockada individualmente para evitar ambiguidade
 * nas chamadas sequenciais de `select()` (principalmente em dry-run
 * onde hasActiveWinbackTask não é chamado entre os scans).
 *
 * Padrão de select() dentro de runWinbackScan (com dryRun=false, 1 item por scan):
 *   0:  findContractsNearEnd         → JOIN query com .having()
 *   1:  hasActiveWinbackTask(contract)
 *   2:  findClosedLostLeads          → .where() direto
 *   3:  hasActiveWinbackTask(lead/lost)
 *   4:  findStagnantKanbanCards      → JOIN query
 *   5:  hasActiveWinbackTask(lead/stagnant)
 *
 * Com dryRun=true (sem hasActiveWinbackTask):
 *   0:  findContractsNearEnd
 *   1:  findClosedLostLeads
 *   2:  findStagnantKanbanCards
 */
function makeFullScanDb(
  options: {
    contracts?: ContractNearEnd[];
    closedLostLeads?: ClosedLostLead[];
    stagnantCards?: StagnantCard[];
    activeTaskExists?: boolean;
    dryRun?: boolean;
  } = {},
) {
  const {
    contracts: contractsData = [],
    closedLostLeads: closedLostData = [],
    stagnantCards: stagnantData = [],
    activeTaskExists = false,
    dryRun = false,
  } = options;

  const activeTaskRows = activeTaskExists ? [{ id: TASK_UUID }] : [];
  const now = new Date();

  // Sequência de respostas de select() dependendo do modo (dry-run vs normal)
  // Em dry-run: scan1, scan2, scan3 (sem hasActiveWinbackTask entre eles)
  // Em normal: scan1, [hasActive×n], scan2, [hasActive×n], scan3, [hasActive×n]

  type SelectResponse = ReturnType<typeof vi.fn>;

  function makeScan1Response(): SelectResponse {
    return vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        having: vi.fn().mockResolvedValue(
          contractsData.map((c) => ({
            contractId: c.contractId,
            customerId: c.customerId,
            organizationId: c.organizationId,
            cityId: c.cityId,
            installmentsRemaining: c.installmentsRemaining,
          })),
        ),
      }),
    });
  }

  function makeScan2Response(): SelectResponse {
    return vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(
          closedLostData.map((l) => ({
            leadId: l.leadId,
            organizationId: l.organizationId,
            cityId: l.cityId,
          })),
        ),
      }),
    });
  }

  function makeScan3Response(): SelectResponse {
    return vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(
          stagnantData.map((c) => ({
            leadId: c.leadId,
            organizationId: c.organizationId,
            cityId: c.cityId,
            enteredStageAt: new Date(now.getTime() - c.daysSinceLastMove * 24 * 60 * 60 * 1000),
          })),
        ),
      }),
    });
  }

  function makeHasActiveResponse(): SelectResponse {
    return vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(activeTaskRows),
        }),
      }),
    });
  }

  // Constrói a sequência de respostas
  const responses: SelectResponse[] = [];

  if (dryRun) {
    // Sem hasActiveWinbackTask — apenas as 3 queries de scan
    responses.push(makeScan1Response(), makeScan2Response(), makeScan3Response());
  } else {
    // Scan 1 + hasActive por contrato
    responses.push(makeScan1Response());
    for (let i = 0; i < contractsData.length; i++) responses.push(makeHasActiveResponse());
    // Scan 2 + hasActive por lead
    responses.push(makeScan2Response());
    for (let i = 0; i < closedLostData.length; i++) responses.push(makeHasActiveResponse());
    // Scan 3 + hasActive por card
    responses.push(makeScan3Response());
    for (let i = 0; i < stagnantData.length; i++) responses.push(makeHasActiveResponse());
  }

  let selectCallCount = 0;
  const mockSelect = vi.fn().mockImplementation(() => {
    const response = responses[selectCallCount++];
    if (!response) {
      // fallback — não deveria acontecer em testes bem construídos
      return makeHasActiveResponse()();
    }
    return response();
  });

  // Mock de transação para processamentos
  const mockTransaction = vi
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
      const txDb = {
        insert: vi
          .fn()
          .mockReturnValueOnce({
            // tasks insert
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: TASK_UUID }]),
            }),
          })
          .mockReturnValue({
            // auditLogs insert — só .values()
            values: vi.fn().mockResolvedValue(undefined),
          }),
      };
      return cb(txDb);
    });

  return {
    select: mockSelect,
    transaction: mockTransaction,
    _mockTransaction: mockTransaction,
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('winback-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerFns.info.mockClear();
    mockLoggerFns.debug.mockClear();
    mockLoggerFns.error.mockClear();
    mockLoggerFns.warn.mockClear();
    mockEmit.mockClear();
  });

  // -------------------------------------------------------------------------
  // Constantes
  // -------------------------------------------------------------------------

  describe('constantes configuráveis', () => {
    it('WINBACK_INSTALLMENTS_THRESHOLD === 2', () => {
      expect(WINBACK_INSTALLMENTS_THRESHOLD).toBe(2);
    });

    it('WINBACK_CLOSED_LOST_DAYS === 30', () => {
      expect(WINBACK_CLOSED_LOST_DAYS).toBe(30);
    });

    it('WINBACK_STAGNANT_DAYS === 45', () => {
      expect(WINBACK_STAGNANT_DAYS).toBe(45);
    });
  });

  // -------------------------------------------------------------------------
  // calcClosedLostThreshold
  // -------------------------------------------------------------------------

  describe('calcClosedLostThreshold()', () => {
    it('subtrai exatamente 30 dias da data de referência', () => {
      const now = new Date('2026-06-16T12:00:00Z');
      const threshold = calcClosedLostThreshold(now);
      const expected = new Date('2026-05-17T12:00:00Z');
      expect(threshold.toISOString()).toBe(expected.toISOString());
    });

    it('funciona em virada de mês', () => {
      // Usa timestamp ISO explícito para evitar ambiguidade de timezone.
      // 2026-03-30 - 30d = 2026-02-28
      const now = new Date('2026-03-30T12:00:00.000Z');
      const threshold = calcClosedLostThreshold(now);
      const expected = new Date('2026-02-28T12:00:00.000Z');
      expect(threshold.toISOString()).toBe(expected.toISOString());
    });
  });

  // -------------------------------------------------------------------------
  // calcStagnantThreshold
  // -------------------------------------------------------------------------

  describe('calcStagnantThreshold()', () => {
    it('subtrai exatamente 45 dias da data de referência', () => {
      const now = new Date('2026-06-16T12:00:00Z');
      const threshold = calcStagnantThreshold(now);
      const expected = new Date('2026-05-02T12:00:00Z');
      expect(threshold.toISOString()).toBe(expected.toISOString());
    });

    it('funciona em virada de ano', () => {
      const now = new Date('2026-02-10T00:00:00Z');
      const threshold = calcStagnantThreshold(now);
      // 2026-02-10 - 45d = 2025-12-26
      expect(threshold.getFullYear()).toBe(2025);
      expect(threshold.getMonth()).toBe(11); // dezembro (0-indexed)
      expect(threshold.getDate()).toBe(26);
    });
  });

  // -------------------------------------------------------------------------
  // hasActiveWinbackTask
  // -------------------------------------------------------------------------

  describe('hasActiveWinbackTask()', () => {
    it('retorna true quando existe tarefa winback ativa para a entidade', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: TASK_UUID }]),
            }),
          }),
        }),
      };

      const result = await hasActiveWinbackTask(mockDb as never, ORG_ID, 'contract', CONTRACT_ID);
      expect(result).toBe(true);
    });

    it('retorna false quando não existe tarefa ativa', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      const result = await hasActiveWinbackTask(mockDb as never, ORG_ID, 'lead', LEAD_ID_A);
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // findContractsNearEnd
  // -------------------------------------------------------------------------

  describe('findContractsNearEnd()', () => {
    it('retorna contratos com installmentsRemaining ≤ 2 e cityId não-null', async () => {
      const rows = [
        {
          contractId: CONTRACT_ID,
          customerId: CUSTOMER_ID,
          organizationId: ORG_ID,
          cityId: CITY_ID,
          installmentsRemaining: 2,
        },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            groupBy: vi.fn().mockReturnThis(),
            having: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };

      const result = await findContractsNearEnd(mockDb as never);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        contractId: CONTRACT_ID,
        installmentsRemaining: 2,
      });
    });

    it('filtra contratos com cityId=null', async () => {
      const rows = [
        {
          contractId: CONTRACT_ID,
          customerId: CUSTOMER_ID,
          organizationId: ORG_ID,
          cityId: null,
          installmentsRemaining: 1,
        },
        {
          contractId: 'cccc0009-0000-0000-0000-000000000009',
          customerId: CUSTOMER_ID,
          organizationId: ORG_ID,
          cityId: CITY_ID,
          installmentsRemaining: 2,
        },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            groupBy: vi.fn().mockReturnThis(),
            having: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };

      const result = await findContractsNearEnd(mockDb as never);
      // Apenas contrato com cityId deve ser retornado
      expect(result).toHaveLength(1);
      expect(result[0]?.contractId).toBe('cccc0009-0000-0000-0000-000000000009');
    });
  });

  // -------------------------------------------------------------------------
  // processContractWinback
  // -------------------------------------------------------------------------

  describe('processContractWinback()', () => {
    it('cria tarefa winback + emite evento contract.near_end em transação atômica', async () => {
      const contract = makeContract({ installmentsRemaining: 2 });

      let insertCount = 0;
      const txDb = {
        insert: vi.fn().mockImplementation(() => {
          insertCount++;
          if (insertCount === 1) {
            // tasks insert
            return {
              values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: TASK_UUID }]),
              }),
            };
          }
          // auditLogs insert
          return { values: vi.fn().mockResolvedValue(undefined) };
        }),
      };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
          return cb(txDb);
        }),
      };

      const taskId = await processContractWinback(mockDb as never, contract);

      expect(taskId).toBe(TASK_UUID);
      // tasks insert + auditLogs insert = 2 inserts
      expect(txDb.insert).toHaveBeenCalledTimes(2);

      // Evento contract.near_end emitido
      expect(mockEmit).toHaveBeenCalledOnce();
      const emitCall = mockEmit.mock.calls[0]?.[1] as {
        eventName: string;
        data: { contract_id: string; customer_id: string; installments_remaining: number };
      };
      expect(emitCall?.eventName).toBe('contract.near_end');
      expect(emitCall?.data).toMatchObject({
        contract_id: contract.contractId,
        customer_id: contract.customerId,
        installments_remaining: 2,
      });
    });

    it('lança AppError se insert da tarefa retornar vazio', async () => {
      const contract = makeContract();

      const txDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
          return cb(txDb);
        }),
      };

      await expect(processContractWinback(mockDb as never, contract)).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // findClosedLostLeads
  // -------------------------------------------------------------------------

  describe('findClosedLostLeads()', () => {
    it('retorna leads com status=closed_lost e updated_at antes do threshold', async () => {
      const rows = [{ leadId: LEAD_ID_A, organizationId: ORG_ID, cityId: CITY_ID }];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };

      const threshold = new Date('2026-05-17T00:00:00Z'); // 30d atrás
      const result = await findClosedLostLeads(mockDb as never, threshold);

      expect(result).toHaveLength(1);
      expect(result[0]?.leadId).toBe(LEAD_ID_A);
    });

    it('filtra leads com cityId=null', async () => {
      const rows = [
        { leadId: LEAD_ID_A, organizationId: ORG_ID, cityId: null },
        { leadId: LEAD_ID_B, organizationId: ORG_ID, cityId: CITY_ID },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };

      const threshold = new Date('2026-05-17T00:00:00Z');
      const result = await findClosedLostLeads(mockDb as never, threshold);

      expect(result).toHaveLength(1);
      expect(result[0]?.leadId).toBe(LEAD_ID_B);
    });
  });

  // -------------------------------------------------------------------------
  // processClosedLostWinback
  // -------------------------------------------------------------------------

  describe('processClosedLostWinback()', () => {
    it('cria tarefa winback para lead closed_lost sem emitir evento', async () => {
      const lead = makeClosedLostLead();

      let insertCount = 0;
      const txDb = {
        insert: vi.fn().mockImplementation(() => {
          insertCount++;
          if (insertCount === 1) {
            return {
              values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: TASK_UUID }]),
              }),
            };
          }
          return { values: vi.fn().mockResolvedValue(undefined) };
        }),
      };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
          return cb(txDb);
        }),
      };

      const taskId = await processClosedLostWinback(mockDb as never, lead);

      expect(taskId).toBe(TASK_UUID);
      // Scan 2 não emite evento — apenas cria tarefa + audit
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // findStagnantKanbanCards
  // -------------------------------------------------------------------------

  describe('findStagnantKanbanCards()', () => {
    it('retorna cards com entered_stage_at antes do threshold', async () => {
      const threshold = new Date('2026-05-02T00:00:00Z'); // 45d atrás
      const enteredStageAt = new Date('2026-04-01T00:00:00Z'); // 76d atrás — elegível

      const rows = [
        {
          leadId: LEAD_ID_B,
          organizationId: ORG_ID,
          cityId: CITY_ID,
          enteredStageAt,
        },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };

      const result = await findStagnantKanbanCards(mockDb as never, threshold);

      expect(result).toHaveLength(1);
      expect(result[0]?.leadId).toBe(LEAD_ID_B);
      expect(result[0]?.daysSinceLastMove).toBeGreaterThan(45);
    });

    it('filtra cards com cityId=null', async () => {
      const threshold = new Date('2026-05-02T00:00:00Z');
      const enteredStageAt = new Date('2026-04-01T00:00:00Z');

      const rows = [
        { leadId: LEAD_ID_A, organizationId: ORG_ID, cityId: null, enteredStageAt },
        { leadId: LEAD_ID_B, organizationId: ORG_ID, cityId: CITY_ID, enteredStageAt },
      ];

      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue(rows),
          }),
        }),
      };

      const result = await findStagnantKanbanCards(mockDb as never, threshold);

      expect(result).toHaveLength(1);
      expect(result[0]?.leadId).toBe(LEAD_ID_B);
    });
  });

  // -------------------------------------------------------------------------
  // processStagnantWinback
  // -------------------------------------------------------------------------

  describe('processStagnantWinback()', () => {
    it('cria tarefa winback para card estagnado sem emitir evento', async () => {
      const card = makeStagnantCard({ daysSinceLastMove: 46 });

      let insertCount = 0;
      const txDb = {
        insert: vi.fn().mockImplementation(() => {
          insertCount++;
          if (insertCount === 1) {
            return {
              values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([{ id: TASK_UUID }]),
              }),
            };
          }
          return { values: vi.fn().mockResolvedValue(undefined) };
        }),
      };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
          return cb(txDb);
        }),
      };

      const taskId = await processStagnantWinback(mockDb as never, card);

      expect(taskId).toBe(TASK_UUID);
      // Scan 3 não emite evento
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // runWinbackScan — Flag-gating
  // -------------------------------------------------------------------------

  describe('runWinbackScan() — flag-gating', () => {
    it('winback.enabled=disabled → retorna zeros sem queries', async () => {
      setFlagWinbackDisabled();
      const db = makeFullScanDb();

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result).toMatchObject({
        renovationEligible: 0,
        renovationProcessed: 0,
        renovationSkipped: 0,
        lostEligible: 0,
        lostProcessed: 0,
        lostSkipped: 0,
        stagnantEligible: 0,
        stagnantProcessed: 0,
        stagnantSkipped: 0,
        dryRun: false,
      });
      expect(db.select).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('winback.scan.enabled=disabled → dry_run=true, 0 inserts', async () => {
      setFlagScanDisabled();
      const db = makeFullScanDb({
        contracts: [makeContract()],
        closedLostLeads: [makeClosedLostLead()],
        stagnantCards: [makeStagnantCard()],
        dryRun: true, // sem hasActiveWinbackTask em dry-run
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.dryRun).toBe(true);
      expect(result.renovationEligible).toBe(1);
      expect(result.lostEligible).toBe(1);
      expect(result.stagnantEligible).toBe(1);
      // Nenhum insert em dry-run
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // runWinbackScan — Scan 1: winback_renovation
  // -------------------------------------------------------------------------

  describe('runWinbackScan() — scan 1: winback_renovation', () => {
    it('contrato com ≤2 parcelas → cria tarefa winback + emite evento', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({
        contracts: [makeContract({ installmentsRemaining: 2 })],
        activeTaskExists: false,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.renovationEligible).toBe(1);
      expect(result.renovationProcessed).toBe(1);
      expect(result.renovationSkipped).toBe(0);
      expect(mockEmit).toHaveBeenCalledOnce();
      const emitCall = mockEmit.mock.calls[0]?.[1] as { eventName: string };
      expect(emitCall?.eventName).toBe('contract.near_end');
    });

    it('sem contratos elegíveis → 0 processados', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({ contracts: [] });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.renovationEligible).toBe(0);
      expect(result.renovationProcessed).toBe(0);
    });

    it('idempotência: tarefa winback ativa existente → skip sem duplicata', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({
        contracts: [makeContract()],
        activeTaskExists: true,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.renovationEligible).toBe(1);
      expect(result.renovationProcessed).toBe(0);
      expect(result.renovationSkipped).toBe(1);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // runWinbackScan — Scan 2: winback_lost
  // -------------------------------------------------------------------------

  describe('runWinbackScan() — scan 2: winback_lost', () => {
    it('lead closed_lost há 31d → cria tarefa winback (sem evento)', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({
        closedLostLeads: [makeClosedLostLead()],
        activeTaskExists: false,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.lostEligible).toBe(1);
      expect(result.lostProcessed).toBe(1);
      expect(result.lostSkipped).toBe(0);
      // Scan 2 não emite evento
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('lead closed_lost há 29d → NÃO dispara (não aparece na query — threshold filtra)', async () => {
      setFlagsAllOn();
      // A query SQL filtra por updated_at < threshold — leads recentes não aparecem.
      // Simulamos isso retornando lista vazia.
      const db = makeFullScanDb({ closedLostLeads: [] });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.lostEligible).toBe(0);
      expect(result.lostProcessed).toBe(0);
    });

    it('idempotência: tarefa winback ativa existente → skip sem duplicata', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({
        closedLostLeads: [makeClosedLostLead()],
        activeTaskExists: true,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.lostEligible).toBe(1);
      expect(result.lostProcessed).toBe(0);
      expect(result.lostSkipped).toBe(1);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // runWinbackScan — Scan 3: winback_stagnant
  // -------------------------------------------------------------------------

  describe('runWinbackScan() — scan 3: winback_stagnant', () => {
    it('kanban sem mover há 46d → cria tarefa winback (sem evento)', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({
        stagnantCards: [makeStagnantCard({ daysSinceLastMove: 46 })],
        activeTaskExists: false,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.stagnantEligible).toBe(1);
      expect(result.stagnantProcessed).toBe(1);
      expect(result.stagnantSkipped).toBe(0);
      // Scan 3 não emite evento
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('kanban sem mover há 44d → NÃO dispara (não aparece na query — threshold filtra)', async () => {
      setFlagsAllOn();
      // A query SQL filtra por entered_stage_at < threshold — cards recentes não aparecem.
      const db = makeFullScanDb({ stagnantCards: [] });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.stagnantEligible).toBe(0);
      expect(result.stagnantProcessed).toBe(0);
    });

    it('idempotência: tarefa winback ativa existente → skip sem duplicata', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({
        stagnantCards: [makeStagnantCard()],
        activeTaskExists: true,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.stagnantEligible).toBe(1);
      expect(result.stagnantProcessed).toBe(0);
      expect(result.stagnantSkipped).toBe(1);
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // runWinbackScan — 3 scans simultâneos
  // -------------------------------------------------------------------------

  describe('runWinbackScan() — 3 scans independentes', () => {
    it('roda os 3 scans e retorna contagens corretas', async () => {
      setFlagsAllOn();
      const db = makeFullScanDb({
        contracts: [makeContract()],
        closedLostLeads: [makeClosedLostLead()],
        stagnantCards: [makeStagnantCard()],
        activeTaskExists: false,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.renovationEligible).toBe(1);
      expect(result.renovationProcessed).toBe(1);
      expect(result.lostEligible).toBe(1);
      expect(result.lostProcessed).toBe(1);
      expect(result.stagnantEligible).toBe(1);
      expect(result.stagnantProcessed).toBe(1);
      // Apenas scan 1 emite evento
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('2ª execução completa não duplica nenhuma tarefa (idempotência global)', async () => {
      setFlagsAllOn();
      // Simula estado após 1ª execução: todas tarefas ativas
      const db = makeFullScanDb({
        contracts: [makeContract()],
        closedLostLeads: [makeClosedLostLead()],
        stagnantCards: [makeStagnantCard()],
        activeTaskExists: true,
      });

      const result = await runWinbackScan(db as never, mockLogger);

      expect(result.renovationProcessed).toBe(0);
      expect(result.renovationSkipped).toBe(1);
      expect(result.lostProcessed).toBe(0);
      expect(result.lostSkipped).toBe(1);
      expect(result.stagnantProcessed).toBe(0);
      expect(result.stagnantSkipped).toBe(1);
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });
  });
});
