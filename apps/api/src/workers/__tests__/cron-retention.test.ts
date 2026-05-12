// =============================================================================
// cron-retention.test.ts — Testes do job de retenção LGPD (F1-S25).
//
// Estratégia: mock de db.client + anonymize service.
//   - runRetention é exportada explicitamente do cron-retention.ts para testes.
//   - main() só é chamado em execução direta (guarda de process.argv).
//   - Todos os imports de drizzle são mockados para evitar conexões reais.
//
// Cenários:
//   1. Dry-run com dados simulados → conta mas não executa anonimização
//   2. Leads sem operação > 90 dias → anonimizeLead chamado
//   3. Customers sem operação > 5 anos → anonymizeCustomer chamado
//   4. runRetention retorna success=true sem erros quando sem dados
//   5. retention_runs é inserido com started_at e affected_counts
//   6. Erros parciais em anonimização → success=false + errors populados
// =============================================================================
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (MUST be first)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
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

vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock anonymize service
// ---------------------------------------------------------------------------
const mockAnonymizeCustomer = vi.fn().mockResolvedValue('customer-id');
const mockAnonymizeLead = vi.fn().mockResolvedValue('lead-id');

vi.mock('../../services/lgpd/anonymize.js', () => ({
  anonymizeCustomer: (...args: unknown[]) => mockAnonymizeCustomer(...args),
  anonymizeLead: (...args: unknown[]) => mockAnonymizeLead(...args),
}));

// ---------------------------------------------------------------------------
// DB mock state
// ---------------------------------------------------------------------------
interface MockDbState {
  leadsToAnon: Array<{ id: string; organizationId: string }>;
  customersToAnon: Array<{ id: string; organizationId: string }>;
  insertedRetentionRuns: unknown[];
}

const dbState: MockDbState = {
  leadsToAnon: [],
  customersToAnon: [],
  insertedRetentionRuns: [],
};

// ---------------------------------------------------------------------------
// Mock db client with stateful select returns
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => {
  // selectSequence tracks which select call we're on
  const state = { calls: 0 };

  const mockInsert = vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation((vals: unknown) => {
      dbState.insertedRetentionRuns.push(vals);
      return Promise.resolve([]);
    }),
  }));

  const mockDelete = vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue({ rowCount: 0 }),
  });

  const mockUpdate = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });

  function makeSelect() {
    return vi.fn().mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          const n = state.calls++;
          // count queries (interactions, sessions) return [{count: 0}]
          if (n >= 2) return Promise.resolve([{ count: 0 }]);
          // Return a thenable + .limit() chain for entity queries
          const rows = n === 0 ? dbState.leadsToAnon : dbState.customersToAnon;
          const chain = {
            limit: vi.fn().mockResolvedValue(rows),
            then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(rows).then(onFulfilled),
            catch: (onRejected: (e: unknown) => unknown) => Promise.resolve(rows).catch(onRejected),
          };
          return chain;
        }),
      }),
    }));
  }

  const mockTx = {
    select: makeSelect(),
    insert: mockInsert,
    delete: mockDelete,
    update: mockUpdate,
  };

  return {
    db: {
      select: makeSelect(),
      insert: mockInsert,
      delete: mockDelete,
      update: mockUpdate,
      transaction: vi
        .fn()
        .mockImplementation(async (fn: (tx: typeof mockTx) => unknown) => fn(mockTx)),
      _state: state, // expose for reset
    },
  };
});

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cron-retention', () => {
  beforeEach(async () => {
    dbState.leadsToAnon = [];
    dbState.customersToAnon = [];
    dbState.insertedRetentionRuns = [];
    mockAnonymizeCustomer.mockClear();
    mockAnonymizeLead.mockClear();
    Object.values(mockLogger).forEach((fn) => {
      if (typeof fn === 'function') fn.mockClear?.();
    });
    delete process.env['RETENTION_DRY_RUN'];

    // Reset the call counter in the db mock
    const { db } = await import('../../db/client.js');
    (db as unknown as { _state: { calls: number } })._state.calls = 0;
  });

  afterEach(() => {
    delete process.env['RETENTION_DRY_RUN'];
  });

  // ---- 1. Dry-run ----
  it('1. Dry-run: não executa anonimização mesmo com leads elegíveis', async () => {
    dbState.leadsToAnon = [
      { id: 'lead-01', organizationId: 'org-01' },
      { id: 'lead-02', organizationId: 'org-01' },
    ];

    const { runRetention } = await import('../cron-retention.js');
    const result = await runRetention(mockLogger as unknown as Parameters<typeof runRetention>[0], {
      dryRun: true,
    });

    expect(result.counts.leads_anonymized).toBe(2);
    expect(mockAnonymizeLead).not.toHaveBeenCalled();
  });

  // ---- 2. Leads > 90 dias ----
  it('2. Leads sem operação > 90 dias são anonimizados (não dry-run)', async () => {
    dbState.leadsToAnon = [{ id: 'lead-old-01', organizationId: 'org-01' }];

    const { runRetention } = await import('../cron-retention.js');
    const result = await runRetention(mockLogger as unknown as Parameters<typeof runRetention>[0], {
      dryRun: false,
    });

    expect(mockAnonymizeLead).toHaveBeenCalledTimes(1);
    expect(result.counts.leads_anonymized).toBe(1);
  });

  // ---- 3. Customers > 5 anos ----
  it('3. Customers sem operação > 5 anos são anonimizados', async () => {
    dbState.customersToAnon = [{ id: 'cust-old-01', organizationId: 'org-01' }];

    const { runRetention } = await import('../cron-retention.js');
    const result = await runRetention(mockLogger as unknown as Parameters<typeof runRetention>[0], {
      dryRun: false,
    });

    expect(mockAnonymizeCustomer).toHaveBeenCalledTimes(1);
    expect(result.counts.customers_anonymized).toBe(1);
  });

  // ---- 4. success=true sem dados ----
  it('4. runRetention retorna success=true com 0 erros quando não há dados', async () => {
    const { runRetention } = await import('../cron-retention.js');
    const result = await runRetention(mockLogger as unknown as Parameters<typeof runRetention>[0], {
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // ---- 5. retention_runs inserido ----
  it('5. retention_runs é inserido com started_at e affected_counts', async () => {
    const { runRetention } = await import('../cron-retention.js');
    await runRetention(mockLogger as unknown as Parameters<typeof runRetention>[0], {
      dryRun: true,
    });

    expect(dbState.insertedRetentionRuns.length).toBeGreaterThanOrEqual(1);
    const run = dbState.insertedRetentionRuns[0] as {
      startedAt: Date;
      affectedCounts: Record<string, number>;
      errors: unknown[];
    };
    expect(run.startedAt).toBeInstanceOf(Date);
    expect(typeof run.affectedCounts).toBe('object');
    expect(Array.isArray(run.errors)).toBe(true);
    // Deve incluir as categorias corretas
    expect('leads_anonymized' in run.affectedCounts).toBe(true);
    expect('customers_anonymized' in run.affectedCounts).toBe(true);
  });

  // ---- 6. Erros parciais ----
  it('6. Erros parciais em anonimização → success=false + errors populados', async () => {
    dbState.leadsToAnon = [{ id: 'lead-fail-01', organizationId: 'org-01' }];
    mockAnonymizeLead.mockRejectedValueOnce(new Error('FK constraint violation'));

    const { runRetention } = await import('../cron-retention.js');
    const result = await runRetention(mockLogger as unknown as Parameters<typeof runRetention>[0], {
      dryRun: false,
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const err = result.errors[0] as { entity_type: string; entity_id: string; error: string };
    expect(err.entity_type).toBe('lead');
    expect(err.entity_id).toBe('lead-fail-01');
    expect(err.error).toContain('FK constraint violation');
  });
});
