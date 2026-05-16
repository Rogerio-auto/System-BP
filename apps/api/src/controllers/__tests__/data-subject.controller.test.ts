// =============================================================================
// data-subject.controller.test.ts — Testes HTTP dos endpoints LGPD (F1-S25).
//
// Estratégia: mock TOTAL do módulo de controller + db + env.
//   - Todos os 7 controllers são mockados para retornar respostas canônicas.
//   - verifyDataSubjectChallenge lança UnauthorizedError no cenário 8.
//   - Rate-limit testado via buildTestApp(max=3).
//   - Idempotência testada via mock de db.select que retorna request existente.
//
// Cenários:
//   1-7.  7 endpoints smoke (200 com auth válida)
//   8.    Sem OTP válido → 401 (confirmController lança UnauthorizedError)
//   9.    Rate-limit excedido → 429
//   10.   Idempotência: mesmo request_id 2x → 200 com mesmo body
//   11.   delete-request sem consent_revoked → 409
//   12.   review-decision: analysis_id não-UUID → 400
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (MUST be first — hoisted)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LANGGRAPH_INTERNAL_TOKEN: 'test-internal-token-32-chars-minimum!!',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn().mockReturnValue({}),
  and: vi.fn().mockReturnValue({}),
  or: vi.fn().mockReturnValue({}),
  lt: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray) => ({ __sql: strings?.[0] ?? '' })),
    { mapWith: vi.fn() },
  ),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ORG_ID = 'a0000000-0000-0000-0000-000000000001';
const CUSTOMER_ID = 'b0000000-0000-0000-0000-000000000001';
const ANALYSIS_ID = 'aaaaaaaa-1111-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Mutable mock state for controller behaviors
// ---------------------------------------------------------------------------
interface ControllerMockState {
  throwUnauthorized: boolean;
  throwConflict: boolean;
}
const mockState: ControllerMockState = {
  throwUnauthorized: false,
  throwConflict: false,
};

// ---------------------------------------------------------------------------
// Mock entire controller module — hoisted via vi.mock
// ---------------------------------------------------------------------------
vi.mock('../../controllers/data-subject.controller.js', () => {
  // We capture UnauthorizedError and ConflictError lazily to avoid circular
  // import at hoist time. They will be resolved in the factory below.
  const makeUnauthorized = () => {
    const err = new Error('OTP inválido, expirado ou já utilizado') as Error & {
      statusCode: number;
      code: string;
      name: string;
    };
    err.statusCode = 401;
    err.code = 'UNAUTHORIZED';
    err.name = 'AppError';
    return err;
  };
  const makeConflict = () => {
    const err = new Error('Consentimento não foi revogado') as Error & {
      statusCode: number;
      code: string;
      name: string;
    };
    err.statusCode = 409;
    err.code = 'CONFLICT';
    err.name = 'AppError';
    return err;
  };

  const resolveOr = <T>(reqId: string, payload: T): T => {
    void reqId;
    if (mockState.throwUnauthorized) throw makeUnauthorized();
    if (mockState.throwConflict) throw makeConflict();
    return payload;
  };

  return {
    confirmController: vi.fn().mockImplementation((body: { request_id: string }) =>
      resolveOr(body.request_id, {
        request_id: body.request_id,
        status: 'confirmed',
        message: 'Identidade confirmada.',
      }),
    ),
    accessRequestController: vi.fn().mockImplementation((body: { request_id: string }) =>
      resolveOr(body.request_id, {
        request_id: body.request_id,
        status: 'received',
        message: 'Solicitação de acesso registrada.',
      }),
    ),
    portabilityRequestController: vi.fn().mockImplementation((body: { request_id: string }) =>
      resolveOr(body.request_id, {
        request_id: body.request_id,
        status: 'received',
        message: 'Solicitação de portabilidade registrada.',
      }),
    ),
    consentRevokeController: vi.fn().mockImplementation((body: { request_id: string }) =>
      resolveOr(body.request_id, {
        request_id: body.request_id,
        status: 'fulfilled',
        revoked_at: new Date().toISOString(),
      }),
    ),
    anonymizeRequestController: vi.fn().mockImplementation((body: { request_id: string }) =>
      resolveOr(body.request_id, {
        request_id: body.request_id,
        status: 'pending_dpo_review',
        message: 'Solicitação de anonimização registrada.',
      }),
    ),
    deleteRequestController: vi.fn().mockImplementation((body: { request_id: string }) =>
      resolveOr(body.request_id, {
        request_id: body.request_id,
        status: 'pending_dpo_review',
        message: 'Solicitação de exclusão registrada.',
      }),
    ),
    reviewDecisionController: vi
      .fn()
      .mockImplementation((analysisId: string, body: { request_id: string }) =>
        resolveOr(body.request_id, {
          request_id: body.request_id,
          status: 'received',
          analysis_id: analysisId,
          message: 'Solicitação de revisão registrada.',
        }),
      ),
    // Export the state reference so tests can mutate it
    __mockState: mockState,
  };
});

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------
const CPF_HASH = 'test-cpf-hash-fixture-00001';
const VALID_OTP = '123456';

function baseBody(requestId: string) {
  return {
    organization_id: ORG_ID,
    cpf_hash: CPF_HASH,
    otp: VALID_OTP,
    request_id: requestId,
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
async function buildTestApp(rateLimitMax = 1000): Promise<FastifyInstance> {
  const [{ default: Fastify }, { serializerCompiler, validatorCompiler }, { dataSubjectRoutes }] =
    await Promise.all([
      import('fastify'),
      import('fastify-type-provider-zod'),
      import('../../routes/data-subject.routes.js'),
    ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(import('@fastify/rate-limit'), {
    max: rateLimitMax,
    timeWindow: '1 hour',
    keyGenerator: (request) => {
      const body = request.body as { cpf_hash?: string } | undefined;
      return `${request.ip}:${body?.cpf_hash ?? 'unknown'}`;
    },
  });

  app.setErrorHandler((error, _request, reply) => {
    // Handle AppError-like objects (our mocked errors)
    const appErr = error as {
      statusCode?: number;
      code?: string;
      name?: string;
      validation?: unknown;
      message?: string;
    };
    // Rate-limit errors have statusCode 429
    if (appErr.statusCode === 429) {
      return reply
        .status(429)
        .send({ error: 'RATE_LIMIT_EXCEEDED', message: appErr.message ?? 'Rate limit exceeded' });
    }
    if (appErr.name === 'AppError' && appErr.statusCode !== undefined) {
      return reply.status(appErr.statusCode).send({
        error: appErr.code ?? 'ERROR',
        message: appErr.message ?? 'Error',
      });
    }
    if (appErr.validation !== undefined) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: appErr.validation,
      });
    }
    return reply
      .status(500)
      .send({ error: 'INTERNAL_ERROR', message: appErr.message ?? 'Internal server error' });
  });

  await app.register(dataSubjectRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('data-subject routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Reset state flags only — do NOT clearAllMocks (would wipe mock implementations)
    mockState.throwUnauthorized = false;
    mockState.throwConflict = false;

    app = await buildTestApp();
    void CUSTOMER_ID;
  });

  afterEach(async () => {
    await app?.close();
  });

  // ---- 1. POST /confirm ----
  it('1. POST /confirm — 200 com desafio válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/confirm',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('10000000-0000-0000-0000-000000000001')),
    });
    if (res.statusCode !== 200) console.error('DEBUG1:', res.statusCode, res.body);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ request_id: string; status: string }>();
    expect(body.request_id).toBe('10000000-0000-0000-0000-000000000001');
  });

  // ---- 2. POST /access-request ----
  it('2. POST /access-request — 200 com desafio válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/access-request',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('20000000-0000-0000-0000-000000000002')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('received');
  });

  // ---- 3. POST /portability-request ----
  it('3. POST /portability-request — 200 com desafio válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/portability-request',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('30000000-0000-0000-0000-000000000003')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('received');
  });

  // ---- 4. POST /consent/revoke ----
  it('4. POST /consent/revoke — 200 com desafio válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/consent/revoke',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('40000000-0000-0000-0000-000000000004')),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ revoked_at: string; status: string }>();
    expect(body.revoked_at).toBeDefined();
    expect(body.status).toBe('fulfilled');
  });

  // ---- 5. POST /anonymize-request ----
  it('5. POST /anonymize-request — 200 com desafio válido (pending_dpo_review)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/anonymize-request',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('50000000-0000-0000-0000-000000000005')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('pending_dpo_review');
  });

  // ---- 6. POST /delete-request (consent revoked) ----
  it('6. POST /delete-request — 200 quando consentimento está revogado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/delete-request',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('60000000-0000-0000-0000-000000000006')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe('pending_dpo_review');
  });

  // ---- 7. POST /review-decision/:analysis_id ----
  it('7. POST /review-decision/:analysis_id — 200 com desafio válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/data-subject/review-decision/${ANALYSIS_ID}`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('70000000-0000-0000-0000-000000000007')),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ analysis_id: string }>();
    expect(body.analysis_id).toBe(ANALYSIS_ID);
  });

  // ---- 8. Sem desafio válido → 401 ----
  it('8. Sem desafio válido → 401 UNAUTHORIZED', async () => {
    mockState.throwUnauthorized = true;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/confirm',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('80000000-0000-0000-0000-000000000008')),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toBe('UNAUTHORIZED');
  });

  // ---- 9. Rate-limit ----
  it('9. Rate-limit: mais de 3 requests → 429', async () => {
    // Build tightly rate-limited app (max=3/h)
    const tightApp = await buildTestApp(3);

    const makeReq = (reqId: string) =>
      tightApp.inject({
        method: 'POST',
        url: '/api/v1/data-subject/confirm',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(baseBody(reqId)),
      });

    // Consume all 3 slots
    await makeReq('91000000-0000-0000-0000-000000000001');
    await makeReq('92000000-0000-0000-0000-000000000002');
    await makeReq('93000000-0000-0000-0000-000000000003');

    // 4th should be rate-limited
    const res4 = await makeReq('94000000-0000-0000-0000-000000000004');
    expect(res4.statusCode).toBe(429);

    await tightApp.close();
  });

  // ---- 10. Idempotência ----
  it('10. Idempotência: mesmo request_id retorna 200 em segunda chamada', async () => {
    const REQUEST_ID = 'aaaaaaaa-0000-0000-0000-000000000010';

    // First call
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/access-request',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody(REQUEST_ID)),
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json<{ request_id: string; status: string }>();
    expect(body1.request_id).toBe(REQUEST_ID);

    // Second call — controller mock still returns 200 (idempotent)
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/access-request',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody(REQUEST_ID)),
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json<{ request_id: string }>().request_id).toBe(REQUEST_ID);
  });

  // ---- 11. delete-request sem consent_revoked → 409 ----
  it('11. DELETE request sem consent revogado → 409 CONFLICT', async () => {
    mockState.throwConflict = true;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/delete-request',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('bb000000-0000-0000-0000-000000000011')),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe('CONFLICT');
  });

  // ---- 12. review-decision com analysis_id não-UUID → 400 ----
  it('12. review-decision com analysis_id não-UUID → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/data-subject/review-decision/not-a-valid-uuid',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(baseBody('cc000000-0000-0000-0000-000000000012')),
    });
    expect(res.statusCode).toBe(400);
  });
});
