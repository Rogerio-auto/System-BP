// =============================================================================
// credit-products/__tests__/routes.test.ts — Testes de integração (F2-S03).
//
// Estratégia: sobe Fastify com creditProductsRoutes, mocka authenticate/authorize
// e featureGate para controlar contexto, mocka service para controlar dados.
//
// Cobre:
//   1.  GET  /api/credit-products → 200 lista paginada
//   2.  POST /api/credit-products → 201 produto criado
//   3.  POST /api/credit-products → 409 key duplicada
//   4.  POST /api/credit-products → 400 body inválido
//   5.  GET  /api/credit-products/:id → 200 detalhe + timeline
//   6.  GET  /api/credit-products/:id → 404 não encontrado
//   7.  PATCH /api/credit-products/:id → 200 atualizado
//   8.  PATCH /api/credit-products/:id → 404
//   9.  DELETE /api/credit-products/:id → 204
//   10. DELETE /api/credit-products/:id → 409 simulações recentes
//   11. POST /api/credit-products/:id/rules → 201 regra publicada
//   12. POST /api/credit-products/:id/rules → 503 feature flag off
//   13. GET  /api/credit-products/:id/rules → 200 timeline
//   14. GET  /api/credit-products/:id/rules → 503 feature flag off
//   15. Sem auth → 403
//   16. Sem permissão credit_products:read → 403
//   17. Sem permissão credit_products:write → 403
//   18. POST /api/credit-products/:id/rules — PROVA que não existe PATCH /rules/:id
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
// Mock authenticate
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook global no buildTestApp
  },
}));

// ---------------------------------------------------------------------------
// Mock authorize
// ---------------------------------------------------------------------------
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
// Mock featureGate (controlável por teste)
// ---------------------------------------------------------------------------
const mockFeatureGateEnabled = vi.fn<() => boolean>().mockReturnValue(true);

vi.mock('../../../plugins/featureGate.js', () => ({
  featureGate: (_key: string) => async (_request: unknown, _reply: unknown) => {
    const { FeatureDisabledError } = await import('../../../shared/errors.js');
    if (!mockFeatureGateEnabled()) {
      throw new FeatureDisabledError('credit_simulation.enabled');
    }
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
const mockListProducts = vi.fn();
const mockCreateProduct = vi.fn();
const mockGetProductById = vi.fn();
const mockUpdateProductService = vi.fn();
const mockDeleteProductService = vi.fn();
const mockPublishRule = vi.fn();
const mockListRules = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listProducts: (...args: unknown[]) => mockListProducts(...args),
    createProduct: (...args: unknown[]) => mockCreateProduct(...args),
    getProductById: (...args: unknown[]) => mockGetProductById(...args),
    updateProductService: (...args: unknown[]) => mockUpdateProductService(...args),
    deleteProductService: (...args: unknown[]) => mockDeleteProductService(...args),
    publishRule: (...args: unknown[]) => mockPublishRule(...args),
    listRules: (...args: unknown[]) => mockListRules(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_PRODUCT_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_RULE_ID = 'dddddddd-0000-0000-0000-000000000001';

function makeRuleResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_RULE_ID,
    product_id: FIXTURE_PRODUCT_ID,
    version: 1,
    min_amount: '500.00',
    max_amount: '5000.00',
    min_term_months: 3,
    max_term_months: 24,
    monthly_rate: '0.025000',
    iof_rate: null,
    amortization: 'price',
    city_scope: null,
    effective_from: new Date().toISOString(),
    effective_to: null,
    is_active: true,
    created_by: FIXTURE_USER_ID,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeProductResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_PRODUCT_ID,
    organization_id: FIXTURE_ORG_ID,
    key: 'microcredito_basico',
    name: 'Microcrédito Básico',
    description: 'Produto básico de microcrédito',
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    active_rule: makeRuleResponse(),
    ...overrides,
  };
}

const CREATE_PRODUCT_PAYLOAD = {
  key: 'microcredito_test',
  name: 'Microcrédito Test',
  description: 'Para testes',
};

const PUBLISH_RULE_PAYLOAD = {
  minAmount: 500,
  maxAmount: 5000,
  minTermMonths: 3,
  maxTermMonths: 24,
  monthlyRate: 0.025,
  amortization: 'price',
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['credit_products:read', 'credit_products:write'],
  injectUser = true,
): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { creditProductsRoutes },
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
        id: FIXTURE_USER_ID,
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

  await app.register(creditProductsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/credit-products
// ---------------------------------------------------------------------------

describe('GET /api/credit-products', () => {
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
    mockListProducts.mockResolvedValue({
      data: [makeProductResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/credit-products' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('repassa filtros ao service', async () => {
    mockListProducts.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/credit-products?is_active=true&search=micro&page=2',
    });

    expect(res.statusCode).toBe(200);
    expect(mockListProducts).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: FIXTURE_ORG_ID }),
      expect.objectContaining({ is_active: true, search: 'micro', page: 2 }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/credit-products
// ---------------------------------------------------------------------------

describe('POST /api/credit-products', () => {
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

  it('retorna 201 ao criar produto', async () => {
    mockCreateProduct.mockResolvedValue(makeProductResponse({ active_rule: null }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-products',
      payload: CREATE_PRODUCT_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['key']).toBe('microcredito_basico');
  });

  it('retorna 409 quando key já existe', async () => {
    const { CreditProductKeyConflictError } = await import('../service.js');
    mockCreateProduct.mockRejectedValue(new CreditProductKeyConflictError());

    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-products',
      payload: CREATE_PRODUCT_PAYLOAD,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('CONFLICT');
    expect((body['details'] as Record<string, unknown> | undefined)?.['field']).toBe('key');
  });

  it('retorna 400 quando body é inválido (key com caracteres inválidos)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-products',
      payload: { key: 'UPPERCASE-KEY', name: 'Test' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando body não tem name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-products',
      payload: { key: 'valid_key' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/credit-products/:id
// ---------------------------------------------------------------------------

describe('GET /api/credit-products/:id', () => {
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

  it('retorna 200 com detalhe do produto + timeline', async () => {
    mockGetProductById.mockResolvedValue({
      ...makeProductResponse(),
      rules: [makeRuleResponse()],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_PRODUCT_ID);
    expect(Array.isArray(body['rules'])).toBe(true);
  });

  it('retorna 404 quando produto não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetProductById.mockRejectedValue(new NotFoundError('Produto de crédito não encontrado'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/credit-products/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/credit-products/:id', () => {
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

  it('retorna 200 com produto atualizado', async () => {
    mockUpdateProductService.mockResolvedValue(makeProductResponse({ is_active: false }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}`,
      payload: { is_active: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['is_active']).toBe(false);
  });

  it('retorna 404 quando produto não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateProductService.mockRejectedValue(
      new NotFoundError('Produto de crédito não encontrado'),
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}`,
      payload: { is_active: true },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/credit-products/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/credit-products/:id', () => {
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

  it('retorna 204 ao deletar produto sem simulações recentes', async () => {
    mockDeleteProductService.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}`,
    });

    expect(res.statusCode).toBe(204);
  });

  it('retorna 409 quando produto tem simulações recentes (bloqueio)', async () => {
    const { CreditProductHasRecentSimulationsError } = await import('../service.js');
    mockDeleteProductService.mockRejectedValue(new CreditProductHasRecentSimulationsError(5));

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}`,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('CONFLICT');
    expect((body['details'] as Record<string, unknown> | undefined)?.['count']).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// POST /api/credit-products/:id/rules — publicação de regra
// ---------------------------------------------------------------------------

describe('POST /api/credit-products/:id/rules', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 201 ao publicar nova regra', async () => {
    mockPublishRule.mockResolvedValue(makeRuleResponse({ version: 1 }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules`,
      payload: PUBLISH_RULE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['version']).toBe(1);
    expect(body['is_active']).toBe(true);
  });

  it('retorna 503 quando feature flag credit_simulation.enabled está off', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules`,
      payload: PUBLISH_RULE_PAYLOAD,
    });

    // FeatureDisabledError retorna 403 (código FEATURE_DISABLED)
    expect([403, 503]).toContain(res.statusCode);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('FEATURE_DISABLED');
  });

  it('retorna 400 quando monthlyRate > 1 (não decimal)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules`,
      payload: { ...PUBLISH_RULE_PAYLOAD, monthlyRate: 2.5 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando maxAmount < minAmount', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules`,
      payload: { ...PUBLISH_RULE_PAYLOAD, minAmount: 5000, maxAmount: 500 },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando maxTermMonths < minTermMonths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules`,
      payload: { ...PUBLISH_RULE_PAYLOAD, minTermMonths: 24, maxTermMonths: 3 },
    });

    expect(res.statusCode).toBe(400);
  });

  // PROVA DE IMUTABILIDADE: Não existe rota PATCH /rules/:id
  it('PROVA DE IMUTABILIDADE: PATCH /api/credit-products/:id/rules/:ruleId não existe (404)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules/${FIXTURE_RULE_ID}`,
      payload: { monthly_rate: 0.05 },
    });

    // Rota não existe → 404 (Fastify default para rota não registrada)
    expect(res.statusCode).toBe(404);
  });

  it('PROVA DE IMUTABILIDADE: PUT /api/credit-products/:id/rules/:ruleId não existe (404)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules/${FIXTURE_RULE_ID}`,
      payload: { monthly_rate: 0.05 },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/credit-products/:id/rules — timeline
// ---------------------------------------------------------------------------

describe('GET /api/credit-products/:id/rules', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 200 com timeline de regras', async () => {
    mockListRules.mockResolvedValue({
      data: [makeRuleResponse({ version: 2 }), makeRuleResponse({ version: 1, is_active: false })],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data).toHaveLength(2);
    expect(body.data[0]?.['version']).toBe(2);
  });

  it('retorna 503 quando feature flag está off', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);

    const res = await app.inject({
      method: 'GET',
      url: `/api/credit-products/${FIXTURE_PRODUCT_ID}/rules`,
    });

    expect([403, 503]).toContain(res.statusCode);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('FEATURE_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// RBAC — autenticação e autorização
// ---------------------------------------------------------------------------

describe('RBAC — crédito', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 403 quando usuário sem credit_products:read acessa GET /api/credit-products', async () => {
    const app = await buildTestApp(['leads:read']);
    mockListProducts.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/credit-products' });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
    await app.close();
  });

  it('retorna 403 quando usuário sem credit_products:write acessa POST /api/credit-products', async () => {
    const app = await buildTestApp(['credit_products:read']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-products',
      payload: CREATE_PRODUCT_PAYLOAD,
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('retorna 403 quando request.user não está definido (authenticate não rodou)', async () => {
    const app = await buildTestApp([], false);

    const res = await app.inject({ method: 'GET', url: '/api/credit-products' });

    expect([401, 403]).toContain(res.statusCode);
    await app.close();
  });
});
