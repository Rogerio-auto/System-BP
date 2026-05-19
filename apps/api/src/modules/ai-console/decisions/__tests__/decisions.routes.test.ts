// =============================================================================
// ai-console/decisions/__tests__/decisions.routes.test.ts — Testes de integração (F9-S02).
//
// Estratégia: sobe Fastify com decisionsRoutes, mocka authenticate/authorize
// e service para controlar contexto e dados sem tocar no banco real.
//
// Cobre:
//   1.  RBAC: admin vê lista — 200
//   2.  RBAC: gestor_geral vê lista — 200
//   3.  RBAC: gestor_regional vê lista — 200 (city-scoped)
//   4.  RBAC: agente sem ai_decisions:read — 403
//   5.  RBAC: sem autenticação — 403
//   6.  GET /     → 200 com dados paginados (admin)
//   7.  GET /     → 200 cursor pagination — next_cursor presente quando hasNextPage
//   8.  GET /     → 200 next_cursor null quando última página
//   9.  GET /timeline → 200 com dados de conversa
//   10. GET /timeline → 404 conversa não encontrada no escopo
//   11. Masking: PII em `decision` jsonb não vaza na resposta (CPF, email, telefone)
//   12. Custo: cost_usd e cost_brl presentes quando service retorna valores
//   13. Custo: cost_usd e cost_brl null quando modelo sem entry em model_pricing
//   14. Gestor regional não vê decisão fora do escopo — 404 (não 403)
//   15. Query params: cursor + limit validados
//   16. GET /timeline → obrigatório conversation_id — 400 sem ele
// =============================================================================
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppError } from '../../../../shared/errors.js';
import { decisionsRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Mock env (evita process.exit por FX_BRL_PER_USD ausente em test setup)
// A var não está no setup.ts — mocked aqui para evitar dependência de infra.
// ---------------------------------------------------------------------------
vi.mock('../../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    API_PUBLIC_URL: 'http://localhost:3333',
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'test-access-secret-used-only-in-vitest-do-not-use-in-production-00000000',
    JWT_REFRESH_SECRET: 'test-refresh-secret-used-only-in-vitest-do-not-use-in-production-0000000',
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'test-langgraph-token-vitest-only-00',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-app-secret-vitest-only',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token-vitest',
    CHATWOOT_WEBHOOK_HMAC_SECRET: 'test-chatwoot-hmac-secret-vitest',
    LGPD_DATA_KEY: 'P5Uc4j/vdAisFljJ0kdz08PLWmPvMC/NX5VIy99Bv+E=',
    LGPD_DEDUPE_PEPPER: 'xgRqlH8Ag8bV/DI9gza3qIFx0w4RF3f9ZF/RSilyV2s=',
    FX_BRL_PER_USD: 5.4,
  },
}));

// ---------------------------------------------------------------------------
// Mock lib/pricing.ts (evita round-trip ao DB em testes de rota)
// O serviço usa o mock de service.ts — mas pricing.ts é importado no módulo,
// então precisa de mock próprio para evitar conexão real ao banco.
// ---------------------------------------------------------------------------
vi.mock('../../../../lib/pricing.js', () => ({
  priceModelTokens: vi.fn().mockResolvedValue({ costUsd: 0.00025, costBrl: 0.00135 }),
  computeCostFromRates: vi.fn().mockReturnValue({ costUsd: 0.00025, costBrl: 0.00135 }),
}));

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real ao banco em CI)
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
// Mock authenticate — no-op; request.user injetado via addHook no buildTestApp
// ---------------------------------------------------------------------------
vi.mock('../../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op
  },
}));

// ---------------------------------------------------------------------------
// Mock authorize — verifica permissions do request.user injetado
// ---------------------------------------------------------------------------
vi.mock('../../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) => async (request: { user?: { permissions: string[] } }) => {
      const { ForbiddenError } = await import('../../../../shared/errors.js');
      if (!request.user) throw new ForbiddenError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock db/client — sem conexão real
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockListDecisionsSvc = vi.fn();
const mockGetTimelineSvc = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listDecisionsSvc: (...args: unknown[]) => mockListDecisionsSvc(...args),
    getTimelineSvc: (...args: unknown[]) => mockGetTimelineSvc(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_DECISION_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CONVERSATION_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const FIXTURE_CORRELATION_ID = 'ffffffff-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'cccccccc-0000-0000-0000-000000000002';

function makeDecisionItem(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_DECISION_ID,
    conversation_id: FIXTURE_CONVERSATION_ID,
    lead_id: FIXTURE_LEAD_ID,
    customer_id: null,
    node_name: 'classify_intent',
    intent: 'quer_simular',
    prompt_key: 'intent_classifier',
    prompt_version: 'intent_classifier@v3',
    model: 'anthropic/claude-3-5-sonnet',
    tokens_in: 500,
    tokens_out: 120,
    latency_ms: 350,
    decision: { next_node: 'generate_simulation', intent: 'quer_simular' },
    error: null,
    correlation_id: FIXTURE_CORRELATION_ID,
    cost_usd: 0.00025,
    cost_brl: 0.00135,
    created_at: new Date('2026-05-19T10:00:00.000Z').toISOString(),
    ...overrides,
  };
}

function makeListResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: [makeDecisionItem()],
    next_cursor: null,
    next_id_cursor: null,
    total_on_page: 1,
    ...overrides,
  };
}

function makeTimelineResponse(overrides: Record<string, unknown> = {}) {
  return {
    conversation_id: FIXTURE_CONVERSATION_ID,
    data: [makeDecisionItem()],
    total: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app helper
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions: string[] = ['ai_decisions:read'],
  cityScopeIds: string[] | null = null, // null = admin/gestor_geral (global)
  injectUser = true,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (injectUser) {
    app.addHook('preHandler', async (request) => {
      request.user = {
        id: FIXTURE_USER_ID,
        organizationId: FIXTURE_ORG_ID,
        permissions,
        cityScopeIds,
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

  await app.register(decisionsRoutes, { prefix: '/api/ai-console/decisions' });
  return app;
}

// ---------------------------------------------------------------------------
// App compartilhado (admin — global scope)
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp(['ai_decisions:read'], null);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Suite: listagem paginada GET /
// ---------------------------------------------------------------------------

describe('GET /api/ai-console/decisions', () => {
  it('admin vê lista de decisões — 200', async () => {
    mockListDecisionsSvc.mockResolvedValue(makeListResponse());

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(Array.isArray(body['data'])).toBe(true);
    expect(body['total_on_page']).toBe(1);
  });

  it('retorna next_cursor quando há próxima página', async () => {
    const cursor = '2026-05-19T09:00:00.000Z';
    const idCursor = FIXTURE_DECISION_ID;
    mockListDecisionsSvc.mockResolvedValue(
      makeListResponse({ next_cursor: cursor, next_id_cursor: idCursor }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['next_cursor']).toBe(cursor);
    expect(body['next_id_cursor']).toBe(idCursor);
  });

  it('retorna next_cursor null quando última página', async () => {
    mockListDecisionsSvc.mockResolvedValue(makeListResponse({ next_cursor: null }));

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['next_cursor']).toBeNull();
    expect(body['next_id_cursor']).toBeNull();
  });

  it('aceita filtros opcionais via query params', async () => {
    mockListDecisionsSvc.mockResolvedValue(makeListResponse());

    const res = await app.inject({
      method: 'GET',
      url: `/api/ai-console/decisions?conversation_id=${FIXTURE_CONVERSATION_ID}&lead_id=${FIXTURE_LEAD_ID}&node_name=classify_intent&limit=10`,
    });

    expect(res.statusCode).toBe(200);
    // Verifica que o service recebeu o query corretamente
    expect(mockListDecisionsSvc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: FIXTURE_ORG_ID,
        cityScopeIds: null,
      }),
      expect.objectContaining({
        conversation_id: FIXTURE_CONVERSATION_ID,
        lead_id: FIXTURE_LEAD_ID,
        node_name: 'classify_intent',
        limit: 10,
      }),
    );
  });

  it('retorna custo quando service fornece cost_usd e cost_brl', async () => {
    mockListDecisionsSvc.mockResolvedValue(
      makeListResponse({
        data: [makeDecisionItem({ cost_usd: 0.00025, cost_brl: 0.00135 })],
      }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data[0]?.['cost_usd']).toBe(0.00025);
    expect(body.data[0]?.['cost_brl']).toBe(0.00135);
  });

  it('retorna cost_usd e cost_brl null para modelo sem entry em model_pricing', async () => {
    mockListDecisionsSvc.mockResolvedValue(
      makeListResponse({
        data: [makeDecisionItem({ cost_usd: null, cost_brl: null })],
      }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data[0]?.['cost_usd']).toBeNull();
    expect(body.data[0]?.['cost_brl']).toBeNull();
  });

  it('limit inválido (0) retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai-console/decisions?limit=0',
    });

    expect(res.statusCode).toBe(400);
  });

  it('limit inválido (>100) retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai-console/decisions?limit=101',
    });

    expect(res.statusCode).toBe(400);
  });

  it('conversation_id inválido (não UUID) retorna 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai-console/decisions?conversation_id=nao-e-uuid',
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Suite: timeline GET /timeline
// ---------------------------------------------------------------------------

describe('GET /api/ai-console/decisions/timeline', () => {
  it('retorna timeline de conversa — 200', async () => {
    mockGetTimelineSvc.mockResolvedValue(makeTimelineResponse());

    const res = await app.inject({
      method: 'GET',
      url: `/api/ai-console/decisions/timeline?conversation_id=${FIXTURE_CONVERSATION_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['conversation_id']).toBe(FIXTURE_CONVERSATION_ID);
    expect(Array.isArray(body['data'])).toBe(true);
    expect(body['total']).toBe(1);
  });

  it('retorna 404 quando conversa não encontrada no escopo', async () => {
    const { NotFoundError } = await import('../../../../shared/errors.js');
    mockGetTimelineSvc.mockRejectedValue(
      new NotFoundError(`Conversa '${FIXTURE_CONVERSATION_ID}' não encontrada no seu escopo`),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/ai-console/decisions/timeline?conversation_id=${FIXTURE_CONVERSATION_ID}`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('NOT_FOUND');
  });

  it('retorna 400 quando conversation_id ausente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai-console/decisions/timeline',
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando conversation_id inválido (não UUID)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ai-console/decisions/timeline?conversation_id=nao-e-uuid',
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Suite: RBAC
// ---------------------------------------------------------------------------

describe('RBAC — ai_decisions:read', () => {
  it('gestor_geral pode ver lista — 200', async () => {
    const gestorApp = await buildTestApp(['ai_decisions:read'], null);
    mockListDecisionsSvc.mockResolvedValue(makeListResponse());

    const res = await gestorApp.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(200);
    await gestorApp.close();
  });

  it('gestor_regional com city-scope pode ver lista — 200', async () => {
    const regionalApp = await buildTestApp(['ai_decisions:read'], [FIXTURE_CITY_ID]);
    mockListDecisionsSvc.mockResolvedValue(makeListResponse());

    const res = await regionalApp.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(200);
    // Verifica que o service recebeu cityScopeIds correto
    expect(mockListDecisionsSvc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cityScopeIds: [FIXTURE_CITY_ID],
      }),
      expect.anything(),
    );
    await regionalApp.close();
  });

  it('gestor_regional fora do escopo recebe 404 na timeline — não 403', async () => {
    const { NotFoundError } = await import('../../../../shared/errors.js');
    const regionalApp = await buildTestApp(['ai_decisions:read'], [FIXTURE_CITY_ID]);
    // Simula que a conversa existe mas está fora do escopo → NotFoundError (oracle de existência)
    mockGetTimelineSvc.mockRejectedValue(
      new NotFoundError(`Conversa '${FIXTURE_CONVERSATION_ID}' não encontrada no seu escopo`),
    );

    const res = await regionalApp.inject({
      method: 'GET',
      url: `/api/ai-console/decisions/timeline?conversation_id=${FIXTURE_CONVERSATION_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
    await regionalApp.close();
  });

  it('agente sem ai_decisions:read não pode ver lista — 403', async () => {
    const agenteApp = await buildTestApp(['leads:read'], null); // sem ai_decisions:read

    const res = await agenteApp.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
    await agenteApp.close();
  });

  it('agente sem ai_decisions:read não pode ver timeline — 403', async () => {
    const agenteApp = await buildTestApp(['leads:read'], null);

    const res = await agenteApp.inject({
      method: 'GET',
      url: `/api/ai-console/decisions/timeline?conversation_id=${FIXTURE_CONVERSATION_ID}`,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
    await agenteApp.close();
  });

  it('sem autenticação retorna 403', async () => {
    const noUserApp = await buildTestApp([], null, false); // sem request.user

    const res = await noUserApp.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    expect([401, 403]).toContain(res.statusCode);
    await noUserApp.close();
  });
});

// ---------------------------------------------------------------------------
// Suite: masking defensivo de PII
// ---------------------------------------------------------------------------

describe('Masking defensivo de PII em decision jsonb', () => {
  it('não expõe CPF injetado em decision na resposta', async () => {
    // Fixture com CPF injetado no campo decision (simula falha no DLP upstream)
    mockListDecisionsSvc.mockResolvedValue(
      makeListResponse({
        data: [
          makeDecisionItem({
            decision: { intent: 'quer_simular', debug_cpf: '123.456.789-01' },
          }),
        ],
      }),
    );

    const res = await app.inject({ method: 'GET', url: '/api/ai-console/decisions' });

    // O service (mockado) retorna o decision mascarado — mas aqui testamos o mock diretamente.
    // O teste real do masking está em service.test.ts (unit test do maskDecision).
    // Aqui garantimos que a rota não rejeita o campo mascarado '<masked>'.
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    // O service mock retorna os dados como fornecidos — o masking real é testado abaixo.
    expect(body.data[0]).toBeDefined();
  });

  it('masking defensivo: CPF em string dentro de decision é substituído por <masked>', async () => {
    // Testa diretamente a função de masking exportada do service
    const { applyDecisionMasking } = await import('../service.js');

    const withCpf = {
      intent: 'quer_simular',
      context: 'Cliente CPF 123.456.789-01 solicitou crédito',
    };
    const masked = applyDecisionMasking(withCpf);

    expect(JSON.stringify(masked)).not.toContain('123.456.789-01');
    expect(JSON.stringify(masked)).toContain('<masked>');
  });

  it('masking defensivo: e-mail em string dentro de decision é substituído por <masked>', async () => {
    const { applyDecisionMasking } = await import('../service.js');

    const withEmail = {
      intent: 'quer_simular',
      contact: 'cliente@exemplo.com.br',
    };
    const masked = applyDecisionMasking(withEmail);

    expect(JSON.stringify(masked)).not.toContain('cliente@exemplo.com.br');
    expect(JSON.stringify(masked)).toContain('<masked>');
  });

  it('masking defensivo: telefone em string dentro de decision é substituído por <masked>', async () => {
    const { applyDecisionMasking } = await import('../service.js');

    const withPhone = {
      intent: 'quer_simular',
      phone_hint: '(69) 99123-4567',
    };
    const masked = applyDecisionMasking(withPhone);

    expect(JSON.stringify(masked)).not.toContain('99123-4567');
    expect(JSON.stringify(masked)).toContain('<masked>');
  });

  it('masking defensivo: objeto aninhado com PII é mascarado recursivamente', async () => {
    const { applyDecisionMasking } = await import('../service.js');

    const nested = {
      outer: {
        inner: {
          cpf: '987.654.321-00',
          safe_field: 'valor_seguro',
        },
      },
    };
    const masked = applyDecisionMasking(nested);

    expect(JSON.stringify(masked)).not.toContain('987.654.321-00');
    expect(JSON.stringify(masked)).toContain('<masked>');
    expect(JSON.stringify(masked)).toContain('valor_seguro');
  });

  it('masking defensivo: array com strings PII é mascarado', async () => {
    const { applyDecisionMasking } = await import('../service.js');

    const withArray = {
      candidates: ['opção segura', 'CPF: 111.222.333-44'],
    };
    const masked = applyDecisionMasking(withArray);

    expect(JSON.stringify(masked)).not.toContain('111.222.333-44');
    expect(JSON.stringify(masked)).toContain('<masked>');
    expect(JSON.stringify(masked)).toContain('opção segura');
  });

  it('masking defensivo: dados sem PII passam intactos (UUID, números, booleanos)', async () => {
    const { applyDecisionMasking } = await import('../service.js');

    const clean = {
      intent: 'quer_simular',
      next_node: 'generate_simulation',
      confidence: 0.95,
      simulation_id: FIXTURE_DECISION_ID,
      active: true,
      amount: 5000,
    };
    const masked = applyDecisionMasking(clean);

    expect(masked).toEqual(clean);
  });
});
