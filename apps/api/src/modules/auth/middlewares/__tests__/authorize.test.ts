// =============================================================================
// authorize.test.ts — Testes de integração do middleware authorize().
//
// Estratégia: sobe Fastify com rotas de teste que encadeiam
//   authenticate() + authorize({ permissions: [...] }).
//   O contexto request.user é injetado via mock de loadUserAuthContext.
//
// Cenários cobertos:
//   1. Usuário com permissão presente → 200.
//   2. Usuário sem permissão necessária → 403.
//   3. Usuário com múltiplas permissões, todas presentes → 200.
//   4. Usuário com múltiplas permissões, uma ausente → 403.
//   5. Usuário com wildcard '*' → 200 (bypass total).
//   6. request.user não definido (authenticate() pulado) → 401.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock db/client — evita que o Drizzle processe cities.ts que usa .using('gin')
// não suportado na versão 0.34.1 (bug pré-existente F1-S05).
// ---------------------------------------------------------------------------
vi.mock('../../../../db/client.js', () => ({
  db: {},
}));

// ---------------------------------------------------------------------------
// Mock do user-context repository
// ---------------------------------------------------------------------------
const mockLoadUserAuthContext = vi.fn();

vi.mock('../user-context.repository.js', () => ({
  loadUserAuthContext: (...args: unknown[]) => mockLoadUserAuthContext(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXTURE_USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FIXTURE_ORG_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const CITY_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

// ---------------------------------------------------------------------------
// App de teste
// ---------------------------------------------------------------------------
async function buildTestApp(): Promise<FastifyInstance> {
  const [{ default: Fastify }, { authenticate }, { authorize }, { isAppError }] = await Promise.all(
    [
      import('fastify'),
      import('../authenticate.js'),
      import('../authorize.js'),
      import('../../../../shared/errors.js'),
    ],
  );

  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  // Rota com permissão simples
  app.get(
    '/leads',
    { preHandler: [authenticate(), authorize({ permissions: ['leads:read'] })] },
    async (_req, reply) => reply.status(200).send({ ok: true }),
  );

  // Rota com múltiplas permissões (AND)
  app.get(
    '/leads/merge',
    {
      preHandler: [authenticate(), authorize({ permissions: ['leads:read', 'leads:merge'] })],
    },
    async (_req, reply) => reply.status(200).send({ ok: true }),
  );

  // Rota sem authenticate() para testar o guard defensivo de authorize()
  app.get(
    '/no-auth',
    { preHandler: [authorize({ permissions: ['leads:read'] })] },
    async (_req, reply) => reply.status(200).send({ ok: true }),
  );

  await app.ready();
  return app;
}

async function makeValidToken(): Promise<string> {
  const { signAccessToken } = await import('../../../../shared/jwt.js');
  return signAccessToken({ sub: FIXTURE_USER_ID, org: FIXTURE_ORG_ID, jti: 'test-session' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authorize() middleware', () => {
  let app: FastifyInstance;
  let validToken: string;

  beforeAll(async () => {
    app = await buildTestApp();
    validToken = await makeValidToken();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  it('retorna 200 quando usuário tem a permissão requerida', async () => {
    mockLoadUserAuthContext.mockResolvedValue({
      permissions: ['leads:read', 'customers:read'],
      cityScopeIds: [CITY_ID],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/leads',
      headers: { authorization: `Bearer ${validToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  it('retorna 403 quando usuário não tem a permissão requerida', async () => {
    mockLoadUserAuthContext.mockResolvedValue({
      permissions: ['customers:read'], // sem leads:read
      cityScopeIds: [CITY_ID],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/leads',
      headers: { authorization: `Bearer ${validToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
  });

  // -------------------------------------------------------------------------
  it('retorna 200 quando usuário tem todas as permissões requeridas (AND)', async () => {
    mockLoadUserAuthContext.mockResolvedValue({
      permissions: ['leads:read', 'leads:merge', 'customers:read'],
      cityScopeIds: [CITY_ID],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/leads/merge',
      headers: { authorization: `Bearer ${validToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  it('retorna 403 quando usuário tem apenas uma das permissões múltiplas requeridas', async () => {
    mockLoadUserAuthContext.mockResolvedValue({
      permissions: ['leads:read'], // tem leads:read mas não leads:merge
      cityScopeIds: [CITY_ID],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/leads/merge',
      headers: { authorization: `Bearer ${validToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------------
  it('retorna 200 para usuário com wildcard "*" (bypass total)', async () => {
    mockLoadUserAuthContext.mockResolvedValue({
      permissions: ['*'],
      cityScopeIds: null,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/leads/merge',
      headers: { authorization: `Bearer ${validToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  it('retorna 401 quando authorize() é chamado sem authenticate() antes (guard defensivo)', async () => {
    // A rota /no-auth não tem authenticate(), então request.user é undefined
    const res = await app.inject({
      method: 'GET',
      url: '/no-auth',
    });

    expect(res.statusCode).toBe(401);
  });
});
