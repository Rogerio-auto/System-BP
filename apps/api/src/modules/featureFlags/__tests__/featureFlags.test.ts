// =============================================================================
// featureFlags.test.ts — Testes de integração do módulo feature flags (F1-S23).
//
// Estratégia: sobe Fastify com apenas as rotas de feature flags.
//   - pg mockado para evitar conexão real com Postgres.
//   - Repositório mockado para retornar dados controlados.
//   - JWT/auth mockado via user context fixo.
//
// Testes cobertos:
//   1. GET /api/admin/feature-flags → 200 com lista de flags
//   2. GET /api/admin/feature-flags sem auth → 401
//   3. GET /api/admin/feature-flags sem permissão → 403
//   4. PATCH /api/admin/feature-flags/:key → 200 com flag atualizada
//   5. PATCH /api/admin/feature-flags/:key — flag não existe → 404
//   6. GET /api/feature-flags/me → 200 com mapa filtrado
//   7. GET /api/feature-flags/me sem auth → 401
//   8. featureGate middleware — flag enabled → continua (200)
//   9. featureGate middleware — flag disabled → 403 FEATURE_DISABLED
//  10. featureGate middleware — flag internal_only sem role → 404 FEATURE_HIDDEN
//  11. POST /internal/feature-flags/check — token válido → 200
//  12. POST /internal/feature-flags/check — token inválido → 403
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi, beforeAll } from 'vitest';

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
// Mock repositório
// ---------------------------------------------------------------------------
const mockListAllFlags = vi.fn();
const mockFindFlagByKey = vi.fn();
const mockUpdateFlag = vi.fn();

vi.mock('../repository.js', () => ({
  listAllFlags: (...args: unknown[]) => mockListAllFlags(...args),
  findFlagByKey: (...args: unknown[]) => mockFindFlagByKey(...args),
  updateFlag: (...args: unknown[]) => mockUpdateFlag(...args),
}));

// ---------------------------------------------------------------------------
// Mock db client (precisa existir antes dos imports de rota)
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({ insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }) }),
    ),
  },
}));

// ---------------------------------------------------------------------------
// Mock emit (outbox) — não queremos inserir no banco real
// ---------------------------------------------------------------------------
vi.mock('../../../events/emit.js', () => ({
  emit: vi.fn().mockResolvedValue('mock-event-id'),
}));

// ---------------------------------------------------------------------------
// Mock de autenticação — simula authenticate() e authorize() para testes isolados.
// Usa objeto mutável para contornar hoisting do vi.mock.
// ---------------------------------------------------------------------------

// Objeto mutável — vi.mock factories capturam referência, não valor
const authState = {
  user: null as null | {
    id: string;
    organizationId: string;
    permissions: string[];
    cityScopeIds: null;
  },
};

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

const ADMIN_USER = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  organizationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  permissions: ['flags:manage', 'admin'],
  cityScopeIds: null as null,
};

const REGULAR_USER = {
  id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  organizationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  permissions: ['leads:read'],
  cityScopeIds: null as null,
};

// Alias de conveniência
const setAuth = (user: typeof ADMIN_USER | null): void => {
  authState.user = user;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeFlag = (overrides?: Record<string, unknown>) => ({
  key: 'followup.enabled',
  status: 'disabled' as const,
  visible: true,
  uiLabel: 'Disponível na Fase 5',
  description: 'Régua de follow-up automático',
  audience: {},
  updatedBy: null,
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  ...overrides,
});

const FIXTURE_FLAGS = [
  makeFlag({ key: 'crm.enabled', status: 'enabled', uiLabel: null }),
  makeFlag({ key: 'followup.enabled', status: 'disabled' }),
  makeFlag({
    key: 'ai.internal_assistant.enabled',
    status: 'internal_only',
    audience: { roles: ['admin'] },
  }),
];

// ---------------------------------------------------------------------------
// Invalidar cache entre testes (o cache do service é module-level)
// ---------------------------------------------------------------------------
beforeAll(async () => {
  const { invalidateFlagCache } = await import('../service.js');
  invalidateFlagCache();
});

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { featureFlagsRoutes },
    { internalFeatureFlagsRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
    import('../../internal/featureFlags/routes.js'),
    import('../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = { error: error.code, message: error.message };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
    }
    // Handle mock errors (plain Error with statusCode/code attached by auth mocks)
    const mockErr = error as {
      statusCode?: number;
      code?: string;
      name?: string;
      message?: string;
    };
    if (mockErr.name === 'AppError' && mockErr.statusCode !== undefined) {
      return reply.status(mockErr.statusCode).send({
        error: mockErr.code ?? 'ERROR',
        message: mockErr.message ?? 'Error',
      });
    }
    if (
      error !== null &&
      typeof error === 'object' &&
      'validation' in error &&
      (error as Record<string, unknown>)['validation'] !== undefined
    ) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Validation failed' });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(featureFlagsRoutes);
  await app.register(internalFeatureFlagsRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/feature-flags', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();
    app = await buildTestApp();
    mockListAllFlags.mockResolvedValue(FIXTURE_FLAGS);
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
    setAuth(null);
  });

  it('retorna 200 com lista de flags para admin', async () => {
    setAuth(ADMIN_USER);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/feature-flags',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ key: string; status: string }[]>();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
    expect(body[0]).toMatchObject({ key: 'crm.enabled', status: 'enabled' });
  });

  it('retorna 401 sem autenticação', async () => {
    setAuth(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/feature-flags',
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 403 sem permissão flags:manage', async () => {
    setAuth(REGULAR_USER);

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/feature-flags',
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('PATCH /api/admin/feature-flags/:key', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();
    setAuth(ADMIN_USER);
    app = await buildTestApp();
    mockListAllFlags.mockResolvedValue(FIXTURE_FLAGS);
    mockFindFlagByKey.mockResolvedValue(makeFlag());
    mockUpdateFlag.mockResolvedValue(makeFlag({ status: 'enabled' }));
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
    setAuth(null);
  });

  it('atualiza flag e retorna 200', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/feature-flags/followup.enabled',
      payload: { status: 'enabled' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ key: string; status: string }>();
    expect(body.status).toBe('enabled');
  });

  it('retorna 404 se flag não existe', async () => {
    mockListAllFlags.mockResolvedValue([]);

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/feature-flags/non.existent',
      payload: { status: 'enabled' },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NOT_FOUND');
  });

  it('retorna 400 com status inválido', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/feature-flags/followup.enabled',
      payload: { status: 'invalid_status' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/feature-flags/me', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();
    app = await buildTestApp();
    mockListAllFlags.mockResolvedValue(FIXTURE_FLAGS);
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
    setAuth(null);
  });

  it('retorna mapa de flags para usuário autenticado', async () => {
    setAuth(REGULAR_USER);

    const res = await app.inject({
      method: 'GET',
      url: '/api/feature-flags/me',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, string>>();
    expect(typeof body).toBe('object');
    // crm.enabled está habilitada
    expect(body['crm.enabled']).toBe('enabled');
    // followup.enabled está desabilitada
    expect(body['followup.enabled']).toBe('disabled');
    // internal_only sem role → não incluída
    expect(body['ai.internal_assistant.enabled']).toBeUndefined();
  });

  it('retorna 401 sem autenticação', async () => {
    setAuth(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/feature-flags/me',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('featureGate middleware (via mock route)', () => {
  async function buildGateTestApp(
    userCtx: typeof REGULAR_USER,
    flagKey: string,
    flagStatus: string,
    audience: Record<string, unknown> = {},
  ): Promise<FastifyInstance> {
    const [
      { default: Fastify },
      { serializerCompiler, validatorCompiler },
      { featureGate },
      { isAppError },
    ] = await Promise.all([
      import('fastify'),
      import('fastify-type-provider-zod'),
      import('../../../plugins/featureGate.js'),
      import('../../../shared/errors.js'),
    ]);

    mockListAllFlags.mockResolvedValue([makeFlag({ key: flagKey, status: flagStatus, audience })]);

    const app = Fastify({ logger: false }).withTypeProvider();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    // Inject user directly (no JWT needed in featureGate tests)
    app.addHook('preHandler', async (request) => {
      request.user = userCtx;
    });

    app.setErrorHandler((error, _req, reply) => {
      if (isAppError(error)) {
        return reply.status(error.statusCode).send({ error: error.code });
      }
      return reply.status(500).send({ error: 'INTERNAL_ERROR' });
    });

    app.get('/test', { preHandler: [featureGate(flagKey)] }, async (_req, reply) => {
      await reply.status(200).send({ ok: true });
    });

    return app;
  }

  afterEach(async () => {
    vi.clearAllMocks();
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();
  });

  it('flag enabled → request continua (200)', async () => {
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();
    const app = await buildGateTestApp(REGULAR_USER, 'followup.enabled', 'enabled');
    const res = await app.inject({ method: 'GET', url: '/test' });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it('flag disabled → 403 FEATURE_DISABLED', async () => {
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();
    const app = await buildGateTestApp(REGULAR_USER, 'followup.enabled', 'disabled');
    const res = await app.inject({ method: 'GET', url: '/test' });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: string }>().error).toBe('FEATURE_DISABLED');
  });

  it('flag internal_only sem role → 404 FEATURE_HIDDEN', async () => {
    const { invalidateFlagCache } = await import('../service.js');
    invalidateFlagCache();
    // REGULAR_USER tem permissions: ['leads:read'] — sem 'admin' → sem acesso
    const app = await buildGateTestApp(
      REGULAR_USER,
      'ai.internal_assistant.enabled',
      'internal_only',
      { roles: ['admin'] },
    );
    const res = await app.inject({ method: 'GET', url: '/test' });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: string }>().error).toBe('FEATURE_HIDDEN');
  });
});

// The internal token is read from env.LANGGRAPH_INTERNAL_TOKEN.
// We mock the config/env.js module to control the token value.
vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LANGGRAPH_INTERNAL_TOKEN: 'test-internal-token-32-chars-minimum!!',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
  },
}));

describe('POST /internal/feature-flags/check', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    setAuth(null);
    app = await buildTestApp();
    mockListAllFlags.mockResolvedValue([makeFlag({ key: 'followup.enabled', status: 'disabled' })]);
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('retorna 200 com status correto quando token é válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/feature-flags/check',
      headers: {
        'x-internal-token': 'test-internal-token-32-chars-minimum!!',
      },
      payload: { key: 'followup.enabled' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ key: string; status: string; enabled: boolean }>();
    expect(body.key).toBe('followup.enabled');
    expect(body.enabled).toBe(false);
    expect(body.status).toBe('disabled');
  });

  it('retorna 403 com token inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/feature-flags/check',
      headers: { 'x-internal-token': 'wrong-token' },
      payload: { key: 'followup.enabled' },
    });

    expect(res.statusCode).toBe(403);
  });
});
