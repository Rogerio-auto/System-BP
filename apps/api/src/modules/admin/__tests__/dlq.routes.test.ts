// =============================================================================
// dlq.routes.test.ts — Testes das rotas admin DLQ (F1-S22).
//
// Casos testados:
//   1. GET /api/admin/dlq — apenas admin (dlq:manage) pode acessar.
//   2. GET /api/admin/dlq sem auth → 401.
//   3. GET /api/admin/dlq sem permissão → 403.
//   4. POST /api/admin/dlq/:id/replay — apenas admin + audit log.
//   5. POST /api/admin/dlq/:id/replay — DLQ entry não encontrada → 404.
//   6. POST /api/admin/dlq/:id/replay — DLQ entry já reprocessada → 409.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks via vi.hoisted para garantir que fns estejam disponíveis durante hoisting
// ---------------------------------------------------------------------------
const { mockListPendingDlq, mockFindDlqById, mockReplayFromDlq, mockAuditLog, authState } =
  vi.hoisted(() => {
    const authStateMut = {
      user: null as null | {
        id: string;
        organizationId: string;
        permissions: string[];
        cityScopeIds: null | string[];
      },
    };

    return {
      mockListPendingDlq: vi.fn(),
      mockFindDlqById: vi.fn(),
      mockReplayFromDlq: vi.fn(),
      mockAuditLog: vi.fn().mockResolvedValue('audit-log-id'),
      authState: authStateMut,
    };
  });

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: { Pool: mockPool }, Pool: mockPool };
});

// ---------------------------------------------------------------------------
// Mock db client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      }),
    ),
  },
}));

// ---------------------------------------------------------------------------
// Mock DLQ service
// ---------------------------------------------------------------------------
vi.mock('../../../services/outbox/dlq.js', () => ({
  listPendingDlq: (...args: unknown[]) => mockListPendingDlq(...args),
  findDlqById: (...args: unknown[]) => mockFindDlqById(...args),
  replayFromDlq: (...args: unknown[]) => mockReplayFromDlq(...args),
}));

// ---------------------------------------------------------------------------
// Mock audit
// ---------------------------------------------------------------------------
vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock auth middlewares
// ---------------------------------------------------------------------------
vi.mock('../../../modules/auth/middlewares/authenticate.js', () => ({
  authenticate: () => async (request: { user?: unknown }) => {
    if (!authState.user) {
      throw Object.assign(new Error('Token de acesso ausente ou mal formatado'), {
        name: 'AppError',
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });
    }
    request.user = authState.user;
  },
}));

vi.mock('../../../modules/auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) => async (request: { user?: { permissions: string[] } }) => {
      if (!request.user) {
        throw Object.assign(new Error('Não autenticado'), {
          name: 'AppError',
          statusCode: 401,
          code: 'UNAUTHORIZED',
        });
      }
      const missing = opts.permissions.filter(
        (p) => !request.user!.permissions.includes(p) && !request.user!.permissions.includes('*'),
      );
      if (missing.length > 0) {
        throw Object.assign(new Error('Acesso negado: permissões insuficientes'), {
          name: 'AppError',
          statusCode: 403,
          code: 'FORBIDDEN',
        });
      }
    },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: 'admin-uuid-0001',
  organizationId: 'org-uuid-0001',
  permissions: ['dlq:manage'],
  cityScopeIds: null as null,
};

const REGULAR_USER = {
  id: 'user-uuid-0001',
  organizationId: 'org-uuid-0001',
  permissions: ['leads:read'],
  cityScopeIds: null as null,
};

const setAuth = (user: typeof ADMIN_USER | typeof REGULAR_USER | null): void => {
  authState.user = user;
};

function makeDlqRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567891',
    originalEventId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567892',
    organizationId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567893',
    eventName: 'leads.created',
    eventVersion: 1,
    aggregateType: 'lead',
    aggregateId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567894',
    payload: { data: { lead_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567894' } },
    correlationId: null,
    totalAttempts: 5,
    lastError: 'Service Unavailable',
    reprocessed: false,
    reprocessEventId: null,
    movedAt: new Date('2026-01-01T00:00:00Z'),
    reprocessedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { adminDlqRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../dlq.routes.js'),
    import('../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    const code = (error as { code?: string }).code;
    if (error.statusCode === 401 || code === 'UNAUTHORIZED') {
      return reply.status(401).send({ error: 'UNAUTHORIZED', message: error.message });
    }
    if (error.statusCode === 403 || code === 'FORBIDDEN') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: error.message });
    }
    return reply
      .status(error.statusCode ?? 500)
      .send({ error: 'INTERNAL_ERROR', message: error.message });
  });

  await app.register(adminDlqRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/dlq', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
    setAuth(null);
  });

  it('returns 200 with list for admin user', async () => {
    setAuth(ADMIN_USER);
    mockListPendingDlq.mockResolvedValue([makeDlqRow()]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/dlq' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  it('returns 401 without authentication', async () => {
    setAuth(null);

    const res = await app.inject({ method: 'GET', url: '/api/admin/dlq' });

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for regular user without dlq:manage permission', async () => {
    setAuth(REGULAR_USER);

    const res = await app.inject({ method: 'GET', url: '/api/admin/dlq' });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/admin/dlq/:id/replay', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
    setAuth(null);
  });

  it('returns 200 with newEventId and registers audit log', async () => {
    setAuth(ADMIN_USER);
    mockFindDlqById.mockResolvedValue(makeDlqRow());
    mockReplayFromDlq.mockResolvedValue({ newEventId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/a1b2c3d4-e5f6-7890-abcd-ef1234567890/replay',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ newEventId: string; message: string }>();
    expect(body.newEventId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(body.message).toBe('Event queued for reprocessing');

    // Audit log deve ter sido chamado
    expect(mockAuditLog).toHaveBeenCalledOnce();
    const auditParams = mockAuditLog.mock.calls[0]?.[1] as { action: string };
    expect(auditParams.action).toBe('dlq.replay');
  });

  it('returns 404 when DLQ entry not found', async () => {
    setAuth(ADMIN_USER);
    mockFindDlqById.mockResolvedValue(undefined);

    // Valid UUID but non-existent entry
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/b2c3d4e5-f6a7-8901-bcde-f12345678901/replay',
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when DLQ entry already reprocessed', async () => {
    setAuth(ADMIN_USER);
    mockFindDlqById.mockResolvedValue(
      makeDlqRow({
        reprocessed: true,
        reprocessEventId: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
        reprocessedAt: new Date('2026-01-02T00:00:00Z'),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/dlq/a1b2c3d4-e5f6-7890-abcd-ef1234567890/replay',
    });

    expect(res.statusCode).toBe(409);
  });
});
