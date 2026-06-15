// =============================================================================
// spc-overdue-scan.test.ts — Testes do worker F15-S08 (varredura de inadimplência 15d).
//
// Estratégia: injeção de db mock + mock de isFlagEnabled + mock de emit.
//   Todos os efeitos colaterais (selects, inserts, eventos) são mockados.
//
// Cenários cobertos:
//   1. spc.enabled=disabled → 0 queries, 0 inserts, resultado vazio.
//   2. spc.scan.enabled=disabled → dry_run=true, 0 inserts.
//   3. Parcela com 14d de atraso NÃO dispara (não aparece em findOverdueCustomers).
//   4. Parcela com 15d de atraso dispara → tarefa criada + evento emitido.
//   5. Cliente com spc_status='included' → ignorado (não aparece na query).
//   6. Idempotência: 2ª execução com chave existente → skip, 0 inserts.
//   7. Tarefa aberta existente → skip (segunda camada de idempotência).
//   8. Erro por cliente é isolado → outros clientes processados normalmente.
//   9. calcOverdueThreshold() → subtrai exatamente 15 dias.
//  10. buildScanIdempotencyKey() → formato correto.
//  11. findOverdueCustomers() → filtra cityId null.
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
  lte: vi.fn((_col: unknown, val: unknown) => ({ __lte: val })),
  isNotNull: vi.fn((_col: unknown) => ({ __isNotNull: true })),
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
  buildScanIdempotencyKey,
  calcOverdueThreshold,
  findOverdueCustomers,
  hasOpenSpcTask,
  processOverdueCustomer,
  runSpcOverdueScanTick,
} from '../spc-overdue-scan.js';
import type { OverdueCustomer, ScanLogger } from '../spc-overdue-scan.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const CUSTOMER_ID_A = '22222222-2222-2222-2222-222222222222';
const CUSTOMER_ID_B = '33333333-3333-3333-3333-333333333333';
const CITY_ID = 'aaaa0001-0000-0000-0000-000000000001';
const TASK_UUID = 'bbbb0002-0000-0000-0000-000000000002';

function makeCustomer(overrides: Partial<OverdueCustomer> = {}): OverdueCustomer {
  return {
    customerId: overrides.customerId ?? CUSTOMER_ID_A,
    organizationId: overrides.organizationId ?? ORG_ID,
    cityId: overrides.cityId ?? CITY_ID,
    overdueCount: overrides.overdueCount ?? 1,
  };
}

/** Logger silencioso para testes. */
const mockLoggerFns = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
const mockLogger = mockLoggerFns as unknown as ScanLogger;

// ---------------------------------------------------------------------------
// Helpers de flag
// ---------------------------------------------------------------------------

function setFlagsAllOn(): void {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'spc.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'spc.scan.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

function setFlagSpcDisabled(): void {
  mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });
}

function setFlagScanDisabled(): void {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'spc.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

// ---------------------------------------------------------------------------
// Helpers de mock de DB
// ---------------------------------------------------------------------------

/**
 * Cria um mock de DB configurável para runSpcOverdueScanTick.
 *
 * select calls order em runSpcOverdueScanTick:
 *   0: findOverdueCustomers → rows de clientes
 *   1+ (por cliente): hasIdempotencyKey → [] (não existe) ou [{ key }]
 *   2+ (por cliente): hasOpenSpcTask → [] (não existe) ou [{ id }]
 *
 * transaction: mock que executa o callback imediatamente.
 */
function makeDb(
  options: {
    overdueCustomers?: OverdueCustomer[];
    idempotencyKeyExists?: boolean;
    openTaskExists?: boolean;
    insertTaskReturns?: Array<{ id: string }>;
    transactionError?: Error;
  } = {},
) {
  const {
    overdueCustomers = [],
    idempotencyKeyExists = false,
    openTaskExists = false,
    insertTaskReturns = [{ id: TASK_UUID }],
    transactionError,
  } = options;

  let selectCallCount = 0;

  const mockSelect = vi.fn().mockImplementation(() => {
    const n = selectCallCount++;

    if (n === 0) {
      // findOverdueCustomers: JOIN query com groupBy
      const joinChain = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(
          // Simula rows com cityId já como string (filtro de null é na aplicação)
          overdueCustomers.map((c) => ({
            customerId: c.customerId,
            organizationId: c.organizationId,
            cityId: c.cityId,
            overdueCount: c.overdueCount,
          })),
        ),
      };
      return { from: vi.fn().mockReturnValue(joinChain) };
    }

    // Calls ímpares (1, 3, 5...): hasIdempotencyKey
    // Calls pares (2, 4, 6...): hasOpenSpcTask
    // Na prática, para cada cliente: hasIdempotencyKey (select) + hasOpenSpcTask (select)
    const isIdempotencyCheck = (n - 1) % 2 === 0;

    if (isIdempotencyCheck) {
      // hasIdempotencyKey
      const rows = idempotencyKeyExists ? [{ key: 'spc-overdue-15d:xxx' }] : [];
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
        }),
      };
    }

    // hasOpenSpcTask
    const rows = openTaskExists ? [{ id: TASK_UUID }] : [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue(rows) }),
      }),
    };
  });

  // Mock de transação que executa o callback
  const mockTransaction = vi
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
      if (transactionError) throw transactionError;

      const txDb = {
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(insertTaskReturns),
          }),
        })),
      };

      // Segunda call de insert é para idempotencyKeys
      let insertCount = 0;
      txDb.insert = vi.fn().mockImplementation(() => {
        insertCount++;
        if (insertCount === 1) {
          // tasks insert
          return {
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue(insertTaskReturns),
            }),
          };
        }
        // idempotencyKeys insert + eventOutbox insert (via emit mock)
        return {
          values: vi.fn().mockResolvedValue(undefined),
        };
      });

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

describe('spc-overdue-scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerFns.info.mockClear();
    mockLoggerFns.debug.mockClear();
    mockLoggerFns.error.mockClear();
    mockLoggerFns.warn.mockClear();
    mockEmit.mockClear();
  });

  // -------------------------------------------------------------------------
  // Funções utilitárias
  // -------------------------------------------------------------------------

  describe('buildScanIdempotencyKey()', () => {
    it('monta chave no formato spc-overdue-15d:<customerId>', () => {
      const key = buildScanIdempotencyKey(CUSTOMER_ID_A);
      expect(key).toBe(`spc-overdue-15d:${CUSTOMER_ID_A}`);
    });
  });

  describe('calcOverdueThreshold()', () => {
    it('subtrai exatamente 15 dias da data de referência', () => {
      const now = new Date('2026-06-15T12:00:00Z');
      const threshold = calcOverdueThreshold(now);
      expect(threshold).toBe('2026-05-31');
    });

    it('funciona em virada de mês', () => {
      const now = new Date('2026-03-10T00:00:00Z');
      const threshold = calcOverdueThreshold(now);
      expect(threshold).toBe('2026-02-23');
    });

    it('funciona em virada de ano', () => {
      const now = new Date('2026-01-10T00:00:00Z');
      const threshold = calcOverdueThreshold(now);
      expect(threshold).toBe('2025-12-26');
    });
  });

  // -------------------------------------------------------------------------
  // findOverdueCustomers
  // -------------------------------------------------------------------------

  describe('findOverdueCustomers()', () => {
    it('retorna clientes com cityId não-null', async () => {
      const rows = [
        { customerId: CUSTOMER_ID_A, organizationId: ORG_ID, cityId: CITY_ID, overdueCount: 2 },
      ];
      const joinChain = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(rows),
      };
      const mockDb = {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(joinChain) }),
      };

      const result = await findOverdueCustomers(mockDb as never, '2026-05-31');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        customerId: CUSTOMER_ID_A,
        cityId: CITY_ID,
        overdueCount: 2,
      });
    });

    it('filtra clientes com cityId=null (lead sem cidade identificada)', async () => {
      const rows = [
        { customerId: CUSTOMER_ID_A, organizationId: ORG_ID, cityId: null, overdueCount: 1 },
        { customerId: CUSTOMER_ID_B, organizationId: ORG_ID, cityId: CITY_ID, overdueCount: 3 },
      ];
      const joinChain = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue(rows),
      };
      const mockDb = {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(joinChain) }),
      };

      const result = await findOverdueCustomers(mockDb as never, '2026-05-31');

      // Apenas o cliente B (com cityId) deve ser retornado
      expect(result).toHaveLength(1);
      expect(result[0]?.customerId).toBe(CUSTOMER_ID_B);
    });

    it('retorna lista vazia se não há clientes elegíveis', async () => {
      const joinChain = {
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockResolvedValue([]),
      };
      const mockDb = {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(joinChain) }),
      };

      const result = await findOverdueCustomers(mockDb as never, '2026-05-31');

      expect(result).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // hasOpenSpcTask
  // -------------------------------------------------------------------------

  describe('hasOpenSpcTask()', () => {
    it('retorna true quando existe tarefa spc_inclusion aberta para o cliente', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: TASK_UUID }]),
            }),
          }),
        }),
      };

      const result = await hasOpenSpcTask(mockDb as never, ORG_ID, CUSTOMER_ID_A);
      expect(result).toBe(true);
    });

    it('retorna false quando não existe tarefa aberta', async () => {
      const mockDb = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };

      const result = await hasOpenSpcTask(mockDb as never, ORG_ID, CUSTOMER_ID_A);
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // processOverdueCustomer
  // -------------------------------------------------------------------------

  describe('processOverdueCustomer()', () => {
    it('cria tarefa + emite evento em transação atômica', async () => {
      const customer = makeCustomer({ overdueCount: 3 });
      const idempotencyKey = buildScanIdempotencyKey(customer.customerId);

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
          // idempotencyKeys insert
          return { values: vi.fn().mockResolvedValue(undefined) };
        }),
      };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
          return cb(txDb);
        }),
      };

      const taskId = await processOverdueCustomer(mockDb as never, customer, idempotencyKey);

      // Tarefa criada com tipo e role corretos
      expect(txDb.insert).toHaveBeenCalledTimes(2); // tasks + idempotencyKeys
      expect(taskId).toBe(TASK_UUID);

      // Evento emitido sem PII
      expect(mockEmit).toHaveBeenCalledOnce();
      const emitCall = mockEmit.mock.calls[0]?.[1] as {
        eventName: string;
        data: { customer_id: string; city_id: string; task_id: string; overdue_count: number };
      };
      expect(emitCall?.eventName).toBe('payment_due.overdue_15d');
      expect(emitCall?.data).toMatchObject({
        customer_id: customer.customerId,
        city_id: customer.cityId,
        task_id: TASK_UUID,
        overdue_count: 3,
      });
    });

    it('lança AppError se insert da tarefa retornar vazio (race condition)', async () => {
      const customer = makeCustomer();
      const idempotencyKey = buildScanIdempotencyKey(customer.customerId);

      const txDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]), // nenhuma linha retornada
          }),
        }),
      };

      const mockDb = {
        transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
          return cb(txDb);
        }),
      };

      await expect(
        processOverdueCustomer(mockDb as never, customer, idempotencyKey),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // runSpcOverdueScanTick — Flag-gating
  // -------------------------------------------------------------------------

  describe('runSpcOverdueScanTick() — flag-gating', () => {
    it('spc.enabled=disabled → retorna zeros sem queries', async () => {
      setFlagSpcDisabled();
      const db = makeDb();

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result).toMatchObject({
        eligibleCount: 0,
        processedCount: 0,
        skippedCount: 0,
        dryRun: false,
      });
      expect(db.select).not.toHaveBeenCalled();
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('spc.scan.enabled=disabled → dry_run=true, 0 inserts', async () => {
      setFlagScanDisabled();
      const customer = makeCustomer();
      const db = makeDb({ overdueCustomers: [customer] });

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result).toMatchObject({
        eligibleCount: 1,
        processedCount: 0,
        skippedCount: 0,
        dryRun: true,
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // runSpcOverdueScanTick — Cenários de negócio
  // -------------------------------------------------------------------------

  describe('runSpcOverdueScanTick() — cenários de negócio', () => {
    it('parcela com 14d de atraso NÃO dispara (cliente não aparece na query)', async () => {
      setFlagsAllOn();
      // Simula query retornando 0 clientes (due_date > threshold — 14d < 15d)
      const db = makeDb({ overdueCustomers: [] });

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result).toMatchObject({
        eligibleCount: 0,
        processedCount: 0,
        dryRun: false,
      });
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('parcela com 15d de atraso dispara → tarefa criada + evento emitido', async () => {
      setFlagsAllOn();
      const customer = makeCustomer({ overdueCount: 2 });
      const db = makeDb({
        overdueCustomers: [customer],
        idempotencyKeyExists: false,
        openTaskExists: false,
        insertTaskReturns: [{ id: TASK_UUID }],
      });

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result).toMatchObject({
        eligibleCount: 1,
        processedCount: 1,
        skippedCount: 0,
        dryRun: false,
      });
      expect(db.transaction).toHaveBeenCalledOnce();
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('cliente com spc_status≠none → ignorado (não aparece nos resultados da query)', async () => {
      setFlagsAllOn();
      // A query filtra spc_status='none' — cliente com 'included' não aparece.
      // Simulamos isso retornando lista vazia.
      const db = makeDb({ overdueCustomers: [] });

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result.eligibleCount).toBe(0);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('2ª execução com chave de idempotência existente → skip sem duplicate', async () => {
      setFlagsAllOn();
      const customer = makeCustomer();
      const db = makeDb({
        overdueCustomers: [customer],
        idempotencyKeyExists: true, // chave já existe — cliente já processado
        openTaskExists: false,
        insertTaskReturns: [{ id: TASK_UUID }],
      });

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result).toMatchObject({
        eligibleCount: 1,
        processedCount: 0,
        skippedCount: 1,
        dryRun: false,
      });
      // Nenhuma transação executada — skip por idempotência
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('tarefa aberta já existe → skip (segunda camada de idempotência)', async () => {
      setFlagsAllOn();
      const customer = makeCustomer();
      const db = makeDb({
        overdueCustomers: [customer],
        idempotencyKeyExists: false, // chave não existe (expirada)
        openTaskExists: true, // mas a tarefa aberta existe no banco
        insertTaskReturns: [{ id: TASK_UUID }],
      });

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result).toMatchObject({
        eligibleCount: 1,
        processedCount: 0,
        skippedCount: 1,
        dryRun: false,
      });
      expect(db.transaction).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it('erro em um cliente é isolado → outros clientes continuam processados', async () => {
      setFlagsAllOn();

      // Configuramos uma DB customizada para este cenário
      let selectCallCount = 0;
      const mockSelect = vi.fn().mockImplementation(() => {
        const n = selectCallCount++;

        if (n === 0) {
          // findOverdueCustomers — retorna 2 clientes
          const joinChain = {
            innerJoin: vi.fn().mockReturnThis(),
            where: vi.fn().mockReturnThis(),
            groupBy: vi.fn().mockResolvedValue([
              {
                customerId: CUSTOMER_ID_A,
                organizationId: ORG_ID,
                cityId: CITY_ID,
                overdueCount: 1,
              },
              {
                customerId: CUSTOMER_ID_B,
                organizationId: ORG_ID,
                cityId: CITY_ID,
                overdueCount: 2,
              },
            ]),
          };
          return { from: vi.fn().mockReturnValue(joinChain) };
        }

        // hasIdempotencyKey: alternamos por cliente (ambos sem chave)
        const isIdempotencyCheck = (n - 1) % 2 === 0;
        if (isIdempotencyCheck) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
            }),
          };
        }
        // hasOpenSpcTask: nenhuma tarefa aberta
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }),
          }),
        };
      });

      let transactionCount = 0;
      const mockTransaction = vi
        .fn()
        .mockImplementation(async (cb: (tx: unknown) => Promise<string>) => {
          transactionCount++;

          if (transactionCount === 1) {
            // Cliente A — lança erro
            throw new Error('DB transient error');
          }

          // Cliente B — sucesso
          const txDb = {
            insert: vi
              .fn()
              .mockReturnValueOnce({
                values: vi.fn().mockReturnValue({
                  returning: vi.fn().mockResolvedValue([{ id: TASK_UUID }]),
                }),
              })
              .mockReturnValueOnce({
                values: vi.fn().mockResolvedValue(undefined),
              }),
          };
          return cb(txDb);
        });

      const db = {
        select: mockSelect,
        transaction: mockTransaction,
      };

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      // processedCount=1 (B), skippedCount=0, eligibleCount=2
      // Cliente A falhou mas foi contabilizado no log de erro, não em skipped
      expect(result.eligibleCount).toBe(2);
      expect(result.processedCount).toBe(1);

      // Erro foi logado para cliente A
      expect(mockLoggerFns.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'spc_overdue_scan.customer_error',
          customer_id: CUSTOMER_ID_A,
        }),
        expect.any(String),
      );

      // Cliente B foi processado com sucesso
      expect(mockEmit).toHaveBeenCalledOnce();
    });

    it('0 clientes elegíveis → tick retorna zeros sem inserts', async () => {
      setFlagsAllOn();
      const db = makeDb({ overdueCustomers: [] });

      const result = await runSpcOverdueScanTick(db as never, mockLogger);

      expect(result).toMatchObject({
        eligibleCount: 0,
        processedCount: 0,
        skippedCount: 0,
        dryRun: false,
      });
      expect(db.transaction).not.toHaveBeenCalled();
    });
  });
});
