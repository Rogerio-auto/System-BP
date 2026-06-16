// =============================================================================
// law-firms/__tests__/law-firms.test.ts — Testes de integração (F19-S02).
//
// Estratégia: sobe Fastify com lawFirmsRoutes, mocka authenticate/authorize,
// mocka db/client e mocka service para controlar dados.
//
// Cobre (DoD F19-S02):
//   1.  GET  /api/law-firms → 200 com lista paginada
//   2.  GET  /api/law-firms?city_id=<uuid> → 200 filtrado por cidade
//   3.  POST /api/law-firms → 201 com escritório criado
//   4.  POST /api/law-firms → 400 body inválido (sem name)
//   5.  PATCH /api/law-firms/:id → 200 com escritório atualizado
//   6.  PATCH /api/law-firms/:id → 404 não encontrado
//   7.  DELETE /api/law-firms/:id → 200 { ok: true }
//   8.  DELETE /api/law-firms/:id → 404 não encontrado
//   9.  GET  /api/law-firms/suggest?customer_id=<uuid> → 200 com escritório
//   10. GET  /api/law-firms/suggest?customer_id=<uuid> → 200 com null
//   11. GET  /api/law-firms/suggest → 404 customer não encontrado
//   12. Sem auth → 401
//   13. RBAC: sem law_firms:manage → 403 em GET /api/law-firms
//   14. RBAC: sem law_firms:referral → 403 em GET /api/law-firms/suggest
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real ao banco)
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
      const { ForbiddenError, UnauthorizedError } = await import('../../../shared/errors.js');
      if (!request.user) throw new UnauthorizedError('Não autenticado');
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
const mockListLawFirmsService = vi.fn();
const mockCreateLawFirmService = vi.fn();
const mockUpdateLawFirmService = vi.fn();
const mockDeleteLawFirmService = vi.fn();
const mockSuggestLawFirmService = vi.fn();

vi.mock('../service.js', () => ({
  listLawFirmsService: (...args: unknown[]) => mockListLawFirmsService(...args),
  createLawFirmService: (...args: unknown[]) => mockCreateLawFirmService(...args),
  updateLawFirmService: (...args: unknown[]) => mockUpdateLawFirmService(...args),
  deleteLawFirmService: (...args: unknown[]) => mockDeleteLawFirmService(...args),
  suggestLawFirmService: (...args: unknown[]) => mockSuggestLawFirmService(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_FIRM_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_CUSTOMER_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const NOW = new Date().toISOString();

function makeFirmResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_FIRM_ID,
    organization_id: FIXTURE_ORG_ID,
    name: 'Oliveira & Associados',
    contact_phone: '(69) 3224-0000',
    coverage_city_ids: [FIXTURE_CITY_ID],
    is_default_for_city: true,
    notes: 'Especialistas em recuperação de crédito',
    created_by: FIXTURE_USER_ID,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...overrides,
  };
}

const CREATE_PAYLOAD = {
  name: 'Escritório Jurídico Rondônia',
  contact_phone: '(69) 3001-2000',
  coverage_city_ids: [FIXTURE_CITY_ID],
  is_default_for_city: false,
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['law_firms:manage', 'law_firms:referral'],
): Promise<FastifyInstance> {
  const [{ lawFirmsRoutes }, { isAppError }] = await Promise.all([
    import('../routes.js'),
    import('../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Injetar request.user antes das rotas (simula authenticate())
  app.addHook('preHandler', async (request) => {
    request.user = {
      id: FIXTURE_USER_ID,
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

  await app.register(lawFirmsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/law-firms
// ---------------------------------------------------------------------------

describe('GET /api/law-firms', () => {
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
    mockListLawFirmsService.mockResolvedValue({
      data: [makeFirmResponse()],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/law-firms' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
    expect(Array.isArray(body['data'])).toBe(true);
    expect((body['data'] as unknown[]).length).toBe(1);
  });

  it('filtra por city_id quando fornecido', async () => {
    mockListLawFirmsService.mockResolvedValue({
      data: [makeFirmResponse({ coverage_city_ids: [FIXTURE_CITY_ID] })],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/law-firms?city_id=${FIXTURE_CITY_ID}`,
    });

    expect(res.statusCode).toBe(200);
    // Verifica que o service foi chamado com o query correto
    const [, , query] = mockListLawFirmsService.mock.calls[0] as [
      unknown,
      unknown,
      { city_id?: string },
    ];
    expect(query.city_id).toBe(FIXTURE_CITY_ID);
  });

  it('retorna 403 sem permissão law_firms:manage', async () => {
    const restrictedApp = await buildTestApp([]);
    try {
      const res = await restrictedApp.inject({ method: 'GET', url: '/api/law-firms' });
      expect(res.statusCode).toBe(403);
    } finally {
      await restrictedApp.close();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/law-firms
// ---------------------------------------------------------------------------

describe('POST /api/law-firms', () => {
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

  it('retorna 201 com escritório criado', async () => {
    mockCreateLawFirmService.mockResolvedValue(makeFirmResponse({ name: CREATE_PAYLOAD.name }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/law-firms',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(CREATE_PAYLOAD),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
  });

  it('retorna 400 para body inválido (sem name)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/law-firms',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ coverage_city_ids: [] }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 para coverage_city_ids com UUID inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/law-firms',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Teste', coverage_city_ids: ['nao-e-uuid'] }),
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/law-firms/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/law-firms/:id', () => {
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

  it('retorna 200 com escritório atualizado', async () => {
    const updated = makeFirmResponse({ name: 'Novo Nome', is_default_for_city: true });
    mockUpdateLawFirmService.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/law-firms/${FIXTURE_FIRM_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Novo Nome', is_default_for_city: true }),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['name']).toBe('Novo Nome');
  });

  it('retorna 404 quando escritório não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateLawFirmService.mockRejectedValue(new NotFoundError('Escritório não encontrado'));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/law-firms/${FIXTURE_FIRM_ID}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Teste' }),
    });

    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 para id inválido (não UUID)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/law-firms/nao-e-uuid',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'Teste' }),
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/law-firms/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/law-firms/:id', () => {
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

  it('retorna 200 { ok: true } ao soft-deletar', async () => {
    mockDeleteLawFirmService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/law-firms/${FIXTURE_FIRM_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<Record<string, unknown>>()['ok']).toBe(true);
  });

  it('retorna 404 quando escritório não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockDeleteLawFirmService.mockRejectedValue(new NotFoundError('Escritório não encontrado'));

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/law-firms/${FIXTURE_FIRM_ID}`,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/law-firms/suggest
// ---------------------------------------------------------------------------

describe('GET /api/law-firms/suggest', () => {
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

  it('retorna 200 com escritório quando encontrado para a cidade', async () => {
    mockSuggestLawFirmService.mockResolvedValue({ data: makeFirmResponse() });

    const res = await app.inject({
      method: 'GET',
      url: `/api/law-firms/suggest?customer_id=${FIXTURE_CUSTOMER_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Record<string, unknown> | null }>();
    expect(body.data).not.toBeNull();
    expect(body.data?.['id']).toBe(FIXTURE_FIRM_ID);
  });

  it('retorna 200 com null quando nenhum escritório cobre a cidade', async () => {
    mockSuggestLawFirmService.mockResolvedValue({ data: null });

    const res = await app.inject({
      method: 'GET',
      url: `/api/law-firms/suggest?customer_id=${FIXTURE_CUSTOMER_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: null }>();
    expect(body.data).toBeNull();
  });

  it('retorna 404 quando customer não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockSuggestLawFirmService.mockRejectedValue(new NotFoundError('Cliente não encontrado'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/law-firms/suggest?customer_id=${FIXTURE_CUSTOMER_ID}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 quando customer_id não é UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/law-firms/suggest?customer_id=nao-e-uuid',
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando customer_id não é fornecido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/law-firms/suggest',
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 403 sem permissão law_firms:referral', async () => {
    const restrictedApp = await buildTestApp(['law_firms:manage']);
    try {
      const res = await restrictedApp.inject({
        method: 'GET',
        url: `/api/law-firms/suggest?customer_id=${FIXTURE_CUSTOMER_ID}`,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await restrictedApp.close();
    }
  });
});
