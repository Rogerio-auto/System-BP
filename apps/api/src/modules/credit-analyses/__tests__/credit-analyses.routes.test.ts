// =============================================================================
// credit-analyses/routes.test.ts — Testes de integração (F4-S02).
//
// Estratégia: sobe Fastify com creditAnalysesRoutes, mocka authenticate/authorize
// para simular usuário autenticado, mocka service para controlar dados.
//
// Cobre (>= 10 testes):
//   1.  GET /api/credit-analyses → 200 lista paginada
//   2.  GET /api/credit-analyses/:id → 200 com análise
//   3.  GET /api/credit-analyses/:id → 404 não encontrada
//   4.  GET /api/leads/:leadId/credit-analyses → 200 histórico do lead
//   5.  GET /api/leads/:leadId/credit-analyses → 403 lead fora do scope
//   6.  POST /api/credit-analyses → 201 análise criada
//   7.  POST /api/credit-analyses → 400 body inválido (sem lead_id)
//   8.  POST /api/credit-analyses → 400 DLP CPF no parecer_text
//   9.  POST /api/credit-analyses/:id/versions → 201 nova versão
//   10. POST /api/credit-analyses/:id/decide → 200 aprovado
//   11. POST /api/credit-analyses/:id/decide → 409 status inválido para decisão
//   12. POST /api/credit-analyses/:id/request-review → 200 Art. 20 §5
//   13. RBAC: admin ✅ pode acessar; usuário sem permissão → 403
//   14. city-scope: gestor_regional dentro da cidade ✅, fora ❌ 404
//   15. DLP RG: RG bruto no parecer_text → 400
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
    // no-op: request.user injetado pelo hook global no buildTestApp
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
const mockListAnalyses = vi.fn();
const mockGetAnalysisById = vi.fn();
const mockListAnalysesByLead = vi.fn();
const mockAssertLeadAccess = vi.fn();
const mockCreateAnalysis = vi.fn();
const mockAddVersion = vi.fn();
const mockDecideAnalysis = vi.fn();
const mockRequestReview = vi.fn();

vi.mock('../service.js', () => ({
  listAnalyses: (...args: unknown[]) => mockListAnalyses(...args),
  getAnalysisById: (...args: unknown[]) => mockGetAnalysisById(...args),
  listAnalysesByLead: (...args: unknown[]) => mockListAnalysesByLead(...args),
  assertLeadAccess: (...args: unknown[]) => mockAssertLeadAccess(...args),
  createAnalysis: (...args: unknown[]) => mockCreateAnalysis(...args),
  addVersion: (...args: unknown[]) => mockAddVersion(...args),
  decideAnalysis: (...args: unknown[]) => mockDecideAnalysis(...args),
  requestReview: (...args: unknown[]) => mockRequestReview(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_ACTOR_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_ANALYSIS_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_VERSION_ID = 'eeeeeeee-0000-0000-0000-000000000001';

const ALL_PERMS = [
  'credit_analyses:read',
  'credit_analyses:write',
  'credit_analyses:decide',
  'credit_analyses:request_review',
];

function makeVersionResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_VERSION_ID,
    analysis_id: FIXTURE_ANALYSIS_ID,
    version: 1,
    status: 'em_analise',
    parecer_text: 'Parecer inicial da análise de crédito do solicitante.',
    pendencias: [],
    attachments: [],
    author_user_id: FIXTURE_ACTOR_ID,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeAnalysisResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_ANALYSIS_ID,
    organization_id: FIXTURE_ORG_ID,
    lead_id: FIXTURE_LEAD_ID,
    customer_id: null,
    simulation_id: null,
    current_version_id: FIXTURE_VERSION_ID,
    status: 'em_analise',
    approved_amount: null,
    approved_term_months: null,
    approved_rate_monthly: null,
    internal_score: null,
    analyst_user_id: FIXTURE_ACTOR_ID,
    origin: 'manual',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_version: makeVersionResponse(),
    ...overrides,
  };
}

const CREATE_PAYLOAD = {
  lead_id: FIXTURE_LEAD_ID,
  parecer_text: 'Análise inicial do solicitante. Documentação completa recebida.',
  status: 'em_analise',
  pendencias: [],
  attachments: [],
  origin: 'manual',
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ALL_PERMS,
  cityScopeIds: string[] | null = null,
): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { creditAnalysesRoutes },
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

  // Injetar request.user (simula authenticate())
  app.addHook('preHandler', async (request) => {
    request.user = {
      id: FIXTURE_ACTOR_ID,
      organizationId: FIXTURE_ORG_ID,
      permissions,
      cityScopeIds,
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

  await app.register(creditAnalysesRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// GET /api/credit-analyses
// ---------------------------------------------------------------------------

describe('GET /api/credit-analyses', () => {
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
    mockListAnalyses.mockResolvedValue({
      data: [makeAnalysisResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/credit-analyses' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('retorna 403 quando usuário não tem credit_analyses:read', async () => {
    const restrictedApp = await buildTestApp([]);
    const res = await restrictedApp.inject({ method: 'GET', url: '/api/credit-analyses' });
    expect(res.statusCode).toBe(403);
    await restrictedApp.close();
  });
});

// ---------------------------------------------------------------------------
// GET /api/credit-analyses/:id
// ---------------------------------------------------------------------------

describe('GET /api/credit-analyses/:id', () => {
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

  it('retorna 200 com análise e current_version hidratada', async () => {
    mockGetAnalysisById.mockResolvedValue(makeAnalysisResponse());

    const res = await app.inject({
      method: 'GET',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_ANALYSIS_ID);
    expect(body['current_version']).not.toBeNull();
    // internal_score deve ser null (nunca exposto na rota pública)
    expect(body['internal_score']).toBeNull();
  });

  it('retorna 404 quando análise não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetAnalysisById.mockRejectedValue(new NotFoundError('Análise de crédito não encontrada'));

    const res = await app.inject({
      method: 'GET',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });

  it('retorna 404 para gestor_regional fora do city-scope (city-scope enforced no service)', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    // O service retorna NotFoundError quando o análise não está no city-scope
    mockGetAnalysisById.mockRejectedValue(new NotFoundError('Análise de crédito não encontrada'));

    const cityRestrictedApp = await buildTestApp(ALL_PERMS, ['outra-cidade-uuid']);
    const res = await cityRestrictedApp.inject({
      method: 'GET',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}`,
    });

    expect(res.statusCode).toBe(404);
    await cityRestrictedApp.close();
  });
});

// ---------------------------------------------------------------------------
// GET /api/leads/:leadId/credit-analyses
// ---------------------------------------------------------------------------

describe('GET /api/leads/:leadId/credit-analyses', () => {
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

  it('retorna 200 com histórico de análises do lead', async () => {
    mockAssertLeadAccess.mockResolvedValue(undefined);
    mockListAnalysesByLead.mockResolvedValue({
      data: [makeAnalysisResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}/credit-analyses`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('retorna 403 quando lead está fora do scope do usuário', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockAssertLeadAccess.mockRejectedValue(
      new ForbiddenError('Lead não encontrado ou fora do escopo do usuário'),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/leads/${FIXTURE_LEAD_ID}/credit-analyses`,
    });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/credit-analyses
// ---------------------------------------------------------------------------

describe('POST /api/credit-analyses', () => {
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

  it('retorna 201 com análise criada', async () => {
    mockCreateAnalysis.mockResolvedValue(makeAnalysisResponse());

    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-analyses',
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_ANALYSIS_ID);
    expect(body['status']).toBe('em_analise');
  });

  it('retorna 400 quando lead_id está ausente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-analyses',
      payload: {
        parecer_text: 'Análise inicial sem lead_id.',
        status: 'em_analise',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 DLP: rejeita CPF bruto no parecer_text (LGPD Art. 20 §1º)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-analyses',
      payload: {
        ...CREATE_PAYLOAD,
        parecer_text: 'Solicitante CPF 123.456.789-00 aprovado conforme análise.',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<Record<string, unknown>>();
    // Verificar mensagem de erro clara sobre LGPD
    const details = body['details'];
    expect(JSON.stringify(details)).toMatch(/CPF/i);
  });

  it('retorna 400 DLP: rejeita RG bruto no parecer_text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/credit-analyses',
      payload: {
        ...CREATE_PAYLOAD,
        parecer_text: 'RG 1.234.567-8 confirmado pelo atendente.',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<Record<string, unknown>>();
    expect(JSON.stringify(body['details'])).toMatch(/RG/i);
  });

  it('retorna 403 quando usuário não tem credit_analyses:write', async () => {
    const restrictedApp = await buildTestApp(['credit_analyses:read']);
    const res = await restrictedApp.inject({
      method: 'POST',
      url: '/api/credit-analyses',
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
    await restrictedApp.close();
  });
});

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/versions
// ---------------------------------------------------------------------------

describe('POST /api/credit-analyses/:id/versions', () => {
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

  it('retorna 201 com análise atualizada para nova versão', async () => {
    mockAddVersion.mockResolvedValue(
      makeAnalysisResponse({
        status: 'pendente',
        current_version: makeVersionResponse({ status: 'pendente', version: 2 }),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/versions`,
      payload: {
        parecer_text: 'Aguardando documentação complementar para prosseguir análise.',
        status: 'pendente',
        pendencias: [{ tipo: 'Documento', descricao: 'Comprovante de renda atualizado' }],
        attachments: [],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['status']).toBe('pendente');
  });
});

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/decide
// ---------------------------------------------------------------------------

describe('POST /api/credit-analyses/:id/decide', () => {
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

  it('retorna 200 ao aprovar análise com campos financeiros', async () => {
    mockDecideAnalysis.mockResolvedValue(
      makeAnalysisResponse({
        status: 'aprovado',
        approved_amount: '5000.00',
        approved_term_months: 12,
        approved_rate_monthly: '0.025000',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/decide`,
      payload: {
        decision: 'aprovado',
        parecer_text: 'Análise concluída com êxito. Crédito aprovado conforme política vigente.',
        approved_amount: 5000,
        approved_term_months: 12,
        approved_rate_monthly: 0.025,
        pendencias: [],
        attachments: [],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['status']).toBe('aprovado');
    expect(body['approved_amount']).toBe('5000.00');
  });

  it('retorna 409 quando status atual impede decisão', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockDecideAnalysis.mockRejectedValue(
      new AppError(409, 'CONFLICT', 'Não é possível decidir análise com status "cancelado".', {
        code: 'INVALID_STATUS_TRANSITION',
        current_status: 'cancelado',
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/decide`,
      payload: {
        decision: 'recusado',
        parecer_text: 'Crédito recusado por inadimplência histórica superior ao limite.',
        pendencias: [],
        attachments: [],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<Record<string, unknown>>()['error']).toBe('CONFLICT');
  });

  it('retorna 403 quando usuário não tem credit_analyses:decide', async () => {
    const restrictedApp = await buildTestApp(['credit_analyses:read', 'credit_analyses:write']);
    const res = await restrictedApp.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/decide`,
      payload: {
        decision: 'aprovado',
        parecer_text: 'Tentativa sem permissão de decide.',
        approved_amount: 1000,
        approved_term_months: 6,
        approved_rate_monthly: 0.02,
      },
    });
    expect(res.statusCode).toBe(403);
    await restrictedApp.close();
  });
});

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/request-review
// ---------------------------------------------------------------------------

describe('POST /api/credit-analyses/:id/request-review (Art. 20 §5 LGPD)', () => {
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

  it('retorna 200 ao solicitar revisão humana (Art. 20 §5)', async () => {
    mockRequestReview.mockResolvedValue(
      makeAnalysisResponse({
        status: 'em_analise',
        current_version: makeVersionResponse({
          status: 'em_analise',
          version: 2,
          parecer_text: 'Revisão solicitada pelo titular (LGPD Art. 20 §5)',
        }),
      }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/request-review`,
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    // Status resetado para em_analise (bloqueia decisão automática)
    expect(body['status']).toBe('em_analise');
  });

  it('retorna 200 com motivo de revisão opcional', async () => {
    mockRequestReview.mockResolvedValue(makeAnalysisResponse({ status: 'em_analise' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/request-review`,
      payload: {
        reason: 'Não concordo com a decisão de recusa. Solicito revisão por analista humano.',
      },
    });

    expect(res.statusCode).toBe(200);
  });

  it('retorna 400 DLP: rejeita CPF no motivo de revisão', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/request-review`,
      payload: {
        reason: 'Meu CPF 123.456.789-00 está correto. Solicito revisão.',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toMatch(/CPF/i);
  });

  it('retorna 403 para agente que não tem leads atribuídos no scope', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockRequestReview.mockRejectedValue(
      new ForbiddenError('Análise não encontrada ou fora do escopo'),
    );

    // App com apenas request_review (simula agente)
    const agentApp = await buildTestApp(['credit_analyses:request_review']);
    const res = await agentApp.inject({
      method: 'POST',
      url: `/api/credit-analyses/${FIXTURE_ANALYSIS_ID}/request-review`,
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    await agentApp.close();
  });
});
