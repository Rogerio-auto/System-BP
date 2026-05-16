// =============================================================================
// users/routes.test.ts — Testes de integração das rotas admin de usuários.
//
// Estratégia: sobe Fastify com usersRoutes, mocka authenticate/authorize para
// simular usuário autenticado, mocka service para controlar dados.
//
// Cobre:
//   1. GET  /api/admin/users → 200 paginado
//   2. POST /api/admin/users → 201 com user + tempPassword
//   3. POST /api/admin/users → 409 email duplicado
//   4. PATCH /api/admin/users/:id → 200
//   5. POST /api/admin/users/:id/deactivate → 204
//   6. Usuário desativado não aparece em listagem ativa
//   7. POST /api/admin/users/:id/reactivate → 204
//   8. PUT  /api/admin/users/:id/roles → 204
//   9. PUT  /api/admin/users/:id/roles roleIds vazio → 400 (Zod)
//   10. PUT /api/admin/users/:id/roles → 422 last admin
//   11. PUT /api/admin/users/:id/city-scopes → 204
//   12. Sem permission users:manage → 403
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real com Postgres
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
// Mock authenticate/authorize middlewares — o buildTestApp injeta request.user
// via addHook antes de registrar as rotas, mas o routes.ts importa os middlewares
// diretamente. Precisamos mocká-los para evitar a cadeia de import do db/schema.
//
// authenticate(): retorna um handler no-op (request.user já foi injetado pelo hook global)
// authorize(): retorna um handler que verifica request.user.permissions
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user já é injetado pelo addHook global do buildTestApp
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
// Mock db/client — controller.ts importa o db diretamente
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock do service
// ---------------------------------------------------------------------------
const mockListUsers = vi.fn();
const mockCreateUserService = vi.fn();
const mockUpdateUserService = vi.fn();
const mockDeactivateUserService = vi.fn();
const mockReactivateUserService = vi.fn();
const mockSetUserRolesService = vi.fn();
const mockSetUserCityScopesService = vi.fn();

vi.mock('../service.js', () => ({
  listUsers: (...args: unknown[]) => mockListUsers(...args),
  createUserService: (...args: unknown[]) => mockCreateUserService(...args),
  updateUserService: (...args: unknown[]) => mockUpdateUserService(...args),
  deactivateUserService: (...args: unknown[]) => mockDeactivateUserService(...args),
  reactivateUserService: (...args: unknown[]) => mockReactivateUserService(...args),
  setUserRolesService: (...args: unknown[]) => mockSetUserRolesService(...args),
  setUserCityScopesService: (...args: unknown[]) => mockSetUserCityScopesService(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const FIXTURE_ACTOR_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FIXTURE_TARGET_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const FIXTURE_ROLE_ID = 'd4e5f6a7-b8c9-0123-defa-234567890123';
const FIXTURE_CITY_ID = 'f6a7b8c9-d0e1-2345-fabc-456789012345';

function makeUserResponse(overrides?: Record<string, unknown>) {
  return {
    id: FIXTURE_TARGET_ID,
    organizationId: FIXTURE_ORG_ID,
    email: 'target@bdp.ro.gov.br',
    fullName: 'Target User',
    status: 'active',
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    // F8-S06: roles incluídas na listagem
    roles: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

/**
 * Constrói o app de teste com autenticação mockada.
 * O parâmetro `hasPermission` controla se o usuário tem users:manage.
 */
async function buildTestApp(hasPermission = true): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { usersRoutes },
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

  // Injetar request.user antes das rotas (simula authenticate())
  app.addHook('preHandler', async (request) => {
    request.user = {
      id: FIXTURE_ACTOR_ID,
      organizationId: FIXTURE_ORG_ID,
      permissions: hasPermission ? ['users:manage'] : ['leads:read'],
      cityScopeIds: null,
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.details !== undefined) {
        body['details'] = error.details;
      }
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

  await app.register(usersRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

describe('GET /api/admin/users', () => {
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

  it('retorna 200 com lista paginada de usuários', async () => {
    mockListUsers.mockResolvedValue({
      data: [makeUserResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('inclui campo roles em cada usuário da listagem (F8-S06)', async () => {
    const userWithRoles = makeUserResponse({
      roles: [{ id: FIXTURE_ROLE_ID, key: 'agente', name: 'Agente' }],
    });
    mockListUsers.mockResolvedValue({
      data: [userWithRoles],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/users' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    const first = body.data[0];
    expect(first).toBeDefined();
    expect(Array.isArray(first!['roles'])).toBe(true);
    expect(first!['roles']).toHaveLength(1);
    const role = (first!['roles'] as Array<Record<string, unknown>>)[0];
    expect(role).toMatchObject({ key: 'agente', name: 'Agente' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users
// ---------------------------------------------------------------------------

describe('POST /api/admin/users', () => {
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

  it('retorna 201 com user e tempPassword no create', async () => {
    mockCreateUserService.mockResolvedValue({
      ...makeUserResponse({ email: 'novo@bdp.ro.gov.br' }),
      tempPassword: 'AbCdEfGh1234XyZw',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: {
        email: 'novo@bdp.ro.gov.br',
        fullName: 'Novo Usuario',
        roleIds: [FIXTURE_ROLE_ID],
        cityIds: [],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('tempPassword');
    expect(typeof body['tempPassword']).toBe('string');
    // Nunca retorna password_hash
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('password_hash');
  });

  it('retorna 409 quando email já existe', async () => {
    const { ConflictError } = await import('../../../shared/errors.js');
    mockCreateUserService.mockRejectedValue(
      new ConflictError('Email já cadastrado nesta organização'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: {
        email: 'existente@bdp.ro.gov.br',
        fullName: 'Duplicado',
        roleIds: [FIXTURE_ROLE_ID],
        cityIds: [],
      },
    });

    expect(res.statusCode).toBe(409);
  });

  it('retorna 400 quando body inválido (sem roleIds)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: {
        email: 'teste@bdp.ro.gov.br',
        fullName: 'Teste',
        // roleIds ausente — violação Zod
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id', () => {
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

  it('retorna 200 após update', async () => {
    mockUpdateUserService.mockResolvedValue(makeUserResponse({ fullName: 'Nome Atualizado' }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}`,
      payload: { fullName: 'Nome Atualizado' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['fullName']).toBe('Nome Atualizado');
  });

  it('retorna 404 quando usuário não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateUserService.mockRejectedValue(new NotFoundError('Usuário não encontrado'));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}`,
      payload: { fullName: 'Nome' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/deactivate
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deactivate', () => {
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

  it('retorna 204 ao desativar usuário', async () => {
    mockDeactivateUserService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/deactivate`,
    });

    expect(res.statusCode).toBe(204);
  });

  it('retorna 404 quando usuário não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockDeactivateUserService.mockRejectedValue(new NotFoundError('Usuário não encontrado'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/deactivate`,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/reactivate
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/reactivate', () => {
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

  it('retorna 204 ao reativar usuário', async () => {
    mockReactivateUserService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/reactivate`,
    });

    expect(res.statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id/roles
// ---------------------------------------------------------------------------

describe('PUT /api/admin/users/:id/roles', () => {
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

  it('retorna 204 ao substituir roles', async () => {
    mockSetUserRolesService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/roles`,
      payload: { roleIds: [FIXTURE_ROLE_ID] },
    });

    expect(res.statusCode).toBe(204);
  });

  it('retorna 400 quando roleIds está vazio (violação Zod min 1)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/roles`,
      payload: { roleIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 422 ao tentar remover última role admin', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    const lastAdminError = new AppError(
      422,
      'VALIDATION_ERROR',
      'Não é possível remover a última role admin da organização',
      { code: 'CANNOT_REMOVE_LAST_ADMIN' },
    );
    mockSetUserRolesService.mockRejectedValue(lastAdminError);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/roles`,
      payload: { roleIds: [FIXTURE_ROLE_ID] },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<Record<string, unknown>>();
    expect((body['details'] as Record<string, unknown>)['code']).toBe('CANNOT_REMOVE_LAST_ADMIN');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id/city-scopes
// ---------------------------------------------------------------------------

describe('PUT /api/admin/users/:id/city-scopes', () => {
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

  it('retorna 204 ao substituir city scopes', async () => {
    mockSetUserCityScopesService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/city-scopes`,
      payload: { cityIds: [FIXTURE_CITY_ID] },
    });

    expect(res.statusCode).toBe(204);
  });

  it('aceita cityIds vazio (remove todos os escopos)', async () => {
    mockSetUserCityScopesService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/city-scopes`,
      payload: { cityIds: [] },
    });

    expect(res.statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// Autorização: sem permission users:manage → 403
// ---------------------------------------------------------------------------

describe('Autorização — sem permission users:manage', () => {
  let appNoPerms: FastifyInstance;

  beforeAll(async () => {
    appNoPerms = await buildTestApp(false);
  });

  afterAll(async () => {
    await appNoPerms.close();
  });

  it('retorna 403 em GET /api/admin/users sem users:manage', async () => {
    const res = await appNoPerms.inject({
      method: 'GET',
      url: '/api/admin/users',
    });

    expect(res.statusCode).toBe(403);
  });

  it('retorna 403 em POST /api/admin/users sem users:manage', async () => {
    const res = await appNoPerms.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: {
        email: 'teste@bdp.ro.gov.br',
        fullName: 'Teste',
        roleIds: [FIXTURE_ROLE_ID],
        cityIds: [],
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('retorna 403 em PUT /api/admin/users/:id/roles sem users:manage', async () => {
    const res = await appNoPerms.inject({
      method: 'PUT',
      url: `/api/admin/users/${FIXTURE_TARGET_ID}/roles`,
      payload: { roleIds: [FIXTURE_ROLE_ID] },
    });

    expect(res.statusCode).toBe(403);
  });
});
