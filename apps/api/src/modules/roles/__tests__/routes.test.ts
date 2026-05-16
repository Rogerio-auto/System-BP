// =============================================================================
// roles/__tests__/routes.test.ts — Testes de integração de GET /api/admin/roles.
//
// Cobre:
//   1. GET /api/admin/roles → 200 com lista de roles (id, key, name, scope)
//   2. GET /api/admin/roles → 403 sem permissão users:admin
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
// Mock authenticate/authorize
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo hook global
  },
}));

vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) =>
    async (request: { user?: { permissions: string[] } }, _reply: unknown) => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      if (!request.user) throw new ForbiddenError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockListRoles = vi.fn();

vi.mock('../service.js', () => ({
  listRoles: (...args: unknown[]) => mockListRoles(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const FIXTURE_ACTOR_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const FIXTURE_ROLES = [
  {
    id: 'd4e5f6a7-b8c9-0123-defa-234567890123',
    key: 'admin',
    name: 'Administrador',
    scope: 'global',
    description: 'Acesso total ao sistema',
  },
  {
    id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
    key: 'agente',
    name: 'Agente',
    scope: 'city',
    description: null,
  },
];

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(hasPermission = true): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { rolesRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
    import('../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('preHandler', async (request) => {
    request.user = {
      id: FIXTURE_ACTOR_ID,
      organizationId: FIXTURE_ORG_ID,
      permissions: hasPermission ? ['users:admin'] : ['leads:read'],
      cityScopeIds: null,
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = { error: error.code, message: error.message };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
    }
    if (error.validation !== undefined) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.validation,
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(rolesRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// GET /api/admin/roles — positivo
// ---------------------------------------------------------------------------

describe('GET /api/admin/roles', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 com lista de roles (id, key, name, scope, description)', async () => {
    mockListRoles.mockResolvedValue({ data: FIXTURE_ROLES });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/roles',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: typeof FIXTURE_ROLES }>();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);

    const admin = body.data[0];
    expect(admin).toMatchObject({
      id: expect.any(String),
      key: 'admin',
      name: 'Administrador',
      scope: 'global',
    });

    const agente = body.data[1];
    expect(agente).toMatchObject({
      key: 'agente',
      scope: 'city',
      description: null,
    });
  });

  it('chama listRoles com o db injetado', async () => {
    mockListRoles.mockResolvedValue({ data: [] });

    await app.inject({ method: 'GET', url: '/api/admin/roles' });

    expect(mockListRoles).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/roles — 403 sem permissão
// ---------------------------------------------------------------------------

describe('GET /api/admin/roles — sem permissão', () => {
  let appNoPerms: FastifyInstance;

  beforeAll(async () => {
    appNoPerms = await buildTestApp(false);
  });

  afterAll(async () => {
    await appNoPerms.close();
  });

  it('retorna 403 sem users:admin', async () => {
    const res = await appNoPerms.inject({
      method: 'GET',
      url: '/api/admin/roles',
    });

    expect(res.statusCode).toBe(403);
  });
});
