// =============================================================================
// requireFlag.test.ts — Testes do helper de worker requireFlag (F1-S23).
//
// Testes cobertos:
//   1. Flag enabled → retorna true, não loga skip
//   2. Flag disabled → retorna false, loga evento job.skipped_feature_disabled
//   3. Flag internal_only com roles corretas → retorna true
//   4. Flag desconhecida → retorna false (fail-closed)
// =============================================================================
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock repositório de flags
// ---------------------------------------------------------------------------
const mockListAllFlags = vi.fn();

vi.mock('../repository.js', () => ({
  listAllFlags: (...args: unknown[]) => mockListAllFlags(...args),
  findFlagByKey: vi.fn(),
  updateFlag: vi.fn(),
}));

vi.mock('../../../db/client.js', () => ({
  db: {},
}));

vi.mock('../../../config/env.js', () => ({
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
    LANGGRAPH_INTERNAL_TOKEN: 'test-token-min-32-chars-xxxxxxxxxxxx',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeFlag = (overrides?: Record<string, unknown>) => ({
  key: 'followup.enabled',
  status: 'disabled' as const,
  visible: true,
  uiLabel: null,
  description: null,
  audience: {},
  updatedBy: null,
  updatedAt: new Date(),
  createdAt: new Date(),
  ...overrides,
});

function makeSilentLogger(): pino.Logger {
  return pino({ level: 'silent' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requireFlag()', () => {
  it('retorna true quando flag está enabled', async () => {
    mockListAllFlags.mockResolvedValue([makeFlag({ status: 'enabled' })]);

    const { requireFlag } = await import('../../../lib/featureFlags.js');
    const { db } = await import('../../../db/client.js');

    // Bypass cache para teste isolado
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();

    const logger = makeSilentLogger();
    const result = await requireFlag(db as never, 'followup.enabled', logger, 'job-123');

    expect(result).toBe(true);
  });

  it('retorna false e loga quando flag está disabled', async () => {
    mockListAllFlags.mockResolvedValue([makeFlag({ status: 'disabled' })]);

    const { requireFlag } = await import('../../../lib/featureFlags.js');
    const { db } = await import('../../../db/client.js');
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();

    const logger = makeSilentLogger();
    const infoSpy = vi.spyOn(logger, 'info');

    const result = await requireFlag(db as never, 'followup.enabled', logger, 'job-456');

    expect(result).toBe(false);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'job.skipped_feature_disabled',
        flag: 'followup.enabled',
        flag_status: 'disabled',
        job_id: 'job-456',
      }),
      expect.any(String),
    );
  });

  it('retorna false para flag desconhecida (fail-closed)', async () => {
    mockListAllFlags.mockResolvedValue([]);

    const { requireFlag } = await import('../../../lib/featureFlags.js');
    const { db } = await import('../../../db/client.js');
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();

    const logger = makeSilentLogger();
    const result = await requireFlag(db as never, 'non.existent.flag', logger);

    expect(result).toBe(false);
  });

  it('retorna true para flag internal_only com roles corretas', async () => {
    mockListAllFlags.mockResolvedValue([
      makeFlag({ status: 'internal_only', audience: { roles: ['admin'] } }),
    ]);

    const { isFlagEnabled } = await import('../service.js');
    const { db } = await import('../../../db/client.js');
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();

    const { enabled } = await isFlagEnabled(db as never, 'followup.enabled', ['admin']);
    expect(enabled).toBe(true);
  });
});
