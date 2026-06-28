// =============================================================================
// roles/__tests__/routes.test.ts — Testes de integração de rotas de roles.
//
// Cobre:
//   GET  /api/admin/roles
//     1. Retorna 200 com lista de roles incluindo permissions[]
//     2. Retorna 403 sem permissão users:manage
//   GET  /api/admin/permissions
//     3. Retorna 200 com catálogo agrupado por module
//     4. Retorna 403 sem permissão users:manage
//   PUT  /api/admin/roles/:id/permissions
//     5. Retorna 200 com RoleResponse atualizado (substituição bem-sucedida)
//     6. Retorna 404 quando role não existe
//     7. Retorna 422 ao tentar editar o role admin (anti-lockout)
//     8. Retorna 422 com keys inválidas no body
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
const mockListPermissions = vi.fn();
const mockUpdateRolePermissionsService = vi.fn();

vi.mock('../service.js', () => ({
  listRoles: (...args: unknown[]) => mockListRoles(...args),
  listPermissions: (...args: unknown[]) => mockListPermissions(...args),
  updateRolePermissionsService: (...args: unknown[]) => mockUpdateRolePermissionsService(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const FIXTURE_ACTOR_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FIXTURE_ROLE_ID = 'd4e5f6a7-b8c9-0123-defa-234567890123';

const FIXTURE_ROLES = [
  {
    id: FIXTURE_ROLE_ID,
    key: 'admin',
    name: 'Administrador',
    scope: 'global',
    description: 'Acesso total ao sistema',
    permissions: ['audit:read', 'users:manage'],
  },
  {
    id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
    key: 'agente',
    name: 'Agente',
    scope: 'city',
    description: null,
    permissions: ['leads:read'],
  },
];

const FIXTURE_PERMISSIONS = [
  { key: 'leads:read', description: 'Listar leads', module: 'CRM & Leads' },
  { key: 'audit:read', description: 'Ler logs de auditoria', module: 'Administração' },
  { key: 'users:manage', description: 'Gerenciar usuários', module: 'Administração' },
];

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(permissions: string[] = ['users:manage']): Promise<FastifyInstance> {
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
      permissions,
      cityScopeIds: null,
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = { error: error.code, message: error.message };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
    }
    if (
      error !== null &&
      typeof error === 'object' &&
      'validation' in error &&
      (error as Record<string, unknown>)['validation'] !== undefined
    ) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: (error as Record<string, unknown>)['validation'],
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(rolesRoutes);

  return app;
}

// ===========================================================================
// GET /api/admin/roles
// ===========================================================================

describe('GET /api/admin/roles', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['users:manage']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 com lista de roles incluindo permissions[]', async () => {
    mockListRoles.mockResolvedValue({ data: FIXTURE_ROLES });

    const res = await app.inject({ method: 'GET', url: '/api/admin/roles' });

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
      permissions: ['audit:read', 'users:manage'],
    });

    const agente = body.data[1];
    expect(agente).toMatchObject({
      key: 'agente',
      scope: 'city',
      description: null,
      permissions: ['leads:read'],
    });
  });

  it('chama listRoles com o db injetado', async () => {
    mockListRoles.mockResolvedValue({ data: [] });

    await app.inject({ method: 'GET', url: '/api/admin/roles' });

    expect(mockListRoles).toHaveBeenCalledOnce();
  });
});

describe('GET /api/admin/roles — sem permissão', () => {
  let appNoPerms: FastifyInstance;

  beforeAll(async () => {
    appNoPerms = await buildTestApp(['leads:read']);
  });

  afterAll(async () => {
    await appNoPerms.close();
  });

  it('retorna 403 sem users:manage', async () => {
    const res = await appNoPerms.inject({ method: 'GET', url: '/api/admin/roles' });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// GET /api/admin/permissions
// ===========================================================================

describe('GET /api/admin/permissions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['users:manage']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 com catálogo de permissões agrupado por module', async () => {
    mockListPermissions.mockResolvedValue({ data: FIXTURE_PERMISSIONS });

    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: typeof FIXTURE_PERMISSIONS }>();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(3);

    const first = body.data[0];
    expect(first).toMatchObject({
      key: expect.any(String),
      description: expect.any(String),
      module: expect.any(String),
    });
  });

  it('retorna campos key, description e module em cada item', async () => {
    mockListPermissions.mockResolvedValue({ data: FIXTURE_PERMISSIONS });

    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions' });

    const body = res.json<{ data: typeof FIXTURE_PERMISSIONS }>();
    const leadsItem = body.data.find((p) => p.key === 'leads:read');
    expect(leadsItem).toMatchObject({
      key: 'leads:read',
      description: 'Listar leads',
      module: 'CRM & Leads',
    });
  });

  it('retorna 200 com data vazio quando catálogo está vazio', async () => {
    mockListPermissions.mockResolvedValue({ data: [] });

    const res = await app.inject({ method: 'GET', url: '/api/admin/permissions' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
  });
});

describe('GET /api/admin/permissions — sem permissão', () => {
  let appNoPerms: FastifyInstance;

  beforeAll(async () => {
    appNoPerms = await buildTestApp(['leads:read']);
  });

  afterAll(async () => {
    await appNoPerms.close();
  });

  it('retorna 403 sem users:manage', async () => {
    const res = await appNoPerms.inject({ method: 'GET', url: '/api/admin/permissions' });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// PUT /api/admin/roles/:id/permissions
// ===========================================================================

describe('PUT /api/admin/roles/:id/permissions — sucesso', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['users:assign_privileged_roles']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 com RoleResponse atualizado', async () => {
    const updatedRole = {
      id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
      key: 'agente',
      name: 'Agente',
      scope: 'city',
      description: null,
      permissions: ['leads:read', 'leads:write'],
    };
    mockUpdateRolePermissionsService.mockResolvedValue(updatedRole);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/roles/${updatedRole.id}/permissions`,
      payload: { permissions: ['leads:read', 'leads:write'] },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: updatedRole.id,
      key: 'agente',
      permissions: ['leads:read', 'leads:write'],
    });
  });

  it('chama updateRolePermissionsService com roleId e body corretos', async () => {
    mockUpdateRolePermissionsService.mockResolvedValue({
      id: 'e5f6a7b8-c9d0-1234-efab-345678901234',
      key: 'agente',
      name: 'Agente',
      scope: 'city',
      description: null,
      permissions: ['leads:read'],
    });

    await app.inject({
      method: 'PUT',
      url: `/api/admin/roles/e5f6a7b8-c9d0-1234-efab-345678901234/permissions`,
      payload: { permissions: ['leads:read'] },
    });

    expect(mockUpdateRolePermissionsService).toHaveBeenCalledOnce();
    const call = mockUpdateRolePermissionsService.mock.calls[0];
    expect(call?.[2]).toBe('e5f6a7b8-c9d0-1234-efab-345678901234'); // roleId
    expect(call?.[3]).toEqual({ permissions: ['leads:read'] }); // body
  });

  it('retorna 400 quando params.id não é UUID válido', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/roles/not-a-uuid/permissions',
      payload: { permissions: [] },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/admin/roles/:id/permissions — 404 role inexistente', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['users:assign_privileged_roles']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 404 quando role não existe', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateRolePermissionsService.mockRejectedValue(new NotFoundError('Papel não encontrado'));

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/roles/${FIXTURE_ROLE_ID}/permissions`,
      payload: { permissions: [] },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('NOT_FOUND');
  });
});

describe('PUT /api/admin/roles/:id/permissions — 422 admin imutável', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['users:assign_privileged_roles']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 422 ao tentar editar o role admin', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockUpdateRolePermissionsService.mockRejectedValue(
      new AppError(
        422,
        'VALIDATION_ERROR',
        'O papel Administrador não pode ser editado (acesso total).',
      ),
    );

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/roles/${FIXTURE_ROLE_ID}/permissions`,
      payload: { permissions: ['users:manage'] },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.message).toContain('Administrador');
  });
});

describe('PUT /api/admin/roles/:id/permissions — 422 keys inválidas', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['users:assign_privileged_roles']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 422 com lista de keys inválidas no details', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockUpdateRolePermissionsService.mockRejectedValue(
      new AppError(422, 'VALIDATION_ERROR', 'Permissões inválidas no catálogo', {
        invalidKeys: ['fake:permission', 'nonexistent:action'],
      }),
    );

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/roles/e5f6a7b8-c9d0-1234-efab-345678901234/permissions`,
      payload: { permissions: ['leads:read', 'fake:permission', 'nonexistent:action'] },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string; details: { invalidKeys: string[] } }>();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.details.invalidKeys).toContain('fake:permission');
    expect(body.details.invalidKeys).toContain('nonexistent:action');
  });
});
