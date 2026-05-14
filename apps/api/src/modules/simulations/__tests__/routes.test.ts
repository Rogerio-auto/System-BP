// =============================================================================
// simulations/__tests__/routes.test.ts — Testes de integração (F2-S04).
//
// Estratégia: sobe Fastify com simulationsRoutes, mocka authenticate/authorize
// e featureGate para controlar contexto, mocka service para controlar dados.
//
// Cobre:
//   1.  POST /api/simulations → 201 caminho feliz Price
//   2.  POST /api/simulations → 201 caminho feliz SAC
//   3.  POST /api/simulations → 422 amount fora dos limites
//   4.  POST /api/simulations → 422 termMonths fora dos limites
//   5.  POST /api/simulations → 409 no_active_rule_for_city
//   6.  POST /api/simulations → 403 lead fora do city scope
//   7.  POST /api/simulations → 403 feature flag off (credit_simulation.enabled)
//   8.  POST /api/simulations → 400 body inválido (leadId não UUID)
//   9.  POST /api/simulations → 403 sem permissão simulations:create
//   10. POST /api/simulations → 404 produto não encontrado
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
const mockCreateSimulation = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSimulation: (...args: unknown[]) => mockCreateSimulation(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock repository (for GET /api/leads/:id/simulations)
// ---------------------------------------------------------------------------
const mockFindLeadForSimulation = vi.fn();
const mockFindSimulationsByLeadId = vi.fn();

vi.mock('../repository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    findLeadForSimulation: (...args: unknown[]) => mockFindLeadForSimulation(...args),
    findSimulationsByLeadId: (...args: unknown[]) => mockFindSimulationsByLeadId(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_PRODUCT_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_RULE_VERSION_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const FIXTURE_SIMULATION_ID = 'ffffffff-0000-0000-0000-000000000001';

const VALID_BODY = {
  leadId: FIXTURE_LEAD_ID,
  productId: FIXTURE_PRODUCT_ID,
  amount: 2000,
  termMonths: 12,
};

function makeSimulationResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_SIMULATION_ID,
    organization_id: FIXTURE_ORG_ID,
    lead_id: FIXTURE_LEAD_ID,
    product_id: FIXTURE_PRODUCT_ID,
    rule_version_id: FIXTURE_RULE_VERSION_ID,
    amount_requested: '2000.00',
    term_months: 12,
    monthly_payment: '187.53',
    total_amount: '2250.36',
    total_interest: '250.36',
    rate_monthly_snapshot: '0.020000',
    amortization_method: 'price',
    amortization_table: [],
    origin: 'manual',
    created_by_user_id: FIXTURE_USER_ID,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['simulations:create', 'simulations:read'],
  injectUser = true,
): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { simulationsRoutes },
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

  await app.register(simulationsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// POST /api/simulations — caminho feliz (Price)
// ---------------------------------------------------------------------------

describe('POST /api/simulations — caminho feliz Price', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 201 com simulação Price completa', async () => {
    const expected = makeSimulationResponse({ amortization_method: 'price' });
    mockCreateSimulation.mockResolvedValueOnce(expected);

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe(FIXTURE_SIMULATION_ID);
    expect(body.amortization_method).toBe('price');
    expect(body.origin).toBe('manual');
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);

    // Verifica que o service foi chamado com origin='manual'
    expect(mockCreateSimulation).toHaveBeenCalledOnce();
    const [, , , opts] = mockCreateSimulation.mock.calls[0] as unknown[];
    expect((opts as Record<string, unknown>).origin).toBe('manual');
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — caminho feliz (SAC)
// ---------------------------------------------------------------------------

describe('POST /api/simulations — caminho feliz SAC', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 201 com simulação SAC', async () => {
    const expected = makeSimulationResponse({ amortization_method: 'sac' });
    mockCreateSimulation.mockResolvedValueOnce(expected);

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().amortization_method).toBe('sac');
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — 422 fora de limites
// ---------------------------------------------------------------------------

describe('POST /api/simulations — 422 fora de limites', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 422 quando amount fora dos limites da regra', async () => {
    const { SimulationOutOfRangError } = await import('../service.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new SimulationOutOfRangError('amount', 500, 5000, 50),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.details).toMatchObject({ field: 'amount', min: 500, max: 5000, actual: 50 });
  });

  it('retorna 422 quando termMonths fora dos limites da regra', async () => {
    const { SimulationOutOfRangError } = await import('../service.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new SimulationOutOfRangError('termMonths', 3, 24, 60),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: { ...VALID_BODY, termMonths: 60 },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.details).toMatchObject({ field: 'termMonths' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — 409 no_active_rule_for_city
// ---------------------------------------------------------------------------

describe('POST /api/simulations — 409 no_active_rule_for_city', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 409 quando não há regra ativa para a cidade do lead', async () => {
    const { NoActiveRuleForCityError } = await import('../service.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new NoActiveRuleForCityError('city-uuid-000-000-000000000001'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('CONFLICT');
    expect(body.details).toMatchObject({ code: 'no_active_rule_for_city' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — 403 lead fora do city scope
// ---------------------------------------------------------------------------

describe('POST /api/simulations — 403 lead fora do city scope', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['simulations:create', 'simulations:read'], true);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 403 quando lead está fora do city scope do usuário', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new ForbiddenError('Lead não encontrado ou fora do escopo do usuário'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — 403 feature flag off
// ---------------------------------------------------------------------------

describe('POST /api/simulations — 403 feature flag off', () => {
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

  it('retorna 403 quando credit_simulation.enabled está desabilitada', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FEATURE_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — 400 body inválido
// ---------------------------------------------------------------------------

describe('POST /api/simulations — 400 body inválido', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 400 quando leadId não é UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: { ...VALID_BODY, leadId: 'nao-e-uuid' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('retorna 400 quando amount é zero', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: { ...VALID_BODY, amount: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('retorna 400 quando termMonths é negativo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: { ...VALID_BODY, termMonths: -1 },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — 403 sem permissão simulations:create
// ---------------------------------------------------------------------------

describe('POST /api/simulations — 403 sem permissão', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Usuário sem simulations:create
    app = await buildTestApp(['leads:read']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 403 quando usuário não tem simulations:create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// POST /api/simulations — 404 produto não encontrado
// ---------------------------------------------------------------------------

describe('POST /api/simulations — 404 produto não encontrado', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 404 quando produto não existe ou está inativo', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new NotFoundError('Produto de crédito não encontrado ou inativo'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/simulations',
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });
});

// ===========================================================================
// GET /api/leads/:id/simulations — F2-S08
// ===========================================================================

/**
 * Cria um item no formato retornado pelo repository (SimulationListItem),
 * com campos numéricos como strings (Drizzle numeric → string) e Date para createdAt.
 */
function makeSimulationListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_SIMULATION_ID,
    productId: FIXTURE_PRODUCT_ID,
    productName: 'Microcrédito Básico',
    amountRequested: '2000.00',
    termMonths: 12,
    monthlyPayment: '187.53',
    totalAmount: '2250.36',
    totalInterest: '250.36',
    rateMonthlySnapshot: '0.020000',
    amortizationMethod: 'price' as const,
    amortizationTable: [],
    ruleVersion: 3,
    origin: 'manual' as const,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GET /api/leads/:id/simulations — caminho feliz
// ---------------------------------------------------------------------------

describe('GET /api/leads/:id/simulations — caminho feliz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['simulations:read']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('retorna 200 com lista paginada de simulações', async () => {
    // Lead existe no scope
    mockFindLeadForSimulation.mockResolvedValueOnce({ id: FIXTURE_LEAD_ID });
    const item = makeSimulationListItem();
    mockFindSimulationsByLeadId.mockResolvedValueOnce([item]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}/simulations`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toHaveLength(1);
    expect((body.data[0] as Record<string, unknown>)['productName']).toBe('Microcrédito Básico');
    expect((body.data[0] as Record<string, unknown>)['ruleVersion']).toBe(3);
    expect((body.data[0] as Record<string, unknown>)['origin']).toBe('manual');
    expect(body.nextCursor).toBeNull();
  });

  it('retorna nextCursor quando página está cheia', async () => {
    // Lead existe no scope
    mockFindLeadForSimulation.mockResolvedValueOnce({ id: FIXTURE_LEAD_ID });

    // 20 items (default limit = 20) — UUIDs válidos
    const uuids = Array.from(
      { length: 20 },
      (_, i) => `ffffffff-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const items = uuids.map((id) => makeSimulationListItem({ id }));
    mockFindSimulationsByLeadId.mockResolvedValueOnce(items);

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}/simulations`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; nextCursor: string | null };
    expect(body.data).toHaveLength(20);
    // nextCursor é o id do último item
    expect(body.nextCursor).toBe(uuids[19]);
  });

  it('aceita parâmetros cursor e limit', async () => {
    mockFindLeadForSimulation.mockResolvedValueOnce({ id: FIXTURE_LEAD_ID });
    mockFindSimulationsByLeadId.mockResolvedValueOnce([]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}/simulations?limit=5&cursor=${FIXTURE_SIMULATION_ID}`,
    });

    expect(res.statusCode).toBe(200);
    // Verifica que repository foi chamado com os parâmetros corretos
    expect(mockFindSimulationsByLeadId).toHaveBeenCalledWith(
      expect.anything(),
      FIXTURE_LEAD_ID,
      FIXTURE_ORG_ID,
      { cursor: FIXTURE_SIMULATION_ID, limit: 5 },
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/leads/:id/simulations — 403 lead fora do city scope
// ---------------------------------------------------------------------------

describe('GET /api/leads/:id/simulations — 403 lead fora do city scope', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(['simulations:read']);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 403 quando lead está fora do city scope', async () => {
    // Lead não encontrado (fora do scope)
    mockFindLeadForSimulation.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}/simulations`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// GET /api/leads/:id/simulations — 403 sem permissão simulations:read
// ---------------------------------------------------------------------------

describe('GET /api/leads/:id/simulations — 403 sem permissão', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Usuário sem simulations:read
    app = await buildTestApp(['leads:read']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 403 quando usuário não tem simulations:read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}/simulations`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });
});
