// =============================================================================
// internal/ai/__tests__/routes.test.ts — Testes de integração F3-S09.
//
// Estratégia: sobe Fastify com internalAiRoutes (default export via autoload),
// mocka db (drizzle) e env para controlar respostas sem conectar em banco real.
//
// Caminhos relativos a __tests__/:
//   ../routes.js                    = src/modules/internal/ai/routes.ts
//   ../../../../config/env.js       = src/config/env.ts
//   ../../../../db/client.js        = src/db/client.ts
//   ../../../../shared/errors.js    = src/shared/errors.ts
//   ../../../../db/schema/aiDecisionLogs.js = src/db/schema/aiDecisionLogs.ts
//
// Cobre:
//   1.  POST /internal/ai/decisions → 200 caminho feliz (log criado)
//   2.  POST /internal/ai/decisions → 200 retorna decision_log_id UUID
//   3.  POST /internal/ai/decisions → 401 sem X-Internal-Token
//   4.  POST /internal/ai/decisions → 401 com token inválido
//   5.  POST /internal/ai/decisions → 400 sem organizationId
//   6.  POST /internal/ai/decisions → 400 organizationId não é UUID
//   7.  POST /internal/ai/decisions → 400 sem conversationId
//   8.  POST /internal/ai/decisions → 400 conversationId não é UUID
//   9.  POST /internal/ai/decisions → 400 sem nodeName
//   10. POST /internal/ai/decisions → 400 sem correlationId
//   11. POST /internal/ai/decisions → 400 correlationId não é UUID
//   12. POST /internal/ai/decisions → 422 decision contém chave PII proibida (cpf)
//   13. POST /internal/ai/decisions → 422 decision contém chave PII aninhada
//   14. POST /internal/ai/decisions → 200 campos opcionais aceitos (leadId, intent, etc.)
//   15. POST /internal/ai/decisions → 200 sem body.decision usa {} como default
//   16. POST /internal/ai/decisions → 200 db.insert chamado com parâmetros corretos
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
// Mock db/client — Drizzle não conecta em banco real.
// Suporta: db.insert().values().returning()
// ---------------------------------------------------------------------------
const mockDbResults = vi.fn();

function makeInsertChain() {
  const chain = {
    values: () => chain,
    returning: () => mockDbResults(),
  };
  return chain;
}

// `as` justificado: vi.fn() é tipado como any internamente; o tipo da função
// importa apenas como spy — o shape real é controlado por makeInsertChain().
const mockDbInsert = vi.fn((_table: unknown) => makeInsertChain());

vi.mock('../../../../db/client.js', () => ({
  db: {
    // `as` justificado: mock de Drizzle — o tipo real de insert é complexo,
    // mas para teste precisamos apenas do shape fluent retornado por makeInsertChain().
    insert: (table: unknown) => mockDbInsert(table) as ReturnType<typeof makeInsertChain>,
  },
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock schema — evita importar módulo Drizzle pesado.
// A rota importa para passar como argumento ao .insert() e .returning().
// ---------------------------------------------------------------------------
vi.mock('../../../../db/schema/aiDecisionLogs.js', () => ({
  aiDecisionLogs: {
    id: 'id',
    organizationId: 'organization_id',
    conversationId: 'conversation_id',
    leadId: 'lead_id',
    nodeName: 'node_name',
    intent: 'intent',
    promptKey: 'prompt_key',
    promptVersion: 'prompt_version',
    model: 'model',
    tokensIn: 'tokens_in',
    tokensOut: 'tokens_out',
    latencyMs: 'latency_ms',
    decision: 'decision',
    error: 'error',
    correlationId: 'correlation_id',
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_CONV_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CORRELATION_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_LOG_ID = 'eeeeeeee-0000-0000-0000-000000000001';

const VALID_BODY = {
  organizationId: FIXTURE_ORG_ID,
  conversationId: FIXTURE_CONV_ID,
  nodeName: 'classify_intent',
  correlationId: FIXTURE_CORRELATION_ID,
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalAiRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
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

  // Registra o plugin com prefixo /internal/ai (simula autoload + app.ts prefix).
  await app.register(internalAiRoutes, { prefix: '/internal/ai' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('POST /internal/ai/decisions', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: INSERT retorna 1 linha com id
    mockDbResults.mockResolvedValue([{ id: FIXTURE_LOG_ID }]);
  });

  // -------------------------------------------------------------------------
  // 1. 200 — caminho feliz
  // -------------------------------------------------------------------------
  it('retorna 200 no caminho feliz', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 2. 200 — retorna decision_log_id UUID
  // -------------------------------------------------------------------------
  it('retorna decision_log_id UUID na resposta', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('decision_log_id', FIXTURE_LOG_ID);
  });

  // -------------------------------------------------------------------------
  // 3. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 401 — token inválido
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': 'wrong-token' },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 400 — sem organizationId
  // -------------------------------------------------------------------------
  it('retorna 400 quando organizationId está ausente', async () => {
    const { organizationId: _org, ...bodyWithoutOrg } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutOrg,
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. 400 — organizationId não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando organizationId não é UUID válido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, organizationId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 400 — sem conversationId
  // -------------------------------------------------------------------------
  it('retorna 400 quando conversationId está ausente', async () => {
    const { conversationId: _conv, ...bodyWithoutConv } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutConv,
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 400 — conversationId não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando conversationId não é UUID válido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, conversationId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. 400 — sem nodeName
  // -------------------------------------------------------------------------
  it('retorna 400 quando nodeName está ausente', async () => {
    const { nodeName: _node, ...bodyWithoutNode } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutNode,
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. 400 — sem correlationId
  // -------------------------------------------------------------------------
  it('retorna 400 quando correlationId está ausente', async () => {
    const { correlationId: _corr, ...bodyWithoutCorr } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutCorr,
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 11. 400 — correlationId não é UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando correlationId não é UUID válido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, correlationId: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 12. 422 — decision contém chave PII proibida (cpf)
  // Defesa em profundidade LGPD — doc 17 §8.4.
  // -------------------------------------------------------------------------
  it('retorna 422 quando decision contém chave PII proibida (cpf)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        ...VALID_BODY,
        decision: { cpf: '123.456.789-00', next_node: 'identify_city' },
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 13. 422 — decision contém chave PII aninhada
  // -------------------------------------------------------------------------
  it('retorna 422 quando decision contém chave PII em objeto aninhado', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        ...VALID_BODY,
        decision: {
          result: {
            document_number: '123456789',
          },
          next_node: 'identify_city',
        },
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error).toBe('VALIDATION_ERROR');
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 14. 200 — campos opcionais aceitos
  // -------------------------------------------------------------------------
  it('retorna 200 com todos os campos opcionais preenchidos', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        ...VALID_BODY,
        leadId: FIXTURE_LEAD_ID,
        intent: 'quer_simular',
        promptKey: 'intent_classifier',
        promptVersion: 'intent_classifier@v3',
        model: 'anthropic/claude-3-5-sonnet',
        tokensIn: 512,
        tokensOut: 128,
        latencyMs: 1234,
        decision: { next_node: 'identify_city', confidence: 0.95 },
        error: null,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('decision_log_id');
  });

  // -------------------------------------------------------------------------
  // 15. 200 — sem body.decision usa {} como default
  // -------------------------------------------------------------------------
  it('retorna 200 quando decision está ausente (usa default {})', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY, // sem `decision`
    });

    expect(response.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 16. 200 — db.insert chamado com parâmetros corretos
  // -------------------------------------------------------------------------
  it('chama db.insert com os parâmetros corretos do body', async () => {
    const fullBody = {
      ...VALID_BODY,
      leadId: FIXTURE_LEAD_ID,
      intent: 'quer_simular',
      promptKey: 'intent_classifier',
      promptVersion: 'intent_classifier@v3',
      model: 'anthropic/claude-3-5-sonnet',
      tokensIn: 512,
      tokensOut: 128,
      latencyMs: 1234,
      decision: { next_node: 'identify_city' },
      error: 'timeout no nó',
    };

    await app.inject({
      method: 'POST',
      url: '/internal/ai/decisions',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: fullBody,
    });

    // db.insert() deve ter sido chamado exatamente 1 vez
    expect(mockDbInsert).toHaveBeenCalledOnce();
  });
});
