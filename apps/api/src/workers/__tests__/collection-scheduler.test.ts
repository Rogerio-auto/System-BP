// =============================================================================
// collection-scheduler.test.ts — Testes do worker F5-S07 (scheduler).
//
// Estratégia: injeção de db mock + mock de isFlagEnabled.
//   Todos os efeitos colaterais (inserts, flag reads) são mockados.
//
// Cenários cobertos:
//   1. Flag billing.enabled=disabled → 0 queries, 0 inserts
//   2. Flag billing.scheduler.enabled=disabled → dry_run=true, 0 inserts
//   3. Flags ON + regra ativa days_before_due → jobs criados para parcelas pending
//   4. Flags ON + regra ativa days_after_due → jobs criados para parcelas overdue
//   5. Idempotência: ON CONFLICT DO NOTHING — job não duplicado
//   6. Nenhuma regra ativa → tick retorna []
//   7. buildCollectionIdempotencyKey() → formato correto
//   8. calcTargetDate() → days_before_due e days_after_due calculados corretamente
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
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  lte: vi.fn((_col: unknown, val: unknown) => ({ __lte: val })),
  or: vi.fn((...args: unknown[]) => ({ __or: args })),
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
// Import das funções sob teste
// ---------------------------------------------------------------------------
import {
  buildCollectionIdempotencyKey,
  calcTargetDate,
  findEligibleDues,
  processCollectionRule,
  runCollectionSchedulerTick,
} from '../collection-scheduler.js';
import type { EligibleDue, SchedulerLogger } from '../collection-scheduler.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const DUE_ID_A = '22222222-2222-2222-2222-222222222222';
const DUE_ID_B = '33333333-3333-3333-3333-333333333333';
const RULE_ID = 'aaaa0001-0000-0000-0000-000000000001';
const TEMPLATE_ID = 'bbbb0002-0000-0000-0000-000000000002';

function makeRule(
  overrides: Partial<{
    id: string;
    key: string;
    channelId: string | null;
    triggerType: 'days_before_due' | 'days_after_due';
    waitHours: number;
    isActive: boolean;
    appliesToStatus: 'pending' | 'overdue' | 'paid' | 'renegotiated' | 'cancelled' | null;
  }> = {},
) {
  return {
    id: overrides.id ?? RULE_ID,
    organizationId: ORG_ID,
    channelId: overrides.channelId !== undefined ? overrides.channelId : null,
    key: overrides.key ?? 'd7',
    name: 'Cobrança D+7',
    triggerType: overrides.triggerType ?? 'days_after_due',
    waitHours: overrides.waitHours ?? 168,
    templateId: TEMPLATE_ID,
    appliesToStatus: overrides.appliesToStatus !== undefined ? overrides.appliesToStatus : null,
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    maxAttempts: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeDb(
  options: {
    activeRules?: ReturnType<typeof makeRule>[];
    eligibleDues?: EligibleDue[];
    insertReturns?: Array<{ id: string }>;
    startsFromRulesSelect?: boolean;
  } = {},
) {
  const {
    activeRules = [],
    eligibleDues = [],
    insertReturns = [{ id: 'job-uuid-1' }],
    startsFromRulesSelect = true,
  } = options;

  let selectCallCount = 0;

  const mockInsertResult = {
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(insertReturns),
    values: vi.fn().mockReturnThis(),
  };

  const mockInsert = vi.fn().mockReturnValue(mockInsertResult);

  const mockSelect = vi.fn().mockImplementation(() => {
    const n = selectCallCount++;
    const isRulesSelect = startsFromRulesSelect && n === 0;

    if (isRulesSelect) {
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(activeRules),
        }),
      };
    }

    // Select de payment_dues
    const dueRows = eligibleDues.map((d) => ({
      paymentDueId: d.paymentDueId,
      organizationId: d.organizationId,
      dueDate: d.dueDate,
    }));

    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(dueRows),
      }),
    };
  });

  return {
    select: mockSelect,
    insert: mockInsert,
    _mockInsertResult: mockInsertResult,
  };
}

const mockLoggerFns = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const mockLogger = mockLoggerFns as unknown as SchedulerLogger;

// ---------------------------------------------------------------------------
// Helpers de flag
// ---------------------------------------------------------------------------

function setFlagsAllOn() {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'billing.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    if (flagKey === 'billing.scheduler.enabled')
      return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

function setFlagBillingDisabled() {
  mockIsFlagEnabled.mockImplementation(() =>
    Promise.resolve({ enabled: false, status: 'disabled' }),
  );
}

function setFlagSchedulerDisabled() {
  mockIsFlagEnabled.mockImplementation((_db: unknown, flagKey: string) => {
    if (flagKey === 'billing.enabled') return Promise.resolve({ enabled: true, status: 'enabled' });
    return Promise.resolve({ enabled: false, status: 'disabled' });
  });
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('collection-scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoggerFns.info.mockClear();
    mockLoggerFns.debug.mockClear();
    mockLoggerFns.error.mockClear();
    mockLoggerFns.warn.mockClear();
  });

  // -------------------------------------------------------------------------
  // Funções utilitárias
  // -------------------------------------------------------------------------

  describe('buildCollectionIdempotencyKey()', () => {
    it('monta chave no formato due_date:rule_key', () => {
      const key = buildCollectionIdempotencyKey('2026-06-15', 'd7');
      expect(key).toBe('2026-06-15:d7');
    });

    it('funciona com diferentes keys', () => {
      expect(buildCollectionIdempotencyKey('2026-06-15', 'd-3')).toBe('2026-06-15:d-3');
      expect(buildCollectionIdempotencyKey('2026-06-15', 'd0')).toBe('2026-06-15:d0');
    });
  });

  describe('calcTargetDate()', () => {
    it('days_after_due com wait_hours=168 → subtrai 7 dias de hoje', () => {
      const now = new Date('2026-06-22T12:00:00Z');
      const rule = makeRule({ triggerType: 'days_after_due', waitHours: 168 });
      const target = calcTargetDate(rule, now);
      expect(target).toBe('2026-06-15');
    });

    it('days_before_due com wait_hours=-72 → soma 3 dias de hoje', () => {
      const now = new Date('2026-06-12T12:00:00Z');
      const rule = makeRule({ triggerType: 'days_before_due', waitHours: -72 });
      const target = calcTargetDate(rule, now);
      expect(target).toBe('2026-06-15');
    });

    it('days_after_due com wait_hours=0 → target é hoje', () => {
      const now = new Date('2026-06-15T12:00:00Z');
      const rule = makeRule({ triggerType: 'days_after_due', waitHours: 0 });
      const target = calcTargetDate(rule, now);
      expect(target).toBe('2026-06-15');
    });
  });

  // -------------------------------------------------------------------------
  // Flag-gating
  // -------------------------------------------------------------------------

  describe('runCollectionSchedulerTick()', () => {
    it('billing.enabled=disabled → retorna [] sem queries', async () => {
      setFlagBillingDisabled();
      const db = makeDb();

      const results = await runCollectionSchedulerTick(db as never, mockLogger);

      expect(results).toEqual([]);
      expect(db.select).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('billing.scheduler.enabled=disabled → dry_run=true, 0 inserts', async () => {
      setFlagSchedulerDisabled();
      const rule = makeRule();
      const due: EligibleDue = {
        paymentDueId: DUE_ID_A,
        organizationId: ORG_ID,
        dueDate: '2026-06-15',
      };
      const db = makeDb({ activeRules: [rule], eligibleDues: [due] });

      const results = await runCollectionSchedulerTick(db as never, mockLogger);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        ruleKey: 'd7',
        duesMatched: 1,
        jobsCreated: 0,
        dryRun: true,
      });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('flags ON + regra ativa → jobs criados', async () => {
      setFlagsAllOn();
      const rule = makeRule();
      const dues: EligibleDue[] = [
        { paymentDueId: DUE_ID_A, organizationId: ORG_ID, dueDate: '2026-06-15' },
        { paymentDueId: DUE_ID_B, organizationId: ORG_ID, dueDate: '2026-06-15' },
      ];
      const db = makeDb({
        activeRules: [rule],
        eligibleDues: dues,
        insertReturns: [{ id: 'job-1' }],
      });

      const results = await runCollectionSchedulerTick(db as never, mockLogger);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        ruleKey: 'd7',
        duesMatched: 2,
        jobsCreated: 2,
        dryRun: false,
      });
      expect(db.insert).toHaveBeenCalledTimes(2);
    });

    it('nenhuma regra ativa → tick retorna []', async () => {
      setFlagsAllOn();
      const db = makeDb({ activeRules: [] });

      const results = await runCollectionSchedulerTick(db as never, mockLogger);

      expect(results).toEqual([]);
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('idempotência: ON CONFLICT DO NOTHING → jobs_created=0 quando conflito', async () => {
      setFlagsAllOn();
      const rule = makeRule();
      const due: EligibleDue = {
        paymentDueId: DUE_ID_A,
        organizationId: ORG_ID,
        dueDate: '2026-06-15',
      };
      // insertReturns=[] simula DO NOTHING (nenhum id retornado = conflito)
      const db = makeDb({ activeRules: [rule], eligibleDues: [due], insertReturns: [] });

      const results = await runCollectionSchedulerTick(db as never, mockLogger);

      expect(results[0]).toMatchObject({ jobsCreated: 0, dryRun: false });
    });

    it('erro em uma regra não para o tick (continua com próxima)', async () => {
      setFlagsAllOn();
      const rule1 = makeRule({ id: 'rule-1', key: 'd7' });
      const rule2 = makeRule({ id: 'rule-2', key: 'd15' });

      let callCount = 0;
      const db = {
        select: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            // rules select
            return {
              from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([rule1, rule2]) }),
            };
          }
          if (callCount === 2) {
            // rule1 dues — lança erro
            return {
              from: vi
                .fn()
                .mockReturnValue({ where: vi.fn().mockRejectedValue(new Error('DB error')) }),
            };
          }
          // rule2 dues — ok
          return {
            from: vi.fn().mockReturnValue({
              where: vi
                .fn()
                .mockResolvedValue([
                  { paymentDueId: DUE_ID_A, organizationId: ORG_ID, dueDate: '2026-06-15' },
                ]),
            }),
          };
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnThis(),
          onConflictDoNothing: vi.fn().mockReturnThis(),
          returning: vi.fn().mockResolvedValue([{ id: 'job-1' }]),
        }),
      };

      const results = await runCollectionSchedulerTick(db as never, mockLogger);

      // rule1 gerou erro, rule2 processou com sucesso
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ ruleKey: 'd15', jobsCreated: 1 });
      expect(mockLoggerFns.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'collection_scheduler.rule_error', rule_key: 'd7' }),
        expect.any(String),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findEligibleDues
  // -------------------------------------------------------------------------

  describe('findEligibleDues()', () => {
    it('days_after_due → busca status=overdue', async () => {
      const rule = makeRule({ triggerType: 'days_after_due', waitHours: 168 });
      const dueRows = [{ paymentDueId: DUE_ID_A, organizationId: ORG_ID, dueDate: '2026-06-15' }];

      const mockWhere = vi.fn().mockResolvedValue(dueRows);
      const db = {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: mockWhere }) }),
      };

      const result = await findEligibleDues(db as never, rule, '2026-06-15');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ paymentDueId: DUE_ID_A });
    });

    it('days_before_due → busca status=pending', async () => {
      const rule = makeRule({ triggerType: 'days_before_due', waitHours: -72 });
      const dueRows = [{ paymentDueId: DUE_ID_B, organizationId: ORG_ID, dueDate: '2026-06-15' }];

      const mockWhere = vi.fn().mockResolvedValue(dueRows);
      const db = {
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: mockWhere }) }),
      };

      const result = await findEligibleDues(db as never, rule, '2026-06-15');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ paymentDueId: DUE_ID_B });
    });
  });

  // -------------------------------------------------------------------------
  // processCollectionRule
  // -------------------------------------------------------------------------

  describe('processCollectionRule()', () => {
    it('dryRun=true → retorna resultado sem chamar insert', async () => {
      const rule = makeRule();
      const due: EligibleDue = {
        paymentDueId: DUE_ID_A,
        organizationId: ORG_ID,
        dueDate: '2026-06-15',
      };
      const db = makeDb({ eligibleDues: [due], startsFromRulesSelect: false });

      const result = await processCollectionRule(db as never, rule, true);

      expect(result).toMatchObject({ ruleKey: 'd7', duesMatched: 1, jobsCreated: 0, dryRun: true });
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('dryRun=false + parcela elegível → cria job com idempotency_key correto', async () => {
      const rule = makeRule({ key: 'd7' });
      const due: EligibleDue = {
        paymentDueId: DUE_ID_A,
        organizationId: ORG_ID,
        dueDate: '2026-06-15',
      };
      const db = makeDb({
        eligibleDues: [due],
        startsFromRulesSelect: false,
        insertReturns: [{ id: 'job-uuid-abc' }],
      });

      const result = await processCollectionRule(db as never, rule, false);

      expect(result).toMatchObject({ jobsCreated: 1, dryRun: false });

      // Verificar idempotency_key
      const insertValues = db._mockInsertResult.values.mock.calls[0]?.[0] as {
        idempotencyKey?: string;
      };
      expect(insertValues?.idempotencyKey).toBe('2026-06-15:d7');
    });
  });
});
