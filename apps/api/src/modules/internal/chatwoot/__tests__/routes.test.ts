// =============================================================================
// internal/chatwoot/__tests__/routes.test.ts — Testes de integração F3-S08.
//
// Estratégia: sobe Fastify com internalChatwootRoutes (default export via autoload),
// mocka ChatwootClient para controlar respostas sem conectar no Chatwoot real.
//
// Caminhos de referência (relativos a __tests__/):
//   ../routes.js                              = src/modules/internal/chatwoot/routes.ts
//   ../../../../config/env.js                 = src/config/env.ts
//   ../../../../integrations/chatwoot/client.js = src/integrations/chatwoot/client.ts
//   ../../../../shared/errors.js              = src/shared/errors.ts
//
// Cobre:
//   1.  POST /internal/chatwoot/notes → 200 caminho feliz (nota criada)
//   2.  POST /internal/chatwoot/notes → 401 sem X-Internal-Token
//   3.  POST /internal/chatwoot/notes → 401 com token errado
//   4.  POST /internal/chatwoot/notes → 400 body inválido (sem chatwootConversationId)
//   5.  POST /internal/chatwoot/notes → 400 body inválido (chatwootConversationId não numérico)
//   6.  POST /internal/chatwoot/notes → 400 body inválido (sem body)
//   7.  POST /internal/chatwoot/notes → 400 body inválido (body vazio)
//   8.  POST /internal/chatwoot/notes → 400 body inválido (sem type)
//   9.  POST /internal/chatwoot/notes → 400 body inválido (type != 'internal')
//   10. POST /internal/chatwoot/notes → resposta contém apenas note_id (sem PII)
//   11. POST /internal/chatwoot/notes → createNote chamado com parâmetros corretos
//   12. POST /internal/chatwoot/notes → 400 body excede 10.000 caracteres
//   13. POST /internal/chatwoot/notes → chatwootConversationId coercido de string numérica
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
    // Chatwoot env — nunca será chamado de verdade (client mockado)
    CHATWOOT_BASE_URL: 'https://chatwoot.example.com',
    CHATWOOT_API_TOKEN: 'test-api-token',
    CHATWOOT_ACCOUNT_ID: 1,
  },
}));

// ---------------------------------------------------------------------------
// Mock ChatwootClient — controla respostas do Chatwoot sem conectar na API real.
//
// Caminho relativo a __tests__/:
//   ../../../../integrations/chatwoot/client.js = src/integrations/chatwoot/client.ts
//
// Mockamos a classe inteira: cada instância de ChatwootClient terá createNote mockado.
// ---------------------------------------------------------------------------
const mockCreateNote = vi.fn();

vi.mock('../../../../integrations/chatwoot/client.js', () => ({
  ChatwootClient: vi.fn().mockImplementation(() => ({
    createNote: mockCreateNote,
  })),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_CONVERSATION_ID = 42;
const FIXTURE_NOTE_ID = 9999;

const VALID_BODY = {
  chatwootConversationId: FIXTURE_CONVERSATION_ID,
  body: '**Nota de teste** gerada pela IA. Cliente solicitou atendimento.',
  type: 'internal' as const,
};

function makeNoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_NOTE_ID,
    content: VALID_BODY.body,
    message_type: 'outgoing',
    private: true,
    created_at: Math.floor(Date.now() / 1000),
    conversation_id: FIXTURE_CONVERSATION_ID,
    account_id: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Build test app
//
// Registra internalChatwootRoutes com prefix /internal/chatwoot para simular
// o comportamento do autoload + prefix '/internal' do app.ts.
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { default: internalChatwootRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    // Default export — padrão exigido pelo @fastify/autoload (F3-S08).
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

  // Registra o plugin com prefixo /internal/chatwoot (simula o autoload + app.ts prefix).
  await app.register(internalChatwootRoutes, { prefix: '/internal/chatwoot' });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('POST /internal/chatwoot/notes', () => {
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
  // 1. 200 — nota criada com sucesso
  // -------------------------------------------------------------------------
  it('retorna 200 com note_id quando nota é criada com sucesso', async () => {
    mockCreateNote.mockResolvedValueOnce(makeNoteResponse());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.note_id).toBe(FIXTURE_NOTE_ID);
  });

  // -------------------------------------------------------------------------
  // 2. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. 401 — token errado
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': 'wrong-token' },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 400 — sem chatwootConversationId
  // -------------------------------------------------------------------------
  it('retorna 400 quando chatwootConversationId está ausente', async () => {
    const { chatwootConversationId: _id, ...bodyWithoutId } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithoutId,
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 400 — chatwootConversationId não numérico (não coercível)
  // -------------------------------------------------------------------------
  it('retorna 400 quando chatwootConversationId não é número coercível', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, chatwootConversationId: 'not-a-number' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. 400 — sem body
  // -------------------------------------------------------------------------
  it('retorna 400 quando body está ausente', async () => {
    const { body: _body, ...payloadWithoutBody } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: payloadWithoutBody,
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 400 — body vazio
  // -------------------------------------------------------------------------
  it('retorna 400 quando body é string vazia', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, body: '' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 400 — sem type
  // -------------------------------------------------------------------------
  it('retorna 400 quando type está ausente', async () => {
    const { type: _type, ...payloadWithoutType } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: payloadWithoutType,
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 9. 400 — type != 'internal'
  // -------------------------------------------------------------------------
  it("retorna 400 quando type não é 'internal'", async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, type: 'outgoing' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. Resposta contém apenas note_id (sem PII) — minimização de dados
  // -------------------------------------------------------------------------
  it('resposta contém apenas note_id — sem conteúdo da nota (LGPD minimização)', async () => {
    mockCreateNote.mockResolvedValueOnce(makeNoteResponse());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Deve conter note_id
    expect(body).toHaveProperty('note_id', FIXTURE_NOTE_ID);
    // NÃO deve conter campos com PII ou conteúdo da nota
    expect(body).not.toHaveProperty('content');
    expect(body).not.toHaveProperty('body');
    expect(body).not.toHaveProperty('private');
    expect(body).not.toHaveProperty('message_type');
  });

  // -------------------------------------------------------------------------
  // 11. createNote chamado com parâmetros corretos
  // -------------------------------------------------------------------------
  it('chama createNote com conversationId e body corretos', async () => {
    mockCreateNote.mockResolvedValueOnce(makeNoteResponse());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    expect(mockCreateNote).toHaveBeenCalledTimes(1);
    expect(mockCreateNote).toHaveBeenCalledWith(
      FIXTURE_CONVERSATION_ID,
      VALID_BODY.body,
    );
  });

  // -------------------------------------------------------------------------
  // 12. 400 — body excede 10.000 caracteres
  // -------------------------------------------------------------------------
  it('retorna 400 quando body excede 10.000 caracteres', async () => {
    const longBody = 'a'.repeat(10_001);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, body: longBody },
    });

    expect(response.statusCode).toBe(400);
    expect(mockCreateNote).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 13. chatwootConversationId coercido de string numérica → number
  // -------------------------------------------------------------------------
  it('aceita chatwootConversationId como string numérica (coerção Zod)', async () => {
    mockCreateNote.mockResolvedValueOnce(makeNoteResponse());

    const response = await app.inject({
      method: 'POST',
      url: '/internal/chatwoot/notes',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, chatwootConversationId: '42' },
    });

    expect(response.statusCode).toBe(200);
    // Após coerção, createNote recebe número (não string)
    expect(mockCreateNote).toHaveBeenCalledWith(
      FIXTURE_CONVERSATION_ID, // 42 como number
      VALID_BODY.body,
    );
  });
});
