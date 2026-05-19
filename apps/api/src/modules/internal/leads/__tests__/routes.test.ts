// =============================================================================
// internal/leads/__tests__/routes.test.ts — Testes de integração F3-S04.
//
// Estratégia: sobe Fastify com internalLeadsRoutes (default export via autoload),
// mocka db e getOrCreateLead para controlar respostas sem conectar em banco real.
//
// Caminhos de referência (relativos a __tests__/):
//   ../routes.js              = src/modules/internal/leads/routes.ts
//   ../../../leads/service.js = src/modules/leads/service.ts
//   ../../../../config/env.js = src/config/env.ts
//   ../../../../db/client.js  = src/db/client.ts
//   ../../../../shared/errors.js = src/shared/errors.ts
//
// Cobre:
//   1.  POST /internal/leads/get-or-create → 200 caminho feliz (lead existente)
//   2.  POST /internal/leads/get-or-create → 200 caminho feliz (lead criado)
//   3.  POST /internal/leads/get-or-create → 401 sem X-Internal-Token
//   4.  POST /internal/leads/get-or-create → 401 com token errado
//   5.  POST /internal/leads/get-or-create → 400 body inválido (sem phone)
//   6.  POST /internal/leads/get-or-create → 400 body inválido (phone não E.164)
//   7.  POST /internal/leads/get-or-create → 400 body inválido (sem organization_id)
//   8.  POST /internal/leads/get-or-create → 400 body inválido (organization_id não-UUID)
//   9.  POST /internal/leads/get-or-create → 400 body inválido (source inválido)
//   10. POST /internal/leads/get-or-create → 422 INVALID_PHONE (serviço)
//   11. POST /internal/leads/get-or-create → 409 LEAD_MERGE_REQUIRED (serviço)
//   12. POST /internal/leads/get-or-create → 429 rate limit (>60 req/min)
//   13. POST /internal/leads/get-or-create → getOrCreateLead chamado 1 vez (sem double-call)
//   14. POST /internal/leads/get-or-create → campos opcionais aceitos (name, city_id, etc.)
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
// Mock db/client — não é usado diretamente pela rota (passa para o service),
// mas precisa existir para o módulo importar sem erro.
// Caminho relativo a __tests__/: ../../../../db/client.js = src/db/client.ts.
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock getOrCreateLead service.
// Caminho relativo a __tests__/: ../../../leads/service.js = src/modules/leads/service.ts.
// ---------------------------------------------------------------------------
const mockGetOrCreateLead = vi.fn();

vi.mock('../../../leads/service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getOrCreateLead: (...args: unknown[]) => mockGetOrCreateLead(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'cccccccc-0000-0000-0000-000000000001';

const VALID_BODY = {
  organization_id: FIXTURE_ORG_ID,
  phone: '+5569999999999',
  source: 'whatsapp',
};

function makeLeadResult(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: FIXTURE_LEAD_ID,
    customer_id: null,
    created: false,
    current_stage: 'Pré-atendimento',
    city_id: FIXTURE_CITY_ID,
    assigned_agent_id: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
//
// Registra internalLeadsRoutes com prefix /internal/leads para simular o
// comportamento do autoload + prefix '/internal' do app.ts.
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalLeadsRoutes },
    { isAppError },
    rateLimitModule,
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    // Default export — padrão exigido pelo @fastify/autoload (F3-S04).
    import('../routes.js'),
    // Caminho relativo a __tests__/: ../../../../shared/errors.js = src/shared/errors.ts
    import('../../../../shared/errors.js'),
    import('@fastify/rate-limit'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Rate limit plugin necessário para o config.rateLimit da rota funcionar.
  // `as` justificado: ESM default export de CJS pode vir como .default ou como módulo
  // dependendo do runtime — cast para função de registro Fastify é seguro aqui.
  await app.register(rateLimitModule.default as Parameters<typeof app.register>[0], {
    max: 100,
    timeWindow: '1 minute',
  });

  app.setErrorHandler(
    // `as` justificado: tipos de error/request/reply são any em setErrorHandler no Fastify 5
    // quando não há TypeProvider — padrão adotado em todos os testes de integração do projeto.
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

  // Registra o plugin com prefixo /internal/leads (simula o autoload + app.ts prefix).
  await app.register(internalLeadsRoutes, { prefix: '/internal/leads' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('POST /internal/leads/get-or-create', () => {
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
  // 1. 200 — lead existente (created: false)
  // -------------------------------------------------------------------------
  it('retorna 200 com lead existente (created: false)', async () => {
    const serviceResult = makeLeadResult({ created: false });
    mockGetOrCreateLead.mockResolvedValueOnce(serviceResult);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.created).toBe(false);
    expect(body.customer_id).toBeNull();
    expect(body.current_stage).toBe('Pré-atendimento');
    expect(body.city_id).toBe(FIXTURE_CITY_ID);
    expect(body.assigned_agent_id).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 2. 200 — lead criado (created: true)
  // -------------------------------------------------------------------------
  it('retorna 200 com lead criado (created: true)', async () => {
    const serviceResult = makeLeadResult({ created: true, current_stage: 'Pré-atendimento' });
    mockGetOrCreateLead.mockResolvedValueOnce(serviceResult);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, name: 'Maria Silva', city_id: FIXTURE_CITY_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.created).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 401 — token errado
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': 'wrong-token' },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 400 — sem phone
  // -------------------------------------------------------------------------
  it('retorna 400 quando phone está ausente', async () => {
    const { phone: _phone, ...bodyWithoutPhone } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutPhone,
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. 400 — phone fora do formato E.164
  // -------------------------------------------------------------------------
  it('retorna 400 quando phone não é E.164', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, phone: '69999999999' }, // sem o +55
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 400 — sem organization_id
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id está ausente', async () => {
    const { organization_id: _org, ...bodyWithoutOrg } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutOrg,
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 400 — organization_id não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id não é UUID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, organization_id: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. 400 — source inválido ('manual' não é aceito neste endpoint)
  // -------------------------------------------------------------------------
  it('retorna 400 quando source é inválido para o canal interno', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, source: 'manual' }, // 'manual' não é aceito aqui
    });

    expect(response.statusCode).toBe(400);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. 422 — INVALID_PHONE (service layer)
  // -------------------------------------------------------------------------
  it('retorna 422 INVALID_PHONE quando serviço lança InvalidPhoneError', async () => {
    // Caminho relativo a __tests__/: ../../../leads/service.js = src/modules/leads/service.ts
    const { InvalidPhoneError } = await import('../../../leads/service.js');
    mockGetOrCreateLead.mockRejectedValueOnce(new InvalidPhoneError('formato inválido'));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // 11. 409 — LEAD_MERGE_REQUIRED (service layer)
  // -------------------------------------------------------------------------
  it('retorna 409 LEAD_MERGE_REQUIRED quando serviço lança LeadMergeRequiredError', async () => {
    const { LeadMergeRequiredError } = await import('../../../leads/service.js');
    mockGetOrCreateLead.mockRejectedValueOnce(new LeadMergeRequiredError());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error).toBe('CONFLICT');
  });

  // -------------------------------------------------------------------------
  // 12. 429 — rate limit testado com app isolado
  //
  // O endpoint registra config.rateLimit: { max: 60, timeWindow: '1 minute' }.
  // Para testar sem enviar 60 requisições (lento), usamos um app isolado com
  // global max=200 e verificamos que o per-route config é respeitado:
  // enviamos 61 requisições → a 61ª retorna 429.
  //
  // App isolado evita contaminar o contador do app compartilhado pelos outros testes.
  // -------------------------------------------------------------------------
  it('retorna 429 quando rate limit de 60 req/min é excedido', async () => {
    // App isolado para este teste: não contamina o contador do app principal.
    const [
      { default: Fastify },
      { serializerCompiler, validatorCompiler },
      { default: internalLeadsRoutes },
      { isAppError },
      rateLimitModule,
    ] = await Promise.all([
      import('fastify'),
      import('fastify-type-provider-zod'),
      import('../routes.js'),
      import('../../../../shared/errors.js'),
      import('@fastify/rate-limit'),
    ]);

    const isolatedApp = Fastify({ logger: false }).withTypeProvider();
    isolatedApp.setValidatorCompiler(validatorCompiler);
    isolatedApp.setSerializerCompiler(serializerCompiler);

    // Global max=200 — acima do per-route max=60.
    // Per-route config.rateLimit { max: 60 } será o limite efetivo para esta rota.
    await isolatedApp.register(
      rateLimitModule.default as Parameters<typeof isolatedApp.register>[0],
      { max: 200, timeWindow: '1 minute' },
    );

    isolatedApp.setErrorHandler(
      (
        error: Error & { validation?: unknown; statusCode?: number },
        _request: unknown,
        reply: { status: (n: number) => { send: (b: unknown) => void } },
      ) => {
        if (isAppError(error)) {
          return reply.status(error.statusCode).send({
            error: error.code,
            message: error.message,
          });
        }
        if (error.statusCode === 429) {
          return reply.status(429).send({ error: 'RATE_LIMITED', message: error.message });
        }
        return reply.status(500).send({ error: 'INTERNAL_ERROR', message: error.message });
      },
    );

    await isolatedApp.register(internalLeadsRoutes, { prefix: '/internal/leads' });
    await isolatedApp.ready();

    mockGetOrCreateLead.mockResolvedValue(makeLeadResult());

    // Envia 60 requisições — todas dentro do per-route limit (max=60)
    for (let i = 0; i < 60; i++) {
      const res = await isolatedApp.inject({
        method: 'POST',
        url: '/internal/leads/get-or-create',
        headers: { 'x-internal-token': VALID_TOKEN },
        payload: VALID_BODY,
      });
      expect(res.statusCode).toBe(200);
    }

    // 61ª requisição — deve ser bloqueada pelo per-route limit (max=60)
    const blocked = await isolatedApp.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });
    expect(blocked.statusCode).toBe(429);

    await isolatedApp.close();
  });

  // -------------------------------------------------------------------------
  // 13. getOrCreateLead chamado exatamente uma vez (sem double-call)
  //
  // Garante que a rota não processa duplicadamente quando o service retorna.
  // Verificação indireta de que outbox NÃO é emitido quando created=false
  // (a responsabilidade de emitir leads.created é do service, e o mock
  // retorna created:false — portanto outbox não seria emitido pelo service).
  // -------------------------------------------------------------------------
  it('chama getOrCreateLead exatamente uma vez com os parâmetros corretos', async () => {
    mockGetOrCreateLead.mockResolvedValueOnce(makeLeadResult({ created: false }));

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetOrCreateLead).toHaveBeenCalledTimes(1);
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      expect.anything(), // db (mockado)
      FIXTURE_ORG_ID,
      expect.objectContaining({
        phone: '+5569999999999',
        source: 'whatsapp',
      }),
      expect.any(String), // requestIp
    );
  });

  // -------------------------------------------------------------------------
  // 14. Campos opcionais aceitos (name, city_id, chatwoot_conversation_id, correlation_id)
  // -------------------------------------------------------------------------
  it('aceita e repassa todos os campos opcionais ao service', async () => {
    mockGetOrCreateLead.mockResolvedValueOnce(
      makeLeadResult({ created: true, city_id: FIXTURE_CITY_ID }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/internal/leads/get-or-create',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        ...VALID_BODY,
        name: 'João da Silva',
        city_id: FIXTURE_CITY_ID,
        chatwoot_conversation_id: '12345',
        correlation_id: '11111111-2222-3333-4444-555555555555',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      expect.anything(), // db
      FIXTURE_ORG_ID,
      expect.objectContaining({
        name: 'João da Silva',
        cityId: FIXTURE_CITY_ID,
        chatwootConversationId: '12345',
        correlationId: '11111111-2222-3333-4444-555555555555',
      }),
      expect.any(String), // requestIp
    );
  });
});
