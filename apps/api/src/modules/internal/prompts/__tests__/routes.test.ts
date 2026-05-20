// =============================================================================
// internal/prompts/__tests__/routes.test.ts — Testes do GET /internal/prompts/active/:key (F9-S09).
//
// Estratégia: sobe Fastify com internalPromptsRoutes, mocka db e
// findActivePromptByKey para controlar respostas sem conectar em banco real.
//
// Cobre (DoD F9-S09 — lado API):
//   1.  GET /active/:key → 200 com payload completo (todos os 8 campos)
//   2.  GET /active/:key → 404 quando não há versão ativa para a key
//   3.  GET /active/:key → 401 sem X-Internal-Token
//   4.  GET /active/:key → 401 com token inválido
//   5.  GET /active/:key → 400 com key vazia
//   6.  payload contém prompt_version = "${key}@v${version}"
//   7.  temperature/max_tokens/top_p null → aparecem como null no payload
//   8.  temperatura e top_p são retornados como number (não string)
//   9.  Cache-Control: max-age=60 está presente na resposta 200
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
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock findActivePromptByKey do repository
// ---------------------------------------------------------------------------
const mockFindActivePromptByKey = vi.fn();

vi.mock('../repository.js', () => ({
  findActivePromptByKey: (...args: unknown[]) => mockFindActivePromptByKey(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ActivePromptRow {
  key: string;
  version: number;
  body: string;
  contentHash: string;
  modelRecommended: string | null;
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
}

function makeActivePrompt(overrides: Partial<ActivePromptRow> = {}): ActivePromptRow {
  return {
    key: 'pre_attendance_classify',
    version: 1,
    body: '# Papel\n\nVocê é o classificador de intenção.',
    contentHash: 'abc123sha256hash',
    modelRecommended: 'anthropic/claude-3-5-haiku',
    temperature: null,
    maxTokens: null,
    topP: null,
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
    { default: internalPromptsRoutes },
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
    (
      error: Error & { validation?: unknown; statusCode?: number },
      _request: unknown,
      reply: { status: (n: number) => { send: (b: unknown) => void } },
    ) => {
      if (isAppError(error)) {
        const body: Record<string, unknown> = {
          error: (error as unknown as { code: string }).code,
          message: error.message,
        };
        return reply.status((error as unknown as { statusCode: number }).statusCode).send(body);
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

  await app.register(internalPromptsRoutes, { prefix: '/internal/prompts' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('GET /internal/prompts/active/:key', () => {
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
  // 1. 200 com payload completo
  // -------------------------------------------------------------------------
  it('retorna 200 com payload completo quando versão ativa existe', async () => {
    const prompt = makeActivePrompt({
      temperature: 0.0,
      maxTokens: 32,
    });
    mockFindActivePromptByKey.mockResolvedValueOnce(prompt);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/pre_attendance_classify',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.key).toBe('pre_attendance_classify');
    expect(body.version).toBe(1);
    expect(body.body).toBe(prompt.body);
    expect(body.content_hash).toBe('abc123sha256hash');
    expect(body.model_recommended).toBe('anthropic/claude-3-5-haiku');
    expect(body.temperature).toBe(0.0);
    expect(body.max_tokens).toBe(32);
    expect(body.top_p).toBeNull();
    expect(body.prompt_version).toBe('pre_attendance_classify@v1');
  });

  // -------------------------------------------------------------------------
  // 2. 404 quando não há versão ativa
  // -------------------------------------------------------------------------
  it('retorna 404 quando não há versão ativa para a key', async () => {
    mockFindActivePromptByKey.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/inexistente_key',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(404);
    expect(mockFindActivePromptByKey).toHaveBeenCalledWith('inexistente_key');
  });

  // -------------------------------------------------------------------------
  // 3. 401 sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/pre_attendance_classify',
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindActivePromptByKey).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 401 com token inválido
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/pre_attendance_classify',
      headers: { 'x-internal-token': 'wrong-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindActivePromptByKey).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. prompt_version = "${key}@v${version}"
  // -------------------------------------------------------------------------
  it('compõe prompt_version corretamente', async () => {
    const prompt = makeActivePrompt({ key: 'simulation', version: 3 });
    mockFindActivePromptByKey.mockResolvedValueOnce(prompt);

    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/simulation',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().prompt_version).toBe('simulation@v3');
  });

  // -------------------------------------------------------------------------
  // 6. temperature/max_tokens/top_p null → aparecem como null no payload
  // -------------------------------------------------------------------------
  it('retorna null para campos LLM quando não definidos no prompt', async () => {
    mockFindActivePromptByKey.mockResolvedValueOnce(makeActivePrompt());

    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/pre_attendance_classify',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.temperature).toBeNull();
    expect(body.max_tokens).toBeNull();
    expect(body.top_p).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 7. temperatura e top_p são numbers, não strings
  // -------------------------------------------------------------------------
  it('retorna temperature e top_p como number (não string)', async () => {
    mockFindActivePromptByKey.mockResolvedValueOnce(
      makeActivePrompt({ temperature: 0.3, topP: 0.95 }),
    );

    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/pre_attendance_classify',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.temperature).toBe('number');
    expect(typeof body.top_p).toBe('number');
    expect(body.temperature).toBeCloseTo(0.3);
    expect(body.top_p).toBeCloseTo(0.95);
  });

  // -------------------------------------------------------------------------
  // 8. Cache-Control: max-age=60 na resposta 200
  // -------------------------------------------------------------------------
  it('inclui Cache-Control: max-age=60 na resposta 200', async () => {
    mockFindActivePromptByKey.mockResolvedValueOnce(makeActivePrompt());

    const response = await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/pre_attendance_classify',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(response.statusCode).toBe(200);
    const cacheControl = response.headers['cache-control'];
    expect(cacheControl).toContain('max-age=60');
  });

  // -------------------------------------------------------------------------
  // 9. findActivePromptByKey é chamado com a key correta
  // -------------------------------------------------------------------------
  it('chama findActivePromptByKey com a key do path param', async () => {
    mockFindActivePromptByKey.mockResolvedValueOnce(
      makeActivePrompt({ key: 'pre_attendance_qualify' }),
    );

    await app.inject({
      method: 'GET',
      url: '/internal/prompts/active/pre_attendance_qualify',
      headers: { 'x-internal-token': VALID_TOKEN },
    });

    expect(mockFindActivePromptByKey).toHaveBeenCalledWith('pre_attendance_qualify');
  });
});
