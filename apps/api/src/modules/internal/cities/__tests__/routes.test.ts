// =============================================================================
// internal/cities/__tests__/routes.test.ts — Testes de integração F3-S05.
//
// Estratégia: sobe Fastify com internalCitiesRoutes (default export via autoload),
// mocka db e findCitiesByFuzzyMatch para controlar respostas sem conectar em banco real.
//
// Caminhos de referência (relativos a __tests__/):
//   ../routes.js                         = src/modules/internal/cities/routes.ts
//   ../../../../config/env.js            = src/config/env.ts
//   ../../../../db/client.js             = src/db/client.ts
//   ../../../../events/emit.js           = src/events/emit.ts
//   ../../../../shared/errors.js         = src/shared/errors.ts
//   ../../../cities/repository.js        = src/modules/cities/repository.ts
//
// Cobre:
//   1.  POST /internal/cities/identify → 401 sem X-Internal-Token
//   2.  POST /internal/cities/identify → 401 com token errado
//   3.  POST /internal/cities/identify → 400 sem city_text
//   4.  POST /internal/cities/identify → 400 sem organization_id
//   5.  POST /internal/cities/identify → 400 organization_id não-UUID
//   6.  POST /internal/cities/identify → 400 lead_id não-UUID
//   7.  POST /internal/cities/identify → 200 matched: true (confidence >= 0.85)
//   8.  POST /internal/cities/identify → 200 matched: true + evento outbox emitido
//   9.  POST /internal/cities/identify → 200 matched: false + alternatives (top 3)
//   10. POST /internal/cities/identify → 200 matched: false, out_of_service: true
//   11. POST /internal/cities/identify → 200 matched: false sem candidatos
//   12. POST /internal/cities/identify → sem lead_id não emite evento
//   13. POST /internal/cities/identify → matched: true sem lead_id não emite evento
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
const mockTransaction = vi.fn();

vi.mock('../../../../db/client.js', () => ({
  db: {
    execute: vi.fn(),
    transaction: (...args: Parameters<typeof mockTransaction>) => mockTransaction(...args),
  },
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock events/emit
// ---------------------------------------------------------------------------
const mockEmit = vi.fn();

vi.mock('../../../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

// ---------------------------------------------------------------------------
// Mock cities/repository — controla retorno do fuzzy match
// ---------------------------------------------------------------------------
const mockFindCitiesByFuzzyMatch = vi.fn();

vi.mock('../../../cities/repository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    findCitiesByFuzzyMatch: (...args: unknown[]) => mockFindCitiesByFuzzyMatch(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_2 = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_3 = 'eeeeeeee-0000-0000-0000-000000000001';

const VALID_BODY = {
  organization_id: FIXTURE_ORG_ID,
  city_text: 'porto velho',
};

function makeCandidate(
  overrides: Partial<{
    id: string;
    name: string;
    similarity: number;
    is_active: boolean;
  }> = {},
) {
  return {
    id: FIXTURE_CITY_ID,
    name: 'Porto Velho',
    similarity: 0.92,
    is_active: true,
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
    { default: internalCitiesRoutes },
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
        return reply.status(error.statusCode).send({
          error: error.code,
          message: error.message,
        });
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

  await app.register(internalCitiesRoutes, { prefix: '/internal/cities' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('POST /internal/cities/identify', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Por padrão mockTransaction executa o callback imediatamente (sem DB real)
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => cb({}));
  });

  // -------------------------------------------------------------------------
  // 1. 401 — sem X-Internal-Token
  // -------------------------------------------------------------------------
  it('retorna 401 sem X-Internal-Token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindCitiesByFuzzyMatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 2. 401 — token errado
  // -------------------------------------------------------------------------
  it('retorna 401 com token inválido', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': 'wrong-token' },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(401);
    expect(mockFindCitiesByFuzzyMatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 3. 400 — sem city_text
  // -------------------------------------------------------------------------
  it('retorna 400 quando city_text está ausente', async () => {
    const { city_text: _ct, ...bodyWithout } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithout,
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindCitiesByFuzzyMatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 4. 400 — sem organization_id
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id está ausente', async () => {
    const { organization_id: _org, ...bodyWithout } = VALID_BODY;

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: bodyWithout,
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindCitiesByFuzzyMatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 5. 400 — organization_id não-UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando organization_id não é UUID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, organization_id: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindCitiesByFuzzyMatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 6. 400 — lead_id não-UUID
  // -------------------------------------------------------------------------
  it('retorna 400 quando lead_id não é UUID', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, lead_id: 'not-a-uuid' },
    });

    expect(response.statusCode).toBe(400);
    expect(mockFindCitiesByFuzzyMatch).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 7. 200 — matched: true (confidence >= 0.85, sem lead_id → sem evento)
  // -------------------------------------------------------------------------
  it('retorna matched: true quando confidence >= 0.85', async () => {
    mockFindCitiesByFuzzyMatch.mockResolvedValueOnce([makeCandidate({ similarity: 0.92 })]);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matched).toBe(true);
    expect(body.city_id).toBe(FIXTURE_CITY_ID);
    expect(body.city_name).toBe('Porto Velho');
    expect(body.confidence).toBe(0.92);
    expect(body.out_of_service).toBe(false);
    expect(body.alternatives).toHaveLength(0);
    // Sem lead_id → sem transação/evento
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 8. 200 — matched: true + evento cities.identified emitido (com lead_id)
  // -------------------------------------------------------------------------
  it('emite cities.identified via outbox quando matched: true e lead_id informado', async () => {
    mockFindCitiesByFuzzyMatch.mockResolvedValueOnce([makeCandidate({ similarity: 0.95 })]);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, lead_id: FIXTURE_LEAD_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matched).toBe(true);

    // Transação foi aberta
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // emit foi chamado dentro da transação
    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith(
      expect.anything(), // tx
      expect.objectContaining({
        eventName: 'cities.identified',
        aggregateType: 'city',
        aggregateId: FIXTURE_CITY_ID,
        organizationId: FIXTURE_ORG_ID,
        data: expect.objectContaining({
          lead_id: FIXTURE_LEAD_ID,
          city_id: FIXTURE_CITY_ID,
          source_text: 'porto velho',
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // 9. 200 — matched: false + alternatives (confidence < 0.85)
  // -------------------------------------------------------------------------
  it('retorna matched: false com alternatives quando confidence < 0.85', async () => {
    mockFindCitiesByFuzzyMatch.mockResolvedValueOnce([
      makeCandidate({ id: FIXTURE_CITY_ID, name: 'Porto Velho', similarity: 0.7 }),
      makeCandidate({ id: FIXTURE_CITY_ID_2, name: 'Ji-Paraná', similarity: 0.6 }),
      makeCandidate({ id: FIXTURE_CITY_ID_3, name: 'Vilhena', similarity: 0.5 }),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, lead_id: FIXTURE_LEAD_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matched).toBe(false);
    expect(body.city_id).toBeNull();
    expect(body.city_name).toBeNull();
    expect(body.confidence).toBe(0.7);
    expect(body.out_of_service).toBe(false);
    expect(body.alternatives).toHaveLength(3);
    expect(body.alternatives[0]).toMatchObject({
      city_id: FIXTURE_CITY_ID,
      city_name: 'Porto Velho',
    });
    // Não emite evento quando matched: false
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 10. 200 — matched: false, out_of_service: true (melhor candidato inativo)
  // -------------------------------------------------------------------------
  it('retorna out_of_service: true quando melhor candidato está inativo', async () => {
    mockFindCitiesByFuzzyMatch.mockResolvedValueOnce([
      makeCandidate({ similarity: 0.95, is_active: false }),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { ...VALID_BODY, lead_id: FIXTURE_LEAD_ID },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matched).toBe(false);
    expect(body.out_of_service).toBe(true);
    expect(body.city_id).toBeNull();
    expect(body.alternatives).toHaveLength(0);
    // Não emite evento
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 11. 200 — matched: false, sem candidatos
  // -------------------------------------------------------------------------
  it('retorna matched: false sem alternativas quando nenhum candidato encontrado', async () => {
    mockFindCitiesByFuzzyMatch.mockResolvedValueOnce([]);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matched).toBe(false);
    expect(body.confidence).toBe(0);
    expect(body.out_of_service).toBe(false);
    expect(body.alternatives).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 12. matched: true sem lead_id — NÃO emite evento
  // -------------------------------------------------------------------------
  it('não emite evento quando matched: true mas lead_id ausente', async () => {
    mockFindCitiesByFuzzyMatch.mockResolvedValueOnce([makeCandidate({ similarity: 0.9 })]);

    const response = await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY, // sem lead_id
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.matched).toBe(true);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 13. findCitiesByFuzzyMatch chamado com os parâmetros corretos
  // -------------------------------------------------------------------------
  it('chama findCitiesByFuzzyMatch com organization_id e city_text corretos', async () => {
    mockFindCitiesByFuzzyMatch.mockResolvedValueOnce([]);

    await app.inject({
      method: 'POST',
      url: '/internal/cities/identify',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: VALID_BODY,
    });

    expect(mockFindCitiesByFuzzyMatch).toHaveBeenCalledOnce();
    expect(mockFindCitiesByFuzzyMatch).toHaveBeenCalledWith(
      expect.anything(), // db (mockado)
      FIXTURE_ORG_ID,
      'porto velho',
      4,
    );
  });
});
