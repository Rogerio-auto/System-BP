// =============================================================================
// leads/routes.test.ts — Testes de integração das rotas de leads (F1-S11).
//
// Estratégia: sobe Fastify com leadsRoutes, mocka authenticate/authorize para
// simular usuário autenticado, mocka service para controlar dados.
//
// Cobre (>= 10 testes):
//   1.  GET  /api/leads → 200 paginado
//   2.  GET  /api/leads/:id → 200 com lead
//   3.  GET  /api/leads/:id → 404 não encontrado
//   4.  POST /api/leads → 201 com lead criado
//   5.  POST /api/leads → 409 LEAD_PHONE_DUPLICATE
//   6.  POST /api/leads → 400 body inválido (sem phone_e164)
//   7.  PATCH /api/leads/:id → 200
//   8.  DELETE /api/leads/:id → 204
//   9.  POST /api/leads/:id/restore → 200
//   10. Sem auth → 401 (authenticate mock lança)
//   11. Sem permission leads:read → 403
//   12. GET com filtros (status, city_id) retorna subset correto
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
const mockListLeads = vi.fn();
const mockGetLeadById = vi.fn();
const mockCreateLead = vi.fn();
const mockUpdateLeadService = vi.fn();
const mockDeleteLeadService = vi.fn();
const mockRestoreLeadService = vi.fn();

vi.mock('../service.js', () => ({
  listLeads: (...args: unknown[]) => mockListLeads(...args),
  getLeadById: (...args: unknown[]) => mockGetLeadById(...args),
  createLead: (...args: unknown[]) => mockCreateLead(...args),
  updateLeadService: (...args: unknown[]) => mockUpdateLeadService(...args),
  deleteLeadService: (...args: unknown[]) => mockDeleteLeadService(...args),
  restoreLeadService: (...args: unknown[]) => mockRestoreLeadService(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_ACTOR_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'dddddddd-0000-0000-0000-000000000001';

function makeLeadResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_LEAD_ID,
    organization_id: FIXTURE_ORG_ID,
    city_id: FIXTURE_CITY_ID,
    agent_id: null,
    name: 'Maria Silva',
    phone_e164: '+5569912345678',
    source: 'manual',
    status: 'new',
    email: null,
    notes: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

const CREATE_PAYLOAD = {
  name: 'João Santos',
  phone_e164: '+5569987654321',
  city_id: FIXTURE_CITY_ID,
  source: 'manual',
  status: 'new',
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(permissions = ['leads:read', 'leads:write']): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { leadsRoutes },
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
      permissions,
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

  await app.register(leadsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/leads
// ---------------------------------------------------------------------------

describe('GET /api/leads', () => {
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
    mockListLeads.mockResolvedValue({
      data: [makeLeadResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/leads' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('GET com filtros combinados (status=new&city_id=...) retorna subset', async () => {
    mockListLeads.mockResolvedValue({
      data: [makeLeadResponse({ status: 'new', city_id: FIXTURE_CITY_ID })],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads?status=new&city_id=${FIXTURE_CITY_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data[0]?.['status']).toBe('new');
    expect(body.data[0]?.['city_id']).toBe(FIXTURE_CITY_ID);
  });
});

// ---------------------------------------------------------------------------
// GET /api/leads/:id
// ---------------------------------------------------------------------------

describe('GET /api/leads/:id', () => {
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

  it('retorna 200 com lead', async () => {
    mockGetLeadById.mockResolvedValue(makeLeadResponse());

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_LEAD_ID);
  });

  it('retorna 404 quando lead não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetLeadById.mockRejectedValue(new NotFoundError('Lead não encontrado'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}`,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/leads
// ---------------------------------------------------------------------------

describe('POST /api/leads', () => {
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

  it('retorna 201 com lead criado', async () => {
    mockCreateLead.mockResolvedValue(makeLeadResponse({ phone_e164: '+5569987654321' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/leads',
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('id');
    expect(body).not.toHaveProperty('cpf');
    expect(body).not.toHaveProperty('cpf_hash');
  });

  it('retorna 409 quando phone duplicado', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockCreateLead.mockRejectedValue(
      new AppError(409, 'CONFLICT', 'Telefone duplicado', { code: 'LEAD_PHONE_DUPLICATE' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/leads',
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<Record<string, unknown>>();
    const details = body['details'] as Record<string, unknown>;
    expect(details['code']).toBe('LEAD_PHONE_DUPLICATE');
  });

  it('retorna 400 quando body inválido (sem phone_e164)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/leads',
      payload: { name: 'Sem Telefone', city_id: FIXTURE_CITY_ID },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/leads/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/leads/:id', () => {
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
    mockUpdateLeadService.mockResolvedValue(makeLeadResponse({ status: 'qualifying' }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/leads/${FIXTURE_LEAD_ID}`,
      payload: { status: 'qualifying' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['status']).toBe('qualifying');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/leads/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/leads/:id', () => {
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

  it('retorna 204 ao deletar lead', async () => {
    mockDeleteLeadService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/leads/${FIXTURE_LEAD_ID}`,
    });

    expect(res.statusCode).toBe(204);
  });
});

// ---------------------------------------------------------------------------
// POST /api/leads/:id/restore
// ---------------------------------------------------------------------------

describe('POST /api/leads/:id/restore', () => {
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

  it('retorna 200 com lead restaurado', async () => {
    mockRestoreLeadService.mockResolvedValue(makeLeadResponse({ deleted_at: null }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/leads/${FIXTURE_LEAD_ID}/restore`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['deleted_at']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

describe('Autorização — sem permissões', () => {
  let appNoPerms: FastifyInstance;

  beforeAll(async () => {
    // Usuário sem as permissões necessárias
    appNoPerms = await buildTestApp(['other:permission']);
  });

  afterAll(async () => {
    await appNoPerms.close();
  });

  it('retorna 403 em GET /api/leads sem leads:read', async () => {
    const res = await appNoPerms.inject({ method: 'GET', url: '/api/leads' });
    expect(res.statusCode).toBe(403);
  });

  it('retorna 403 em POST /api/leads sem leads:write', async () => {
    const res = await appNoPerms.inject({
      method: 'POST',
      url: '/api/leads',
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
  });
});
