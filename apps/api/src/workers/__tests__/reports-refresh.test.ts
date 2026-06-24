// =============================================================================
// reports-refresh.test.ts -- Testes unitarios do worker F23-S01.
// Cenarios:
//   1. Flag dashboard.enabled=false -> retorna [] sem query ao pool.
//   2. Advisory lock nao adquirido -> retorna [] sem REFRESH.
//   3. Tick normal: lock adquirido -> refresha as 5 MVs + unlock.
//   4. Falha em 1 MV nao interrompe as demais.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

const mockIsFlagEnabled = vi.fn();
vi.mock('../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
  invalidateFlagCache: vi.fn(),
}));

import type { RefreshResult } from '../reports-refresh.js';
import { runReportsRefreshTick } from '../reports-refresh.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePoolClient(opts: { lockAcquired?: boolean } = {}) {
  const { lockAcquired = true } = opts;
  return {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock')) {
        return Promise.resolve({ rows: [{ acquired: lockAcquired }] });
      }
      if (sql.includes('pg_advisory_unlock')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('REFRESH MATERIALIZED VIEW')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
}

function makePool(
  client: ReturnType<typeof makePoolClient>,
): Parameters<typeof runReportsRefreshTick>[1] {
  return { connect: vi.fn().mockResolvedValue(client) } as unknown as Parameters<
    typeof runReportsRefreshTick
  >[1];
}

function makeMockDb(): Parameters<typeof runReportsRefreshTick>[0] {
  return {} as unknown as Parameters<typeof runReportsRefreshTick>[0];
}
// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('runReportsRefreshTick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. flag dashboard.enabled=false -> retorna [] sem tocar no pool', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });
    const client = makePoolClient();
    const pool = makePool(client);
    const db = makeMockDb();

    const results = await runReportsRefreshTick(db, pool);

    expect(results).toEqual([]);
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });
  it('2. advisory lock nao adquirido -> retorna [] sem REFRESH', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    const client = makePoolClient({ lockAcquired: false });
    const pool = makePool(client);
    const db = makeMockDb();

    const results = await runReportsRefreshTick(db, pool);

    expect(results).toEqual([]);
    const lockCall = (client.query.mock.calls as string[][]).find(
      (c) => typeof c[0] === 'string' && c[0].includes('pg_try_advisory_lock'),
    );
    expect(lockCall).toBeDefined();
    const refreshCalls = (client.query.mock.calls as string[][]).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('REFRESH'),
    );
    expect(refreshCalls).toHaveLength(0);
    expect(client.release).toHaveBeenCalled();
  });
  it('3. tick normal: refresha todas as 5 MVs e libera lock', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    const client = makePoolClient({ lockAcquired: true });
    const pool = makePool(client);
    const db = makeMockDb();

    const results = await runReportsRefreshTick(db, pool);

    expect(results).toHaveLength(5);
    expect(results.every((r: RefreshResult) => r.success)).toBe(true);

    const mvNames = results.map((r: RefreshResult) => r.mv);
    expect(mvNames).toContain('mv_reports_overview');
    expect(mvNames).toContain('mv_reports_funnel');
    expect(mvNames).toContain('mv_reports_stage_dwell');
    expect(mvNames).toContain('mv_reports_credit');
    expect(mvNames).toContain('mv_reports_collection');

    const unlockCalls = (client.query.mock.calls as string[][]).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock'),
    );
    expect(unlockCalls).toHaveLength(1);
    expect(client.release).toHaveBeenCalled();
  });
  it('4. falha em 1 MV nao interrompe as demais', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    let callCount = 0;
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve({ rows: [{ acquired: true }] });
        }
        if (sql.includes('pg_advisory_unlock')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('REFRESH MATERIALIZED VIEW')) {
          callCount++;
          if (callCount === 1) {
            return Promise.reject(new Error('disk full'));
          }
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Parameters<
      typeof runReportsRefreshTick
    >[1];
    const db = makeMockDb();

    const results = await runReportsRefreshTick(db, pool);

    expect(results).toHaveLength(5);
    expect(results[0]!.success).toBe(false);
    expect(results[0]!.error).toBe('disk full');
    expect(results.slice(1).every((r: RefreshResult) => r.success)).toBe(true);

    const unlockCalls = (client.query.mock.calls as string[][]).filter(
      (c) => typeof c[0] === 'string' && c[0].includes('pg_advisory_unlock'),
    );
    expect(unlockCalls).toHaveLength(1);
  });
});
