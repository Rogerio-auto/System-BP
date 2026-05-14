// =============================================================================
// simulations/__tests__/internal-routes.test.ts — Testes de integração F2-S05.
//
// Estratégia: sobe Fastify com internalSimulationsRoutes, mocka db para
// controlar respostas do lookup de idempotência e do select de simulação,
// mocka createSimulation() para controlar o fluxo de criação.
//
// Cobre:
//   1.  POST /internal/simulations → 201 caminho feliz (nova simulação)
//   2.  POST /internal/simulations → 200 reenvio idempotente (mesma chave)
//   3.  POST /internal/simulations → 401 sem X-Internal-Token
//   4.  POST /internal/simulations → 401 com token errado
//   5.  POST /internal/simulations → 400 body inválido (sem idempotencyKey)
//   6.  POST /internal/simulations → 400 body inválido (idempotencyKey não-UUID)
//   7.  POST /internal/simulations → 400 body inválido (leadId não-UUID)
//   8.  POST /internal/simulations → 422 amount fora dos limites (service layer)
//   9.  POST /internal/simulations → 409 no_active_rule_for_city (service layer)
//   10. POST /internal/simulations → 404 produto não encontrado (service layer)
//   11. POST /internal/simulations → origin='ai' na simulação criada
//   12. POST /internal/simulations → 429 rate limit (>60 req/min simulado)
//   13. POST /internal/simulations → reenvio não chama createSimulation()
//   14. POST /internal/simulations → reenvio com payload inválido no cache → 500
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
// Mock env — provê LANGGRAPH_INTERNAL_TOKEN controlável
// ---------------------------------------------------------------------------
const VALID_TOKEN = 'valid-internal-token-32-chars-minimum-x';

vi.mock('../../../config/env.js', () => ({
  env: {
    LANGGRAPH_INTERNAL_TOKEN: VALID_TOKEN,
    LOG_LEVEL: 'silent',
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client — controla seleção da idempotency_keys e credit_simulations
// ---------------------------------------------------------------------------

// Controla os resultados dos SELECTs. O route chama select() duas vezes ao
// fazer lookup idempotente: primeiro em idempotency_keys, depois em credit_simulations.
// selectCallCount rastreia qual SELECT está sendo feito.
let selectCallCount = 0;
const mockIdempotencyRows = vi.fn<() => unknown[]>().mockReturnValue([]);
const mockSimulationRows = vi.fn<() => unknown[]>().mockReturnValue([]);

// Retorno do INSERT em idempotency_keys (onConflictDoNothing)
const mockIdempotencyInsert = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

// Drizzle query builder mock — retorna resultados em ordem de chamada
function buildSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

const mockDb = {
  select: vi.fn().mockImplementation(() => {
    const callIndex = selectCallCount++;
    // Primeira chamada = lookup em idempotency_keys
    // Segunda chamada (no reenvio idempotente) = lookup em credit_simulations
    if (callIndex % 2 === 0) {
      return buildSelectChain(mockIdempotencyRows());
    }
    return buildSelectChain(mockSimulationRows());
  }),
  insert: vi.fn().mockImplementation(() => ({
    values: vi.fn().mockImplementation(() => ({
      onConflictDoNothing: mockIdempotencyInsert,
    })),
  })),
  transaction: vi.fn(),
};

vi.mock('../../../db/client.js', () => ({
  db: mockDb,
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock createSimulation service
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
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_PRODUCT_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_RULE_VERSION_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const FIXTURE_SIMULATION_ID = 'ffffffff-0000-0000-0000-000000000001';
const FIXTURE_IDEMPOTENCY_KEY = '11111111-2222-3333-4444-555555555555';

const VALID_BODY = {
  organizationId: FIXTURE_ORG_ID,
  leadId: FIXTURE_LEAD_ID,
  productId: FIXTURE_PRODUCT_ID,
  amount: 2000,
  termMonths: 12,
  idempotencyKey: FIXTURE_IDEMPOTENCY_KEY,
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
    amortization_method: 'price' as const,
    amortization_table: [],
    origin: 'ai' as const,
    created_by_user_id: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Simula uma linha da tabela credit_simulations (formato DB)
function makeDbSimulation(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_SIMULATION_ID,
    organizationId: FIXTURE_ORG_ID,
    leadId: FIXTURE_LEAD_ID,
    productId: FIXTURE_PRODUCT_ID,
    ruleVersionId: FIXTURE_RULE_VERSION_ID,
    customerId: null,
    amountRequested: '2000.00',
    termMonths: 12,
    monthlyPayment: '187.53',
    totalAmount: '2250.36',
    totalInterest: '250.36',
    rateMonthlySnapshot: '0.020000',
    amortizationTable: {
      method: 'price',
      installments: [],
    },
    origin: 'ai',
    createdByUserId: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { internalSimulationsRoutes },
    { isAppError },
    rateLimitModule,
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../internal-routes.js'),
    import('../../../shared/errors.js'),
    import('@fastify/rate-limit'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Rate limit plugin necessário para o config.rateLimit funcionar
  // `as` justificado: ESM default export pode vir como .default ou como o próprio módulo
  // dependendo do bundler/runtime — cast para função de registro Fastify é seguro aqui.
  await app.register(rateLimitModule.default as Parameters<typeof app.register>[0], {
    max: 100,
    timeWindow: '1 minute',
  });

  app.setErrorHandler(
    // `as` justificado: tipos de error/request/reply são any em setErrorHandler no Fastify 5
    // quando não há TypeProvider — padrão adotado em todos os testes do projeto.
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
      // rate-limit retorna erro com statusCode 429
      if (error.statusCode === 429) {
        return reply.status(429).send({
          error: 'RATE_LIMITED',
          message: error.message,
        });
      }
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    },
  );

  await app.register(internalSimulationsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: envia request com token válido
// ---------------------------------------------------------------------------

function makeHeaders(token = VALID_TOKEN): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-internal-token': token,
  };
}

// ===========================================================================
// Suite 1: 201 caminho feliz (nova simulação)
// ===========================================================================

describe('POST /internal/simulations — 201 caminho feliz', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    // Idempotência: chave não existe ainda
    mockIdempotencyRows.mockReturnValue([]);
    mockIdempotencyInsert.mockResolvedValue(undefined);
  });

  it('retorna 201 com simulação criada (origin=ai)', async () => {
    const expected = makeSimulationResponse();
    mockCreateSimulation.mockResolvedValueOnce(expected);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBe(FIXTURE_SIMULATION_ID);
    expect(body.origin).toBe('ai');
    expect(body.created_by_user_id).toBeNull();
  });

  it('chama createSimulation() com origin="ai"', async () => {
    const expected = makeSimulationResponse();
    mockCreateSimulation.mockResolvedValueOnce(expected);

    await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(mockCreateSimulation).toHaveBeenCalledOnce();
    const [, , bodyArg, optsArg] = mockCreateSimulation.mock.calls[0] as unknown[];
    expect((optsArg as Record<string, unknown>).origin).toBe('ai');
    expect((optsArg as Record<string, unknown>).idempotencyKey).toBe(FIXTURE_IDEMPOTENCY_KEY);
    expect((bodyArg as Record<string, unknown>).leadId).toBe(FIXTURE_LEAD_ID);
  });

  it('aceita aiDecisionLogId opcional', async () => {
    const expected = makeSimulationResponse();
    mockCreateSimulation.mockResolvedValueOnce(expected);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: { ...VALID_BODY, aiDecisionLogId: '99999999-aaaa-bbbb-cccc-dddddddddddd' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('persiste a chave de idempotência após criação', async () => {
    const expected = makeSimulationResponse();
    mockCreateSimulation.mockResolvedValueOnce(expected);

    await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(mockIdempotencyInsert).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// Suite 2: 200 reenvio idempotente (mesma chave)
// ===========================================================================

describe('POST /internal/simulations — 200 reenvio idempotente', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
  });

  it('retorna 200 (não 201) com simulação existente no reenvio', async () => {
    // Idempotência: chave já existe
    mockIdempotencyRows.mockReturnValue([
      {
        key: `POST:/internal/simulations:${FIXTURE_IDEMPOTENCY_KEY}`,
        endpoint: 'POST /internal/simulations',
        requestHash: FIXTURE_SIMULATION_ID,
        responseStatus: 201,
        responseBody: { simulation_id: FIXTURE_SIMULATION_ID },
        createdAt: new Date(),
      },
    ]);
    // Simulação existe no DB
    mockSimulationRows.mockReturnValue([makeDbSimulation()]);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(FIXTURE_SIMULATION_ID);
    expect(body.origin).toBe('ai');
  });

  it('NÃO chama createSimulation() no reenvio idempotente', async () => {
    mockIdempotencyRows.mockReturnValue([
      {
        key: `POST:/internal/simulations:${FIXTURE_IDEMPOTENCY_KEY}`,
        endpoint: 'POST /internal/simulations',
        requestHash: FIXTURE_SIMULATION_ID,
        responseStatus: 201,
        responseBody: { simulation_id: FIXTURE_SIMULATION_ID },
        createdAt: new Date(),
      },
    ]);
    mockSimulationRows.mockReturnValue([makeDbSimulation()]);

    await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    // Confirma que o service NÃO foi chamado (sem novo INSERT, sem novo outbox)
    expect(mockCreateSimulation).not.toHaveBeenCalled();
  });

  it('retorna 500 se response_body do cache está corrompido', async () => {
    mockIdempotencyRows.mockReturnValue([
      {
        key: `POST:/internal/simulations:${FIXTURE_IDEMPOTENCY_KEY}`,
        endpoint: 'POST /internal/simulations',
        requestHash: 'x',
        responseStatus: 201,
        // payload inválido — simulation_id ausente
        responseBody: { bad_field: 'xxx' },
        createdAt: new Date(),
      },
    ]);

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(500);
    // EXTERNAL_SERVICE_ERROR é o código usado para erros internos de estado
    // (INTERNAL_ERROR não está no ErrorCode union de shared/errors.ts).
    expect(res.json().error).toBe('EXTERNAL_SERVICE_ERROR');
  });
});

// ===========================================================================
// Suite 3: 401 autenticação
// ===========================================================================

describe('POST /internal/simulations — 401 autenticação', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 401 sem X-Internal-Token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('UNAUTHORIZED');
  });

  it('retorna 401 com token errado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders('wrong-token'),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('UNAUTHORIZED');
  });
});

// ===========================================================================
// Suite 4: 400 body inválido
// ===========================================================================

describe('POST /internal/simulations — 400 body inválido', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 400 quando idempotencyKey está ausente', async () => {
    const { idempotencyKey: _removed, ...bodyWithoutKey } = VALID_BODY;

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: bodyWithoutKey,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('retorna 400 quando idempotencyKey não é UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: { ...VALID_BODY, idempotencyKey: 'nao-e-uuid' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('retorna 400 quando leadId não é UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: { ...VALID_BODY, leadId: 'nao-e-uuid' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('retorna 400 quando amount é zero', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: { ...VALID_BODY, amount: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('retorna 400 quando organizationId está ausente', async () => {
    const { organizationId: _removed, ...bodyWithoutOrg } = VALID_BODY;

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: bodyWithoutOrg,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// Suite 5: erros da service layer (422, 409, 404, 403)
// ===========================================================================

describe('POST /internal/simulations — erros da service layer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    // Idempotência: chave não existe
    mockIdempotencyRows.mockReturnValue([]);
  });

  it('retorna 422 quando amount fora dos limites da regra', async () => {
    const { SimulationOutOfRangError } = await import('../service.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new SimulationOutOfRangError('amount', 500, 5000, 50),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(body.details).toMatchObject({ field: 'amount', min: 500, max: 5000, actual: 50 });
  });

  it('retorna 409 quando não há regra ativa para a cidade do lead', async () => {
    const { NoActiveRuleForCityError } = await import('../service.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new NoActiveRuleForCityError('city-uuid-000-000-000000000001'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error).toBe('CONFLICT');
    expect(body.details).toMatchObject({ code: 'no_active_rule_for_city' });
  });

  it('retorna 404 quando produto não existe ou está inativo', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new NotFoundError('Produto de crédito não encontrado ou inativo'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('retorna 403 quando lead está fora do city scope', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockCreateSimulation.mockRejectedValueOnce(
      new ForbiddenError('Lead não encontrado ou fora do escopo do usuário'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/internal/simulations',
      headers: makeHeaders(),
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
  });
});
