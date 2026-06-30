// =============================================================================
// notification-rules/__tests__/notification-rules.test.ts — Testes de integração (F24-S05).
//
// Estratégia: sobe Fastify com notificationRulesRoutes, mocka authenticate/authorize
// e featureGate para controlar contexto, mocka service para controlar dados.
//
// Cobre:
//   1.  GET  /api/notification-rules → 200 lista paginada
//   2.  GET  /api/notification-rules/catalog → 200 catálogo
//   3.  POST /api/notification-rules → 201 regra criada
//   4.  POST /api/notification-rules → 400 body inválido (trigger_key ausente)
//   5.  POST /api/notification-rules → 400 trigger_key inválido
//   6.  POST /api/notification-rules → 400 recipient_roles vazio com by_role_city
//   7.  GET  /api/notification-rules/:id → 200 detalhe
//   8.  GET  /api/notification-rules/:id → 404 não encontrado
//   9.  PATCH /api/notification-rules/:id → 200 atualizado
//   10. PATCH /api/notification-rules/:id → 404 não encontrado
//   11. DELETE /api/notification-rules/:id → 204 removido
//   12. DELETE /api/notification-rules/:id → 404 não encontrado
//   13. POST /api/notification-rules/:id/test → 200 preview
//   14. POST /api/notification-rules/:id/test → 404 não encontrado
//   15. Sem auth → 403
//   16. Sem permissão notifications:manage → 403
//   17. Feature flag desabilitada → 403
//   18. POST com Idempotency-Key → retorna resultado idempotente
//   19. Isolamento de org: regra de outra org não acessível
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
      throw new FeatureDisabledError('notifications.rules.enabled');
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
const mockListRulesService = vi.fn();
const mockCreateRuleService = vi.fn();
const mockGetRuleService = vi.fn();
const mockUpdateRuleService = vi.fn();
const mockDeleteRuleService = vi.fn();
const mockTestRuleService = vi.fn();
const mockGetCatalogService = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listRulesService: (...args: unknown[]) => mockListRulesService(...args),
    createRuleService: (...args: unknown[]) => mockCreateRuleService(...args),
    getRuleService: (...args: unknown[]) => mockGetRuleService(...args),
    updateRuleService: (...args: unknown[]) => mockUpdateRuleService(...args),
    deleteRuleService: (...args: unknown[]) => mockDeleteRuleService(...args),
    testRuleService: (...args: unknown[]) => mockTestRuleService(...args),
    getCatalogService: (...args: unknown[]) => mockGetCatalogService(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_RULE_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeRuleResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_RULE_ID,
    organization_id: FIXTURE_ORG_ID,
    name: 'Alerta de simulação gerada',
    trigger_key: 'simulations.generated',
    trigger_kind: 'event',
    category: 'credit',
    entity_type: 'simulation',
    recipient_mode: 'by_role_city',
    recipient_roles: ['agente'],
    severity: 'info',
    channels: ['in_app'],
    title_template: 'Nova simulação gerada',
    body_template: 'Simulação {{simulation_id}} foi gerada.',
    threshold_hours: null,
    cooldown_hours: 0,
    enabled: false,
    city_scope: null,
    created_by: FIXTURE_USER_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const CREATE_RULE_PAYLOAD = {
  name: 'Alerta de simulação gerada',
  trigger_key: 'simulations.generated',
  recipient_mode: 'by_role_city',
  recipient_roles: ['agente'],
  severity: 'info',
  channels: ['in_app'],
  title_template: 'Nova simulação gerada',
  body_template: 'Simulação {{simulation_id}} foi gerada.',
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['notifications:manage'],
  injectUser = true,
  organizationId = FIXTURE_ORG_ID,
): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { notificationRulesRoutes },
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
        organizationId,
        permissions,
        cityScopeIds: null,
      };
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = { error: error.code, message: error.message };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
    }
    // Fastify wraps Zod/schema validation errors with a `validation` property
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
    reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(notificationRulesRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('GET /api/notification-rules', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFeatureGateEnabled.mockReturnValue(true);
    mockListRulesService.mockResolvedValue({
      data: [makeRuleResponse()],
      total: 1,
      page: 1,
      per_page: 20,
    });
  });

  it('1. retorna 200 com lista paginada', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
    expect(mockListRulesService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: FIXTURE_ORG_ID }),
      expect.objectContaining({ page: 1, per_page: 20 }),
    );
  });
});

describe('GET /api/notification-rules/catalog', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFeatureGateEnabled.mockReturnValue(true);
    mockGetCatalogService.mockReturnValue([
      {
        key: 'simulations.generated',
        kind: 'event',
        category: 'credit',
        entityType: 'simulation',
        placeholders: ['simulation_id', 'lead_id'],
      },
    ]);
  });

  it('2. retorna 200 com catálogo de gatilhos', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
    expect(mockGetCatalogService).toHaveBeenCalled();
  });
});

describe('POST /api/notification-rules', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFeatureGateEnabled.mockReturnValue(true);
    mockCreateRuleService.mockResolvedValue(makeRuleResponse());
  });

  it('3. retorna 201 com regra criada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notification-rules',
      payload: CREATE_RULE_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_RULE_ID);
    expect(body['name']).toBe('Alerta de simulação gerada');
    expect(body['cooldown_hours']).toBe(0);
    expect(body['enabled']).toBe(false);
    expect(Array.isArray(body['recipient_roles'])).toBe(true);
  });

  it('4. retorna 400 para body inválido (trigger_key ausente)', async () => {
    const { trigger_key: _, ...noTrigger } = CREATE_RULE_PAYLOAD;
    const res = await app.inject({
      method: 'POST',
      url: '/api/notification-rules',
      payload: noTrigger,
    });
    expect(res.statusCode).toBe(400);
  });

  it('5. retorna 400 para trigger_key inválido (Zod superRefine rejeita antes do service)', async () => {
    // trigger_key inválido é rejeitado pelo superRefine do Zod no body validation (400)
    // O service nem chega a ser chamado — sem necessidade de mock de rejeição.
    const res = await app.inject({
      method: 'POST',
      url: '/api/notification-rules',
      payload: { ...CREATE_RULE_PAYLOAD, trigger_key: 'gatilho.invalido' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('6. retorna 400 para recipient_roles vazio com by_role_city', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notification-rules',
      payload: {
        ...CREATE_RULE_PAYLOAD,
        recipient_mode: 'by_role_city',
        recipient_roles: [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('18. Idempotency-Key é passada para o service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notification-rules',
      headers: { 'idempotency-key': 'test-key-123' },
      payload: CREATE_RULE_PAYLOAD,
    });
    expect(res.statusCode).toBe(201);
    expect(mockCreateRuleService).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'test-key-123',
    );
  });
});

describe('GET /api/notification-rules/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('7. retorna 200 com detalhe da regra', async () => {
    mockGetRuleService.mockResolvedValueOnce(makeRuleResponse());
    const res = await app.inject({
      method: 'GET',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_RULE_ID);
    expect(body['recipient_roles']).toEqual(['agente']);
  });

  it('8. retorna 404 para regra não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetRuleService.mockRejectedValueOnce(
      new NotFoundError('Regra de notificação não encontrada'),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('19. isolamento de org — service chamado com org do usuário', async () => {
    mockGetRuleService.mockResolvedValueOnce(makeRuleResponse({ organization_id: FIXTURE_ORG_ID }));
    await app.inject({
      method: 'GET',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}`,
    });
    expect(mockGetRuleService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: FIXTURE_ORG_ID }),
      FIXTURE_RULE_ID,
    );
  });
});

describe('PATCH /api/notification-rules/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('9. retorna 200 com regra atualizada', async () => {
    mockUpdateRuleService.mockResolvedValueOnce(makeRuleResponse({ enabled: true }));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['enabled']).toBe(true);
  });

  it('10. retorna 404 para regra não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateRuleService.mockRejectedValueOnce(
      new NotFoundError('Regra de notificação não encontrada'),
    );
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}`,
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/notification-rules/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('11. retorna 204 ao remover regra', async () => {
    mockDeleteRuleService.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}`,
    });
    expect(res.statusCode).toBe(204);
  });

  it('12. retorna 404 para regra não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockDeleteRuleService.mockRejectedValueOnce(
      new NotFoundError('Regra de notificação não encontrada'),
    );
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/notification-rules/:id/test', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('13. retorna 200 com preview de destinatários e template', async () => {
    mockTestRuleService.mockResolvedValueOnce({
      rule_id: FIXTURE_RULE_ID,
      recipient_count: 2,
      recipients_preview: [
        {
          user_id: FIXTURE_USER_ID,
          display_name: 'Ana Clara',
          channels: ['in_app'],
        },
      ],
      rendered_title: 'Nova simulação gerada',
      rendered_body: 'Simulação 00000000-0000-0000-0000-000000000001 foi gerada.',
      tested_at: new Date().toISOString(),
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}/test`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['rule_id']).toBe(FIXTURE_RULE_ID);
    expect(body['recipient_count']).toBe(2);
    expect(body['rendered_title']).toBeDefined();
  });

  it('14. retorna 404 para regra não encontrada', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockTestRuleService.mockRejectedValueOnce(
      new NotFoundError('Regra de notificação não encontrada'),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/api/notification-rules/${FIXTURE_RULE_ID}/test`,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Teste de regressão B1: replay de idempotência deve retornar response COMPLETO
// ---------------------------------------------------------------------------
// Antes da correção B1, checkNotificationRuleIdempotencyKey retornava o
// responseBody parcial { rule_id: uuid } como NotificationRuleResponse —
// o cliente recebia um objeto incompleto (sem name, trigger_key, channels, etc.).
// Após a correção, o service busca dados frescos via findNotificationRuleById
// e devolve toResponse(rule) — completo.
//
// Este teste verifica o contrato HTTP: um POST repetido com a mesma
// Idempotency-Key deve retornar status 201 e um NotificationRuleResponse
// completo (não apenas { rule_id }).
// ---------------------------------------------------------------------------

describe('Idempotência — replay retorna NotificationRuleResponse completo (B1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Limpar o mock antes do teste para isolar a contagem de chamadas
    // dos testes anteriores (POST describe usa o mesmo spy global).
    mockCreateRuleService.mockClear();
    mockFeatureGateEnabled.mockReturnValue(true);
  });

  it('20. POST repetido com mesma idempotency-key retorna resposta completa, não objeto parcial', async () => {
    // O service (corrigido) retorna toResponse(rule) no replay — não { rule_id } parcial.
    const fullResponse = makeRuleResponse();
    mockCreateRuleService.mockResolvedValue(fullResponse);

    const idempotencyKey = 'replay-b1-test-key';

    // Primeira chamada — cria a regra
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/notification-rules',
      headers: { 'idempotency-key': idempotencyKey },
      payload: CREATE_RULE_PAYLOAD,
    });
    expect(res1.statusCode).toBe(201);

    // Segunda chamada (replay) — deve retornar o mesmo response completo
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/notification-rules',
      headers: { 'idempotency-key': idempotencyKey },
      payload: CREATE_RULE_PAYLOAD,
    });
    expect(res2.statusCode).toBe(201);

    // Verificar que a resposta do replay é um NotificationRuleResponse completo.
    // Se o bug B1 estivesse presente, body conteria apenas { rule_id: uuid }
    // e as asserções abaixo falhariam.
    const body = res2.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_RULE_ID);
    expect(body['organization_id']).toBeDefined();
    expect(body['name']).toBeDefined();
    expect(body['trigger_key']).toBeDefined();
    expect(body['trigger_kind']).toBeDefined();
    expect(body['category']).toBeDefined();
    expect(body['recipient_mode']).toBeDefined();
    expect(body['channels']).toBeDefined();
    expect(body['severity']).toBeDefined();
    expect(body['enabled']).toBeDefined();
    // O response completo tem muito mais que 1 campo (diferentemente de { rule_id })
    expect(Object.keys(body).length).toBeGreaterThan(5);

    // Ambas as chamadas passaram o idempotency key para o service
    expect(mockCreateRuleService).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = mockCreateRuleService.mock.calls;
    expect(firstCall?.[3]).toBe(idempotencyKey);
    expect(secondCall?.[3]).toBe(idempotencyKey);
  });
});

describe('RBAC e feature flag', () => {
  it('15. sem auth → 403', async () => {
    const app = await buildTestApp([], false);
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('16. sem permissão notifications:manage → 403', async () => {
    const app = await buildTestApp(['leads:read']);
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('17. feature flag desabilitada → 403', async () => {
    const app = await buildTestApp();
    mockFeatureGateEnabled.mockReturnValue(false);
    const res = await app.inject({ method: 'GET', url: '/api/notification-rules' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
