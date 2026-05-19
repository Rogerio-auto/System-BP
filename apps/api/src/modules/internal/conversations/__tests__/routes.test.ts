// =============================================================================
// internal/conversations/__tests__/routes.test.ts — Testes de integração F3-S02.
//
// Estratégia: sobe Fastify com internalConversationsRoutes (default export),
// mocka db (drizzle) e env para controlar respostas sem conectar em banco real.
//
// Caminhos relativos a __tests__/:
//   ../routes.js               = src/modules/internal/conversations/routes.ts
//   ../../../../config/env.js  = src/config/env.ts
//   ../../../../db/client.js   = src/db/client.ts
//   ../../../../shared/errors.js = src/shared/errors.ts
//
// Cobre:
//   1.  GET /:id/state → 200 estado existente
//   2.  GET /:id/state → 404 quando conversation_id não existe
//   3.  GET /:id/state → 401 sem X-Internal-Token
//   4.  GET /:id/state → 401 com token inválido
//   5.  GET /:id/state → 400 id não é UUID válido
//   6.  PUT /:id/state → 200 criação (created: true)
//   7.  PUT /:id/state → 200 atualização (created: false)
//   8.  PUT /:id/state → 401 sem X-Internal-Token
//   9.  PUT /:id/state → 401 com token inválido
//   10. PUT /:id/state → 400 body sem organization_id
//   11. PUT /:id/state → 400 body sem phone
//   12. PUT /:id/state → 400 phone com formato inválido (não apenas dígitos)
//   13. PUT /:id/state → 400 id não é UUID válido
//   14. PUT /:id/state → campos opcionais aceitos (lead_id, customer_id, current_node, etc.)
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
// Mock env
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
// O mock expõe um objeto `db` com encadeamento fluent de métodos Drizzle.
// ---------------------------------------------------------------------------

// Mock factory que retorna uma chain fluent terminando em mockFn.
// Suporta: db.select().from().where().limit() e db.insert().values().onConflictDoUpdate().returning()
const mockDbResults = vi.fn();

function makeSelectChain() {
  const chain = {
    from: () => chain,
    where: () => chain,
    limit: () => mockDbResults(),
  };
  return chain;
}

function makeInsertChain() {
  const chain = {
    values: () => chain,
    onConflictDoUpdate: () => chain,
    returning: () => mockDbResults(),
  };
  return chain;
}

vi.mock('../../../../db/client.js', () => ({
  db: {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
  },
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock schema — evita importar módulo Drizzle pesado; a rota importa apenas
// para passar como argumento ao eq() e .from()/.into(). Mockamos como objeto vazio.
// ---------------------------------------------------------------------------
vi.mock('../../../../db/schema/aiConversationStates.js', () => ({
  aiConversationStates: {
    conversationId: 'conversation_id',
    id: 'id',
    organizationId: 'organization_id',
    chatwootConversationId: 'chatwoot_conversation_id',
    leadId: 'lead_id',
    customerId: 'customer_id',
    currentNode: 'current_node',
    graphVersion: 'graph_version',
    state: 'state',
    lastMessageAt: 'last_message_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    phone: 'phone',
  },
}));

// Mock drizzle-orm helpers usados na rota (eq não precisa funcionar — apenas existir).
vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, _val: unknown) => ({ type: 'eq', col: _col, val: _val }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_CONV_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_ORG_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_ROW_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'dddddddd-0000-0000-0000-000000000001';

const NOW = new Date('2026-05-18T12:00:00.000Z');
const CREATED_AT = new Date('2026-05-18T11:00:00.000Z'); // 1 hour before → update case

function makeDbRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_ROW_ID,
    organizationId: FIXTURE_ORG_ID,
    conversationId: FIXTURE_CONV_ID,
    chatwootConversationId: null,
    leadId: null,
    customerId: null,
    currentNode: null,
    graphVersion: null,
    state: {},
    lastMessageAt: null,
    createdAt: CREATED_AT,
    updatedAt: NOW,
    phone: '5569912345678',
    ...overrides,
  };
}

const VALID_PUT_BODY = {
  organization_id: FIXTURE_ORG_ID,
  phone: '5569912345678',
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalConversationsRoutes },
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

  // Registra o plugin com prefixo /internal/conversations (simula autoload + app.ts prefix).
  await app.register(internalConversationsRoutes, { prefix: '/internal/conversations' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('GET /internal/conversations/:id/state', () => {
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
  // 1. 200 — estado existente
  // -------------------------------------------------------------------------
  it('retorna 200 com estado existente', async () => {
    const dbRow = makeDbRow({
      currentNode: 'classify_intent',
      graphVersion: 'v1.0.0',
      state: { intent: 'quer_credito' },
    });
    mockDbResults.mockResolvedValueOnce([dbRow]);

    const response = await app.inject({
      method: 'GET',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.conversation_id).toBe(FIXTURE_CONV_ID);
    expect(body.organization_id).toBe(FIXTURE_ORG_ID);
    expect(body.current_node).toBe('classify_intent');
    expect(body.graph_version).toBe('v1.0.0');
    expect(body.state).toEqual({ intent: 'quer_credito' });
    expect(body.lead_id).toBeNull();
    expect(body.customer_id).toBeNull();
    expect(body.chatwoot_conversation_id).toBeNull();
    expect(body.last_message_at).toBeNull();
    // phone não deve estar na resposta
    expect(body).not.toHaveProperty('phone');
  });

  // -------------------------------------------------------------------------
  // 2. 404 — conversation_id não existe
  // -------------------------------------------------------------------------
  it('retorna 404 quando conversation_id não existe', async () => {
    mockDbResults.mockResolvedValueOnce([]); // array vazio = não encontrado

    const response = await app.inject({
      method: 'GET',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error).toBe('NOT_FOUND');
  });

  // -------------------------------------------------------------------------
  // 3. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
    });

    expect(response.statusCode).toBe(401);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 401 — token inválido
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': 'wrong-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 400 — id não é UUID válido
  // -------------------------------------------------------------------------
  it('retorna 400 quando id não é UUID válido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/conversations/not-a-uuid/state',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbResults).not.toHaveBeenCalled();
  });
});

describe('PUT /internal/conversations/:id/state', () => {
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
  // 6. 200 — criação (created: true)
  // Heurística: createdAt ≈ updatedAt (diferença < 1s) → was just inserted.
  // -------------------------------------------------------------------------
  it('retorna 200 com created:true quando é um novo registro', async () => {
    const freshTime = new Date();
    const dbRow = makeDbRow({
      createdAt: freshTime,
      updatedAt: freshTime,
    });
    mockDbResults.mockResolvedValueOnce([dbRow]);

    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PUT_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.created).toBe(true);
    expect(body.conversation_id).toBe(FIXTURE_CONV_ID);
    expect(body.organization_id).toBe(FIXTURE_ORG_ID);
    expect(body.state).toEqual({});
    // phone não deve estar na resposta
    expect(body).not.toHaveProperty('phone');
  });

  // -------------------------------------------------------------------------
  // 7. 200 — atualização (created: false)
  // Heurística: createdAt muito mais antigo que updatedAt → foi atualizado.
  // -------------------------------------------------------------------------
  it('retorna 200 com created:false quando é atualização', async () => {
    const dbRow = makeDbRow({
      createdAt: CREATED_AT, // 1 hora antes
      updatedAt: NOW,
    });
    mockDbResults.mockResolvedValueOnce([dbRow]);

    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PUT_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.created).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      payload: VALID_PUT_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. 401 — token inválido
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': 'wrong-token' },
      payload: VALID_PUT_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. 400 — body sem organization_id
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id está ausente', async () => {
    const { organization_id: _org, ...bodyWithoutOrg } = VALID_PUT_BODY;

    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutOrg,
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 11. 400 — body sem phone
  // -------------------------------------------------------------------------
  it('retorna 400 quando phone está ausente', async () => {
    const { phone: _phone, ...bodyWithoutPhone } = VALID_PUT_BODY;

    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutPhone,
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 12. 400 — phone com formato inválido (não apenas dígitos)
  // -------------------------------------------------------------------------
  it('retorna 400 quando phone contém caracteres não-dígitos', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_PUT_BODY, phone: '+5569912345678' }, // + não é dígito
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 13. 400 — id não é UUID válido
  // -------------------------------------------------------------------------
  it('retorna 400 quando id não é UUID válido', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/internal/conversations/not-a-uuid/state',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_PUT_BODY,
    });

    expect(response.statusCode).toBe(400);
    expect(mockDbResults).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 14. 200 — campos opcionais aceitos e persistidos
  // -------------------------------------------------------------------------
  it('aceita e retorna todos os campos opcionais', async () => {
    const freshTime = new Date();
    const dbRow = makeDbRow({
      leadId: FIXTURE_LEAD_ID,
      currentNode: 'identify_or_create_lead',
      graphVersion: 'v1.2.0',
      state: { intent: 'quer_credito', step: 2 },
      chatwootConversationId: '999',
      createdAt: freshTime,
      updatedAt: freshTime,
    });
    mockDbResults.mockResolvedValueOnce([dbRow]);

    const response = await app.inject({
      method: 'PUT',
      url: `/internal/conversations/${FIXTURE_CONV_ID}/state`,
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        ...VALID_PUT_BODY,
        lead_id: FIXTURE_LEAD_ID,
        current_node: 'identify_or_create_lead',
        graph_version: 'v1.2.0',
        state: { intent: 'quer_credito', step: 2 },
        chatwoot_conversation_id: '999',
        last_message_at: '2026-05-18T12:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.lead_id).toBe(FIXTURE_LEAD_ID);
    expect(body.current_node).toBe('identify_or_create_lead');
    expect(body.graph_version).toBe('v1.2.0');
    expect(body.state).toEqual({ intent: 'quer_credito', step: 2 });
    expect(body.chatwoot_conversation_id).toBe('999');
    expect(body.created).toBe(true);
  });
});
