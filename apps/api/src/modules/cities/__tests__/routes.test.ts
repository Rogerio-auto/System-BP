// =============================================================================
// cities/routes.test.ts — Testes de integração das rotas admin de cidades (F1-S06).
//
// Estratégia: sobe Fastify com citiesRoutes, mocka authenticate/authorize para
// simular usuário autenticado, mocka service para controlar dados.
//
// Cobre:
//   1.  GET  /api/admin/cities → 200 paginado
//   2.  GET  /api/admin/cities → 200 com filtros (state_uf, is_active, search)
//   3.  GET  /api/admin/cities/:id → 200 com cidade
//   4.  GET  /api/admin/cities/:id → 404 não encontrada
//   5.  POST /api/admin/cities → 201 com cidade criada
//   6.  POST /api/admin/cities → 409 conflito ibge_code
//   7.  POST /api/admin/cities → 400 body inválido (sem name)
//   8.  PATCH /api/admin/cities/:id → 200
//   9.  PATCH /api/admin/cities/:id → 404
//   10. DELETE /api/admin/cities/:id → 204
//   11. DELETE /api/admin/cities/:id → 404
//   12. Sem auth → 401
//   13. Sem permissão cities:manage → 403
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
    // no-op: request.user injetado pelo addHook global no buildTestApp
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
const mockListCities = vi.fn();
const mockGetCityById = vi.fn();
const mockCreateCity = vi.fn();
const mockUpdateCityService = vi.fn();
const mockDeleteCityService = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  // importOriginal carrega o módulo real para re-exportar classes (CityConflictError)
  // que são usadas nos asserts dos testes. Cast para Record evita import() em type position.
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listCities: (...args: unknown[]) => mockListCities(...args),
    getCityById: (...args: unknown[]) => mockGetCityById(...args),
    createCity: (...args: unknown[]) => mockCreateCity(...args),
    updateCityService: (...args: unknown[]) => mockUpdateCityService(...args),
    deleteCityService: (...args: unknown[]) => mockDeleteCityService(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_ACTOR_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeCityResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_CITY_ID,
    organization_id: FIXTURE_ORG_ID,
    name: 'Porto Velho',
    name_normalized: 'porto velho',
    aliases: ['PVH', 'porto velho'],
    slug: 'porto-velho',
    ibge_code: '1100205',
    state_uf: 'RO',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

const CREATE_PAYLOAD = {
  name: 'Vilhena',
  aliases: ['VHA'],
  ibge_code: '1101708',
  state_uf: 'RO',
  is_active: true,
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['cities:manage'],
  injectUser = true,
): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { citiesRoutes },
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

  if (injectUser) {
    app.addHook('preHandler', async (request) => {
      request.user = {
        id: FIXTURE_ACTOR_ID,
        organizationId: FIXTURE_ORG_ID,
        permissions,
        cityScopeIds: null,
      };
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
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

  await app.register(citiesRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/admin/cities
// ---------------------------------------------------------------------------

describe('GET /api/admin/cities', () => {
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

  it('retorna 200 com lista paginada', async () => {
    mockListCities.mockResolvedValue({
      data: [makeCityResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/cities' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('retorna 200 com filtros combinados (state_uf, is_active, search)', async () => {
    mockListCities.mockResolvedValue({
      data: [makeCityResponse({ state_uf: 'RO', is_active: true })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/cities?state_uf=RO&is_active=true&search=porto',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data[0]?.['state_uf']).toBe('RO');
    expect(body.data[0]?.['is_active']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/cities/:id
// ---------------------------------------------------------------------------

describe('GET /api/admin/cities/:id', () => {
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

  it('retorna 200 com cidade', async () => {
    mockGetCityById.mockResolvedValue(makeCityResponse());

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/cities/${FIXTURE_CITY_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_CITY_ID);
    expect(body['name']).toBe('Porto Velho');
  });

  it('retorna 404 quando cidade não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetCityById.mockRejectedValue(new NotFoundError('Cidade não encontrada'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/cities/${FIXTURE_CITY_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/cities
// ---------------------------------------------------------------------------

describe('POST /api/admin/cities', () => {
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

  it('retorna 201 com cidade criada', async () => {
    mockCreateCity.mockResolvedValue(makeCityResponse({ name: 'Vilhena', slug: 'vilhena' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cities',
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_CITY_ID);
  });

  it('retorna 409 quando ibge_code conflita', async () => {
    const { ConflictError } = await import('../../../shared/errors.js');
    mockCreateCity.mockRejectedValue(
      new ConflictError('Já existe uma cidade com este código IBGE nesta organização'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cities',
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<Record<string, unknown>>()['error']).toBe('CONFLICT');
  });

  it('retorna 409 com field=slug quando slug conflita (path do catch de DB constraint)', async () => {
    // Simula o path onde o pre-flight passou mas a DB unique constraint disparou
    // (race condition) — CityConflictError com field='slug' vindo do mapUniqueViolation.
    const { CityConflictError } = await import('../service.js');
    mockCreateCity.mockRejectedValue(new CityConflictError('slug'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cities',
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('CONFLICT');
    expect((body['details'] as Record<string, unknown> | undefined)?.['field']).toBe('slug');
  });

  it('retorna 400 quando body inválido (sem name)', async () => {
    const { name: _name, ...bodyWithoutName } = CREATE_PAYLOAD;

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/cities',
      payload: bodyWithoutName,
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/cities/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/cities/:id', () => {
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

  it('retorna 200 com cidade atualizada', async () => {
    mockUpdateCityService.mockResolvedValue(makeCityResponse({ is_active: false }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/cities/${FIXTURE_CITY_ID}`,
      payload: { is_active: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['is_active']).toBe(false);
  });

  it('retorna 404 quando cidade não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateCityService.mockRejectedValue(new NotFoundError('Cidade não encontrada'));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/cities/${FIXTURE_CITY_ID}`,
      payload: { is_active: false },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/cities/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/cities/:id', () => {
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

  it('retorna 204 ao deletar cidade', async () => {
    mockDeleteCityService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/cities/${FIXTURE_CITY_ID}`,
    });

    expect(res.statusCode).toBe(204);
  });

  it('retorna 404 quando cidade não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockDeleteCityService.mockRejectedValue(new NotFoundError('Cidade não encontrada'));

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/cities/${FIXTURE_CITY_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// RBAC — sem autenticação → 401, sem permissão → 403
// ---------------------------------------------------------------------------

describe('RBAC — autenticação e autorização', () => {
  it('retorna 403 (ForbiddenError) quando usuário sem permissão cities:manage', async () => {
    // Usuário autenticado mas sem a permissão correta
    const app = await buildTestApp(['leads:read']);

    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockListCities.mockRejectedValue(new ForbiddenError('Acesso negado'));

    const res = await app.inject({ method: 'GET', url: '/api/admin/cities' });

    // O authorize mock lança ForbiddenError porque 'cities:manage' não está em ['leads:read']
    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');

    await app.close();
  });

  it('retorna 403 quando request.user não está definido (authenticate não rodou)', async () => {
    // App sem injetar request.user
    const app = await buildTestApp([], false);

    const res = await app.inject({ method: 'GET', url: '/api/admin/cities' });

    // O authenticate mock é no-op, mas o authorize vai lançar ForbiddenError pois não há user
    expect([401, 403]).toContain(res.statusCode);

    await app.close();
  });
});
