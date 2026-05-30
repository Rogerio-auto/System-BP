// =============================================================================
// cancel-collections-on-payment.test.ts — Testes do handler F5-S07.
//
// Cenários cobertos:
//   1. Parcela sem jobs scheduled → retorna jobsCancelled=0 (idempotente)
//   2. Parcela com 1 job scheduled → cancela, emite evento, audit log
//   3. Parcela com 2 jobs scheduled → cancela ambos
//   4. Re-execução (já cancelados) → no-op (idempotência)
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env
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
  lte: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
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
// Mock emit + auditLog
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('event-uuid');
vi.mock('../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Import das funções sob teste
// ---------------------------------------------------------------------------
import { cancelCollectionJobsOnPayment } from '../cancel-collections-on-payment.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = 'org-uuid-1';
const DUE_ID = 'due-uuid-1';
const JOB_ID_1 = 'job-uuid-1';
const JOB_ID_2 = 'job-uuid-2';
const RULE_ID = 'rule-uuid-1';

function makeDb(scheduledJobs: Array<{ id: string; ruleId: string }>) {
  const mockTx = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          for: vi.fn().mockResolvedValue(scheduledJobs),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    }),
  };

  return {
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(mockTx);
    }),
    _mockTx: mockTx,
  };
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('cancelCollectionJobsOnPayment()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sem jobs scheduled → retorna jobsCancelled=0 (idempotente)', async () => {
    const db = makeDb([]);

    const result = await cancelCollectionJobsOnPayment(db as never, {
      paymentDueId: DUE_ID,
      organizationId: ORG_ID,
    });

    expect(result.jobsCancelled).toBe(0);
    expect(result.paymentDueId).toBe(DUE_ID);
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
  });

  it('1 job scheduled → cancela, emite evento, audit log', async () => {
    const db = makeDb([{ id: JOB_ID_1, ruleId: RULE_ID }]);

    const result = await cancelCollectionJobsOnPayment(db as never, {
      paymentDueId: DUE_ID,
      organizationId: ORG_ID,
    });

    expect(result.jobsCancelled).toBe(1);

    // Verifica UPDATE foi chamado com status paid_before_send
    expect(db._mockTx.update).toHaveBeenCalledTimes(1);

    // Verifica emit foi chamado com evento correto
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'billing.collection_cancelled',
        data: expect.objectContaining({
          collection_job_id: JOB_ID_1,
          payment_due_id: DUE_ID,
          reason: 'paid_before_send',
        }),
        // Idempotency key canônica
        idempotencyKey: `billing.collection_cancelled:${JOB_ID_1}:paid`,
      }),
    );

    // Verifica audit log
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'billing.collection_cancelled_on_payment',
        resource: { type: 'collection_job', id: JOB_ID_1 },
      }),
    );
  });

  it('2 jobs scheduled → cancela ambos, emite 2 eventos', async () => {
    const db = makeDb([
      { id: JOB_ID_1, ruleId: RULE_ID },
      { id: JOB_ID_2, ruleId: RULE_ID },
    ]);

    const result = await cancelCollectionJobsOnPayment(db as never, {
      paymentDueId: DUE_ID,
      organizationId: ORG_ID,
    });

    expect(result.jobsCancelled).toBe(2);
    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockAuditLog).toHaveBeenCalledTimes(2);
  });

  it('correlationId propagado nos eventos', async () => {
    const db = makeDb([{ id: JOB_ID_1, ruleId: RULE_ID }]);

    await cancelCollectionJobsOnPayment(db as never, {
      paymentDueId: DUE_ID,
      organizationId: ORG_ID,
      correlationId: 'corr-123',
    });

    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        correlationId: 'corr-123',
      }),
    );
  });

  it('re-execução com jobs já cancelados → no-op (SELECT retorna [])', async () => {
    // Simula que jobs já foram cancelados em execução anterior
    const db = makeDb([]);

    const result = await cancelCollectionJobsOnPayment(db as never, {
      paymentDueId: DUE_ID,
      organizationId: ORG_ID,
    });

    expect(result.jobsCancelled).toBe(0);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
