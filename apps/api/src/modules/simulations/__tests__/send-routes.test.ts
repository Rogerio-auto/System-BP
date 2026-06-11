// =============================================================================
// simulations/__tests__/send-routes.test.ts — Testes do endpoint POST /api/simulations/:id/send (F14-S05).
//
// Estratégia: sobe Fastify com simulationsRoutes, mocka authenticate/authorize/
// featureGate para controlar contexto, mocka service para controlar dados.
//
// Cobre:
//   1. POST /api/simulations/:id/send → 200 caminho feliz (status 'sent')
//   2. POST /api/simulations/:id/send → 200 idempotente (status 'already_sent')
//   3. POST /api/simulations/:id/send → 404 simulação não encontrada
//   4. POST /api/simulations/:id/send → 403 lead fora do city scope
//   5. POST /api/simulations/:id/send → 422 lead sem telefone
//   6. POST /api/simulations/:id/send → 403 feature flag desabilitada
//   7. POST /api/simulations/:id/send → 403 sem permissão simulations:send
//   8. POST /api/simulations/:id/send → 400 Idempotency-Key ausente/inválida
//   9. POST /api/simulations/:id/send → 502 Meta não configurada
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
    (opts: { permissions: string[] }) => async (request: { user?: { permissions: string[] } }) => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      if (!request.user) throw new ForbiddenError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock featureGate (controlável por teste)
// ---------------------------------------------------------------------------
const mockFeatureGateSendEnabled = vi.fn<() => boolean>().mockReturnValue(true);

vi.mock('../../../plugins/featureGate.js', () => ({
  featureGate: (key: string) => async (_request: unknown) => {
    const { FeatureDisabledError } = await import('../../../shared/errors.js');
    if (key === 'simulations.send.enabled' && !mockFeatureGateSendEnabled()) {
      throw new FeatureDisabledError('simulations.send.enabled');
    }
  },
  isFlagEnabled: vi.fn().mockResolvedValue({ enabled: true, status: 'enabled' }),
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
const mockSendSimulation = vi.fn();
const mockCreateSimulation = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    sendSimulation: (...args: unknown[]) => mockSendSimulation(...args),
    createSimulation: (...args: unknown[]) => mockCreateSimulation(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock repository (para GET /api/leads/:id/simulations)
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
const FIXTURE_SIMULATION_ID = 'ffffffff-0000-0000-0000-000000000001';
const FIXTURE_IDEMPOTENCY_KEY = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_WAMID = 'wamid.test.123456789';

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['simulations:send', 'simulations:create', 'simulations:read'],
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

  await app.register(simulationsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Helper: injeta request com Idempotency-Key
// ---------------------------------------------------------------------------

function buildSendRequest(
  simulationId: string = FIXTURE_SIMULATION_ID,
  idempotencyKey: string = FIXTURE_IDEMPOTENCY_KEY,
) {
  return {
    method: 'POST' as const,
    url: `/api/simulations/${simulationId}/send`,
    headers: {
      'idempotency-key': idempotencyKey,
      // Sem content-type: endpoint não tem body; enviar 'application/json'
      // sem body causa FastifyError do body parser.
    },
    // Sem payload: exactOptionalPropertyTypes proíbe payload: undefined
  };
}

// ===========================================================================
// POST /api/simulations/:id/send — caminho feliz
// ===========================================================================

describe('POST /api/simulations/:id/send — caminho feliz (sent)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateSendEnabled.mockReturnValue(true);
  });

  it('retorna 200 com status "sent" e wamid', async () => {
    mockSendSimulation.mockResolvedValueOnce({
      status: 'sent',
      sent_message_id: FIXTURE_WAMID,
    });

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['status']).toBe('sent');
    expect(body['sent_message_id']).toBe(FIXTURE_WAMID);

    // Verifica que service foi chamado com parâmetros corretos
    expect(mockSendSimulation).toHaveBeenCalledOnce();
    const [, actorArg, simIdArg, optsArg] = mockSendSimulation.mock.calls[0] as unknown[];
    expect(simIdArg).toBe(FIXTURE_SIMULATION_ID);
    expect((actorArg as Record<string, unknown>)['organizationId']).toBe(FIXTURE_ORG_ID);
    expect((optsArg as Record<string, unknown>)['idempotencyKey']).toBe(FIXTURE_IDEMPOTENCY_KEY);
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — idempotente (already_sent)
// ===========================================================================

describe('POST /api/simulations/:id/send — idempotente (already_sent)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateSendEnabled.mockReturnValue(true);
  });

  it('retorna 200 com status "already_sent" quando Idempotency-Key já usada', async () => {
    mockSendSimulation.mockResolvedValueOnce({
      status: 'already_sent',
      sent_message_id: null,
    });

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['status']).toBe('already_sent');
    expect(body['sent_message_id']).toBeNull();
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — 404 não encontrada
// ===========================================================================

describe('POST /api/simulations/:id/send — 404 simulação não encontrada', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateSendEnabled.mockReturnValue(true);
  });

  it('retorna 404 quando simulação não existe', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockSendSimulation.mockRejectedValueOnce(
      new NotFoundError(`Simulação ${FIXTURE_SIMULATION_ID} não encontrada`),
    );

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — 403 lead fora do city scope
// ===========================================================================

describe('POST /api/simulations/:id/send — 403 lead fora do city scope', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateSendEnabled.mockReturnValue(true);
  });

  it('retorna 403 quando lead está fora do city scope do usuário', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockSendSimulation.mockRejectedValueOnce(
      new ForbiddenError('Lead não encontrado ou fora do escopo do usuário'),
    );

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — 422 lead sem telefone
// ===========================================================================

describe('POST /api/simulations/:id/send — 422 lead sem telefone', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateSendEnabled.mockReturnValue(true);
  });

  it('retorna 422 quando lead não possui número de telefone', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockSendSimulation.mockRejectedValueOnce(
      new AppError(
        422,
        'VALIDATION_ERROR',
        'Lead não possui número de telefone cadastrado — não é possível enviar via WhatsApp',
        { code: 'lead_no_phone' },
      ),
    );

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(422);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('VALIDATION_ERROR');
    expect((body['details'] as Record<string, unknown>)['code']).toBe('lead_no_phone');
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — 403 feature flag desabilitada
// ===========================================================================

describe('POST /api/simulations/:id/send — 403 feature flag desabilitada', () => {
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

  it('retorna 403 quando simulations.send.enabled está desabilitada', async () => {
    mockFeatureGateSendEnabled.mockReturnValue(false);

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FEATURE_DISABLED');
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — 403 sem permissão
// ===========================================================================

describe('POST /api/simulations/:id/send — 403 sem permissão', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Usuário sem simulations:send
    app = await buildTestApp(['simulations:read']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 403 quando usuário não tem simulations:send', async () => {
    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — 400 Idempotency-Key inválida
// ===========================================================================

describe('POST /api/simulations/:id/send — 400 Idempotency-Key inválida', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateSendEnabled.mockReturnValue(true);
  });

  it('retorna 400 quando Idempotency-Key não é UUID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/simulations/${FIXTURE_SIMULATION_ID}/send`,
      headers: {
        'idempotency-key': 'nao-e-uuid',
        // Sem content-type para evitar FastifyError do body parser
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json<Record<string, unknown>>()['error']).toBe('VALIDATION_ERROR');
  });

  it('retorna 400 quando Idempotency-Key está ausente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/simulations/${FIXTURE_SIMULATION_ID}/send`,
      // Sem header Idempotency-Key e sem content-type
    });

    // Sem header Idempotency-Key → Zod schema de headers retorna 400
    expect(res.statusCode).toBe(400);
  });
});

// ===========================================================================
// POST /api/simulations/:id/send — 502 Meta não configurada
// ===========================================================================

describe('POST /api/simulations/:id/send — 502 Meta não configurada', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatureGateSendEnabled.mockReturnValue(true);
  });

  it('retorna 502 quando Meta WhatsApp não está configurado', async () => {
    const { ExternalServiceError } = await import('../../../shared/errors.js');
    mockSendSimulation.mockRejectedValueOnce(
      new ExternalServiceError(
        'Meta WhatsApp não configurado — não é possível enviar a simulação',
        { code: 'meta_not_configured' },
      ),
    );

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(502);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('EXTERNAL_SERVICE_ERROR');
    expect((body['details'] as Record<string, unknown>)['code']).toBe('meta_not_configured');
  });

  it('retorna 502 quando Meta retorna erro de API', async () => {
    const { ExternalServiceError } = await import('../../../shared/errors.js');
    mockSendSimulation.mockRejectedValueOnce(
      new ExternalServiceError(
        'Falha ao enviar simulação via WhatsApp: Meta WhatsApp API 500: Unknown error',
        {
          upstreamStatus: 500,
        },
      ),
    );

    const res = await app.inject(buildSendRequest());

    expect(res.statusCode).toBe(502);
    expect(res.json<Record<string, unknown>>()['error']).toBe('EXTERNAL_SERVICE_ERROR');
  });
});
