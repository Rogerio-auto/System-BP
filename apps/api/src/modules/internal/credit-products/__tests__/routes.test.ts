// =============================================================================
// internal/credit-products/__tests__/routes.test.ts — Testes de integração F3-S06.
//
// Estratégia: sobe Fastify com internalCreditProductsRoutes (default export via
// autoload), mocka db e findProducts para controlar respostas sem conectar em
// banco real.
//
// Caminhos relativos a __tests__/:
//   ../routes.js                              = src/modules/internal/credit-products/routes.ts
//   ../../../../config/env.js                 = src/config/env.ts
//   ../../../../db/client.js                  = src/db/client.ts
//   ../../../../shared/errors.js              = src/shared/errors.ts
//   ../../../credit-products/repository.js    = src/modules/credit-products/repository.ts
//
// Cobre (DoD F3-S06):
//   1.  GET /internal/credit-products → 200 lista vazia quando sem produtos ativos
//   2.  GET /internal/credit-products → 200 apenas produtos ativos (inativo excluído)
//   3.  GET /internal/credit-products → 200 produtos sem regra ativa excluídos
//   4.  GET /internal/credit-products → 200 com cityId: filtra por cityScope
//   5.  GET /internal/credit-products → 200 com cityId: inclui produtos sem cityScope (global)
//   6.  GET /internal/credit-products → 200 sem organizationId retorna lista vazia
//   7.  GET /internal/credit-products → 401 sem X-Internal-Token
//   8.  GET /internal/credit-products → 401 com token errado
//   9.  GET /internal/credit-products → 400 cityId não é UUID
//   10. GET /internal/credit-products → 400 organizationId não é UUID
//   11. GET /internal/credit-products → payload não contém campos internos sensíveis
//   12. GET /internal/credit-products → payload contém campos corretos da regra ativa
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg (previne tentativa de conectar em banco real)
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
// Mock env — provê LANGGRAPH_INTERNAL_TOKEN controlável.
// Caminho relativo a __tests__/: ../../../../config/env.js = src/config/env.ts.
// ---------------------------------------------------------------------------
const VALID_TOKEN = 'valid-internal-token-32-chars-minimum-x';

vi.mock('../../../../config/env.js', () => ({
  env: {
    LANGGRAPH_INTERNAL_TOKEN: VALID_TOKEN,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client — não é usado diretamente pela rota (passa para findProducts),
// mas precisa existir para o módulo importar sem erro.
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock findProducts do repository de credit-products.
// Caminho relativo a __tests__/: ../../../credit-products/repository.js
// ---------------------------------------------------------------------------
const mockFindProducts = vi.fn();

vi.mock('../../../credit-products/repository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    findProducts: (...args: unknown[]) => mockFindProducts(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_PRODUCT_ID_1 = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_PRODUCT_ID_2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const FIXTURE_CITY_ID_A = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_B = 'cccccccc-0000-0000-0000-000000000002';

/** Monta uma regra ativa com valores padrão para testes. */
function makeActiveRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dddddddd-0000-0000-0000-000000000001',
    productId: FIXTURE_PRODUCT_ID_1,
    version: 1,
    minAmount: '500.00',
    maxAmount: '15000.00',
    minTermMonths: 6,
    maxTermMonths: 36,
    monthlyRate: '0.025000',
    iofRate: '0.000041',
    amortization: 'price',
    cityScope: null,
    effectiveFrom: new Date('2025-01-01T00:00:00Z'),
    effectiveTo: null,
    isActive: true,
    createdBy: 'eeeeeeee-0000-0000-0000-000000000001',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

/** Monta um produto com regra ativa inlinada. */
function makeProduct(
  id: string,
  overrides: Record<string, unknown> = {},
  ruleOverrides: Record<string, unknown> | null = {},
) {
  const activeRule =
    ruleOverrides !== null ? makeActiveRule({ productId: id, ...ruleOverrides }) : null;
  return {
    id,
    organizationId: FIXTURE_ORG_ID,
    key: 'microcredito_basico',
    name: 'Microcrédito Básico',
    description: 'Produto para microempresários',
    isActive: true,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    deletedAt: null,
    activeRule,
    ...overrides,
  };
}

/** Retorno padrão de findProducts com 1 produto com regra. */
function makeProductsResult(products: ReturnType<typeof makeProduct>[]) {
  return {
    data: products,
    total: products.length,
  };
}

// ---------------------------------------------------------------------------
// Build test app
//
// Registra internalCreditProductsRoutes com prefix /internal/credit-products
// para simular o comportamento do autoload + prefix '/internal' do app.ts.
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalCreditProductsRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    // Default export — padrão exigido pelo @fastify/autoload (F3-S04).
    import('../routes.js'),
    // Caminho relativo a __tests__/: ../../../../shared/errors.js = src/shared/errors.ts
    import('../../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler(
    // `as` justificado: tipos de error/request/reply são genéricos em setErrorHandler
    // no Fastify 5 — padrão adotado em todos os testes de integração do projeto.
    (
      error: Error & { validation?: unknown; statusCode?: number },
      _request: unknown,
      reply: { status: (n: number) => { send: (b: unknown) => void } },
    ) => {
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
    },
  );

  // Registra o plugin com prefixo /internal/credit-products (simula autoload + app.ts prefix).
  await app.register(internalCreditProductsRoutes, { prefix: '/internal/credit-products' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('GET /internal/credit-products', () => {
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

  // -------------------------------------------------------------------------
  // 1. 200 — lista vazia quando sem produtos ativos
  // -------------------------------------------------------------------------
  it('retorna 200 com lista vazia quando não há produtos ativos', async () => {
    mockFindProducts.mockResolvedValueOnce(makeProductsResult([]));

    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 2. 200 — apenas produtos ativos retornados (is_active: true passado ao repo)
  // -------------------------------------------------------------------------
  it('passa is_active=true ao findProducts (filtra somente ativos)', async () => {
    const product = makeProduct(FIXTURE_PRODUCT_ID_1);
    mockFindProducts.mockResolvedValueOnce(makeProductsResult([product]));

    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    // Verifica que findProducts foi chamado com is_active: true
    expect(mockFindProducts).toHaveBeenCalledWith(
      expect.anything(), // db
      FIXTURE_ORG_ID,
      expect.objectContaining({ is_active: true }),
    );
  });

  // -------------------------------------------------------------------------
  // 3. 200 — produtos sem regra ativa são excluídos da resposta
  // -------------------------------------------------------------------------
  it('exclui produtos sem regra ativa publicada', async () => {
    const productWithRule = makeProduct(FIXTURE_PRODUCT_ID_1, { name: 'Com regra' });
    const productWithoutRule = makeProduct(FIXTURE_PRODUCT_ID_2, { name: 'Sem regra' }, null);
    mockFindProducts.mockResolvedValueOnce(
      makeProductsResult([productWithRule, productWithoutRule]),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Apenas o produto com regra ativa deve aparecer
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(FIXTURE_PRODUCT_ID_1);
  });

  // -------------------------------------------------------------------------
  // 4. 200 com cityId — filtra por cityScope
  // -------------------------------------------------------------------------
  it('com cityId, exclui produtos cujo cityScope não contém o cityId', async () => {
    // Produto A: cityScope=[CITY_A] → deve aparecer quando cityId=CITY_A
    const productA = makeProduct(
      FIXTURE_PRODUCT_ID_1,
      { name: 'Produto A' },
      {
        cityScope: [FIXTURE_CITY_ID_A],
      },
    );
    // Produto B: cityScope=[CITY_B] → NÃO deve aparecer quando cityId=CITY_A
    const productB = makeProduct(
      FIXTURE_PRODUCT_ID_2,
      { name: 'Produto B' },
      {
        cityScope: [FIXTURE_CITY_ID_B],
      },
    );
    mockFindProducts.mockResolvedValueOnce(makeProductsResult([productA, productB]));

    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}&cityId=${FIXTURE_CITY_ID_A}`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(FIXTURE_PRODUCT_ID_1);
  });

  // -------------------------------------------------------------------------
  // 5. 200 com cityId — inclui produtos com cityScope null (global)
  // -------------------------------------------------------------------------
  it('com cityId, inclui produtos com cityScope null (produto global)', async () => {
    // Produto global: cityScope=null → deve aparecer para qualquer cidade
    const productGlobal = makeProduct(
      FIXTURE_PRODUCT_ID_1,
      { name: 'Global' },
      {
        cityScope: null,
      },
    );
    // Produto restrito a outra cidade → NÃO deve aparecer
    const productRestricted = makeProduct(
      FIXTURE_PRODUCT_ID_2,
      { name: 'Restrito' },
      {
        cityScope: [FIXTURE_CITY_ID_B],
      },
    );
    mockFindProducts.mockResolvedValueOnce(makeProductsResult([productGlobal, productRestricted]));

    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}&cityId=${FIXTURE_CITY_ID_A}`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(FIXTURE_PRODUCT_ID_1);
  });

  // -------------------------------------------------------------------------
  // 6. 200 — sem organizationId retorna lista vazia (proteção multi-tenant)
  // -------------------------------------------------------------------------
  it('retorna 200 com lista vazia quando organizationId não é fornecido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/credit-products',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toEqual([]);
    // findProducts nunca deve ser chamado sem organizationId (proteção multi-tenant)
    expect(mockFindProducts).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}`,
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindProducts).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 401 — com token errado
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}`,
      headers: { 'x-internal-token': 'wrong-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindProducts).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. 400 — cityId não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando cityId não é UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}&cityId=not-a-uuid`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindProducts).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. 400 — organizationId não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando organizationId não é UUID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/credit-products?organizationId=not-a-uuid',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindProducts).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 11. Payload sem campos internos sensíveis (doc 06 §5.6)
  // -------------------------------------------------------------------------
  it('não expõe campos internos sensíveis no payload', async () => {
    const product = makeProduct(FIXTURE_PRODUCT_ID_1, { name: 'Microcrédito Básico' });
    mockFindProducts.mockResolvedValueOnce(makeProductsResult([product]));

    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const item = response.json().data[0];

    // Campos proibidos — não devem aparecer
    expect(item).not.toHaveProperty('organization_id');
    expect(item).not.toHaveProperty('key');
    expect(item).not.toHaveProperty('description');
    expect(item).not.toHaveProperty('created_at');
    expect(item).not.toHaveProperty('updated_at');
    expect(item).not.toHaveProperty('deleted_at');
    expect(item).not.toHaveProperty('is_active');
    // Campos internos da regra
    expect(item).not.toHaveProperty('version');
    expect(item).not.toHaveProperty('created_by');
    expect(item).not.toHaveProperty('effective_from');
    expect(item).not.toHaveProperty('effective_to');
    expect(item).not.toHaveProperty('city_scope');
    expect(item).not.toHaveProperty('iof_rate');
    expect(item).not.toHaveProperty('active_rule');
  });

  // -------------------------------------------------------------------------
  // 12. Payload contém os campos corretos da regra ativa
  // -------------------------------------------------------------------------
  it('retorna campos corretos do produto mapeados da regra ativa', async () => {
    const product = makeProduct(
      FIXTURE_PRODUCT_ID_1,
      { name: 'Crédito Jovem' },
      {
        minAmount: '1000.00',
        maxAmount: '20000.00',
        minTermMonths: 12,
        maxTermMonths: 60,
        monthlyRate: '0.019000',
        amortization: 'sac',
      },
    );
    mockFindProducts.mockResolvedValueOnce(makeProductsResult([product]));

    const response = await app.inject({
      method: 'GET',
      url: `/internal/credit-products?organizationId=${FIXTURE_ORG_ID}`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const item = response.json().data[0];

    expect(item.id).toBe(FIXTURE_PRODUCT_ID_1);
    expect(item.name).toBe('Crédito Jovem');
    expect(item.min_amount).toBe('1000.00');
    expect(item.max_amount).toBe('20000.00');
    expect(item.min_term).toBe(12);
    expect(item.max_term).toBe(60);
    expect(item.interest_rate).toBe('0.019000');
    expect(item.amortization_type).toBe('sac');
  });
});
