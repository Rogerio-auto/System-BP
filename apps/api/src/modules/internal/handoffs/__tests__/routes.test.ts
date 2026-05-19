// =============================================================================
// internal/handoffs/__tests__/routes.test.ts — Testes de integração F3-S07.
//
// Estratégia: sobe Fastify com internalHandoffsRoutes (default export via autoload),
// mocka db e requestHandoff para controlar respostas sem conectar em banco real.
//
// Caminhos de referência (relativos a __tests__/):
//   ../routes.js                    = src/modules/internal/handoffs/routes.ts
//   ../service.js                   = src/modules/internal/handoffs/service.ts
//   ../../../../config/env.js       = src/config/env.ts
//   ../../../../db/client.js        = src/db/client.ts
//   ../../../../shared/errors.js    = src/shared/errors.ts
//
// Cobre:
//   1.  POST /internal/handoffs → 200 caminho feliz (handoff criado)
//   2.  POST /internal/handoffs → 200 idempotência (reenvio retorna mesmo handoff)
//   3.  POST /internal/handoffs → 401 sem X-Internal-Token
//   4.  POST /internal/handoffs → 401 com token errado
//   5.  POST /internal/handoffs → 400 sem Idempotency-Key
//   6.  POST /internal/handoffs → 400 body inválido (sem leadId)
//   7.  POST /internal/handoffs → 400 body inválido (leadId não UUID)
//   8.  POST /internal/handoffs → 400 body inválido (sem organizationId)
//   9.  POST /internal/handoffs → 400 body inválido (reason inválido)
//   10. POST /internal/handoffs → 400 body inválido (sem conversationId)
//   11. POST /internal/handoffs → 400 body inválido (sem summary)
//   12. POST /internal/handoffs → requestHandoff chamado com parâmetros corretos
//   13. POST /internal/handoffs → resposta contém handoff_id, status, chatwoot_conversation_id
//   14. POST /internal/handoffs → simulationId opcional aceito
//   15. POST /internal/handoffs → ai_unavailable aceito como reason (F3-S34)
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
// Mock db/client — não é usado diretamente pela rota (passa para o service).
// Caminho relativo a __tests__/: ../../../../db/client.js = src/db/client.ts.
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock requestHandoff service.
// A rota chama requestHandoff() do service — mockamos aqui para isolar.
// Caminho relativo a __tests__/: ../service.js = src/modules/internal/handoffs/service.ts.
// ---------------------------------------------------------------------------
const mockRequestHandoff = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestHandoff: (...args: unknown[]) => mockRequestHandoff(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_SIM_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_HANDOFF_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_IDEMPOTENCY_KEY = 'idem-key-test-f3-s07-0001';

const VALID_BODY = {
  leadId: FIXTURE_LEAD_ID,
  conversationId: 42,
  reason: 'cliente_solicitou_atendente',
  summary: 'Cliente solicitou atendente humano.',
  organizationId: FIXTURE_ORG_ID,
};

function makeHandoffResult(overrides: Record<string, unknown> = {}) {
  return {
    handoff_id: FIXTURE_HANDOFF_ID,
    chatwoot_conversation_id: '42',
    assigned_agent_id: null,
    status: 'requested' as const,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
//
// Registra internalHandoffsRoutes com prefix /internal/handoffs para simular
// o comportamento do autoload + prefix '/internal' do app.ts.
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalHandoffsRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    // Default export — padrão exigido pelo @fastify/autoload (F3-S07).
    import('../routes.js'),
    // Caminho relativo a __tests__/: ../../../../shared/errors.js = src/shared/errors.ts
    import('../../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

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
      return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
    },
  );

  // Registra o plugin com prefixo /internal/handoffs (simula o autoload + app.ts prefix).
  await app.register(internalHandoffsRoutes, { prefix: '/internal/handoffs' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('POST /internal/handoffs', () => {
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
  // 1. 200 — handoff criado com sucesso
  // -------------------------------------------------------------------------
  it('retorna 200 com handoff criado', async () => {
    const serviceResult = makeHandoffResult();
    mockRequestHandoff.mockResolvedValueOnce(serviceResult);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: {
        'x-internal-token': VALID_TOKEN,
        'idempotency-key': FIXTURE_IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.handoff_id).toBe(FIXTURE_HANDOFF_ID);
    expect(body.chatwoot_conversation_id).toBe('42');
    expect(body.assigned_agent_id).toBeNull();
    expect(body.status).toBe('requested');
  });

  // -------------------------------------------------------------------------
  // 2. 200 — idempotência: reenvio retorna mesmo handoff
  // -------------------------------------------------------------------------
  it('retorna 200 idempotente (reenvio retorna mesmo handoff)', async () => {
    const serviceResult = makeHandoffResult();
    // Simula que o service retorna o mesmo resultado no reenvio
    mockRequestHandoff.mockResolvedValueOnce(serviceResult);
    mockRequestHandoff.mockResolvedValueOnce(serviceResult);

    const makeRequest = () =>
      app.inject({
        method: 'POST',
        url: '/internal/handoffs',
        headers: {
          'x-internal-token': VALID_TOKEN,
          'idempotency-key': FIXTURE_IDEMPOTENCY_KEY,
        },
        payload: VALID_BODY,
      });

    const first = await makeRequest();
    const second = await makeRequest();

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().handoff_id).toBe(second.json().handoff_id);
  });

  // -------------------------------------------------------------------------
  // 3. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 401 — token errado
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': 'wrong-token', 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 400 — sem Idempotency-Key
  // -------------------------------------------------------------------------
  it('retorna 400 sem Idempotency-Key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(400);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. 400 — sem leadId
  // -------------------------------------------------------------------------
  it('retorna 400 quando leadId está ausente', async () => {
    const { leadId: _leadId, ...bodyWithoutLeadId } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': VALID_TOKEN, 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: bodyWithoutLeadId,
    });

    expect(response.statusCode).toBe(400);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 400 — leadId não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando leadId não é UUID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': VALID_TOKEN, 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: { ...VALID_BODY, leadId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 400 — sem organizationId
  // -------------------------------------------------------------------------
  it('retorna 400 quando organizationId está ausente', async () => {
    const { organizationId: _orgId, ...bodyWithoutOrg } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': VALID_TOKEN, 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: bodyWithoutOrg,
    });

    expect(response.statusCode).toBe(400);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. 400 — reason inválido
  // -------------------------------------------------------------------------
  it('retorna 400 quando reason é inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': VALID_TOKEN, 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: { ...VALID_BODY, reason: 'motivo_invalido' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. 400 — sem conversationId
  // -------------------------------------------------------------------------
  it('retorna 400 quando conversationId está ausente', async () => {
    const { conversationId: _convId, ...bodyWithoutConv } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': VALID_TOKEN, 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: bodyWithoutConv,
    });

    expect(response.statusCode).toBe(400);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 11. 400 — sem summary
  // -------------------------------------------------------------------------
  it('retorna 400 quando summary está ausente', async () => {
    const { summary: _summary, ...bodyWithoutSummary } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: { 'x-internal-token': VALID_TOKEN, 'idempotency-key': FIXTURE_IDEMPOTENCY_KEY },
      payload: bodyWithoutSummary,
    });

    expect(response.statusCode).toBe(400);
    expect(mockRequestHandoff).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 12. requestHandoff chamado com parâmetros corretos
  // -------------------------------------------------------------------------
  it('chama requestHandoff com db, body e idempotencyKey corretos', async () => {
    mockRequestHandoff.mockResolvedValueOnce(makeHandoffResult());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: {
        'x-internal-token': VALID_TOKEN,
        'idempotency-key': FIXTURE_IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    expect(mockRequestHandoff).toHaveBeenCalledTimes(1);
    expect(mockRequestHandoff).toHaveBeenCalledWith(
      expect.anything(), // db (mockado)
      expect.objectContaining({
        leadId: FIXTURE_LEAD_ID,
        conversationId: 42,
        reason: 'cliente_solicitou_atendente',
        organizationId: FIXTURE_ORG_ID,
      }),
      FIXTURE_IDEMPOTENCY_KEY,
      expect.anything(), // logger
    );
  });

  // -------------------------------------------------------------------------
  // 13. Resposta contém todos os campos esperados
  // -------------------------------------------------------------------------
  it('resposta contém handoff_id, chatwoot_conversation_id, assigned_agent_id, status', async () => {
    mockRequestHandoff.mockResolvedValueOnce(makeHandoffResult());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: {
        'x-internal-token': VALID_TOKEN,
        'idempotency-key': FIXTURE_IDEMPOTENCY_KEY,
      },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      handoff_id: FIXTURE_HANDOFF_ID,
      chatwoot_conversation_id: '42',
      assigned_agent_id: null,
      status: 'requested',
    });
  });

  // -------------------------------------------------------------------------
  // 14. simulationId opcional aceito
  // -------------------------------------------------------------------------
  it('aceita simulationId opcional', async () => {
    mockRequestHandoff.mockResolvedValueOnce(makeHandoffResult());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: {
        'x-internal-token': VALID_TOKEN,
        'idempotency-key': FIXTURE_IDEMPOTENCY_KEY,
      },
      payload: { ...VALID_BODY, simulationId: FIXTURE_SIM_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRequestHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ simulationId: FIXTURE_SIM_ID }),
      FIXTURE_IDEMPOTENCY_KEY,
      expect.anything(),
    );
  });

  // -------------------------------------------------------------------------
  // 15. ai_unavailable aceito como reason (F3-S34 fallback)
  // -------------------------------------------------------------------------
  it('aceita reason ai_unavailable (fallback F3-S34)', async () => {
    mockRequestHandoff.mockResolvedValueOnce(makeHandoffResult());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/handoffs',
      headers: {
        'x-internal-token': VALID_TOKEN,
        'idempotency-key': FIXTURE_IDEMPOTENCY_KEY,
      },
      payload: { ...VALID_BODY, reason: 'ai_unavailable' },
    });

    expect(response.statusCode).toBe(200);
    expect(mockRequestHandoff).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'ai_unavailable' }),
      FIXTURE_IDEMPOTENCY_KEY,
      expect.anything(),
    );
  });
});
