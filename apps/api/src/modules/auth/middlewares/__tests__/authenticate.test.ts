// =============================================================================
// authenticate.test.ts — Testes de integração do middleware authenticate().
//
// Estratégia: sobe Fastify com uma rota de teste que usa authenticate() como
// preHandler. DB mockado para controlar o contexto retornado.
//
// Cenários cobertos:
//   1. Token válido + usuário ativo → 200, request.user populado.
//   2. Header Authorization ausente → 401.
//   3. Header malformado (sem "Bearer ") → 401.
//   4. Token com assinatura inválida → 401.
//   5. Token expirado → 401.
//   6. Token válido + usuário inativo (loadUserAuthContext retorna null) → 401.
//   7. Token válido + admin (cityScopeIds null) → 200, cityScopeIds null.
//   8. Token válido + agente com cidades → 200, cityScopeIds com UUIDs.
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock db/client — evita que o Drizzle tente processar o schema (cities.ts usa
// .using('gin') que não é suportado pelo Drizzle 0.34.1 — bug pré-existente F1-S05).
// O authenticate.ts importa db diretamente; mockar aqui evita o erro de runtime.
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
const CITY_PORTO_VELHO = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const CITY_JI_PARANA = 'd4e5f6a7-b8c9-0123-defa-234567890123';

const makeUserCtx = (
  overrides?: Partial<{ permissions: string[]; cityScopeIds: string[] | null }>,
) => ({
  permissions: ['leads:read', 'customers:read'],
  cityScopeIds: [CITY_PORTO_VELHO],
  ...overrides,
});

// ---------------------------------------------------------------------------
// App de teste
// ---------------------------------------------------------------------------
async function buildTestApp(): Promise<FastifyInstance> {
  const [{ default: Fastify }, { authenticate }, { isAppError }] = await Promise.all([
    import('fastify'),
    import('../authenticate.js'),
    import('../../../../shared/errors.js'),
  ]);

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

  // Rota de teste que expõe request.user como resposta
  app.get('/test-protected', { preHandler: [authenticate()] }, async (request, reply) => {
    return reply.status(200).send({ user: request.user });
  });

  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Helpers para gerar tokens reais para testes
// ---------------------------------------------------------------------------
async function makeValidToken(userId = FIXTURE_USER_ID, orgId = FIXTURE_ORG_ID): Promise<string> {
  const { signAccessToken } = await import('../../../../shared/jwt.js');
  return signAccessToken({ sub: userId, org: orgId, jti: 'test-session-id' });
}

async function makeExpiredToken(): Promise<string> {
  // Usamos jose diretamente para controlar a expiração
  const { SignJWT } = await import('jose');
  const secret = new TextEncoder().encode(process.env['JWT_ACCESS_SECRET'] ?? 'x'.repeat(64));
  return new SignJWT({ org: FIXTURE_ORG_ID })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(FIXTURE_USER_ID)
    .setJti('expired-session')
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600) // 1h atrás
    .setExpirationTime(Math.floor(Date.now() / 1000) - 1800) // expirou 30min atrás
    .sign(secret);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('authenticate() middleware', () => {
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
  it('retorna 200 e popula request.user quando token válido e usuário ativo', async () => {
    const token = await makeValidToken();
    mockLoadUserAuthContext.mockResolvedValue(makeUserCtx());

    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: Record<string, unknown> }>();
    expect(body.user).toMatchObject({
      id: FIXTURE_USER_ID,
      organizationId: FIXTURE_ORG_ID,
      permissions: ['leads:read', 'customers:read'],
      cityScopeIds: [CITY_PORTO_VELHO],
    });
  });

  // -------------------------------------------------------------------------
  it('retorna 401 quando header Authorization está ausente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<Record<string, unknown>>()['error']).toBe('UNAUTHORIZED');
  });

  // -------------------------------------------------------------------------
  it('retorna 401 quando header Authorization não começa com "Bearer "', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: 'Token xyz' },
    });

    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  it('retorna 401 quando token tem assinatura inválida', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.invalido.assinatura' },
    });

    expect(res.statusCode).toBe(401);
    expect(mockLoadUserAuthContext).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it('retorna 401 quando token está expirado', async () => {
    const expiredToken = await makeExpiredToken();

    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: `Bearer ${expiredToken}` },
    });

    expect(res.statusCode).toBe(401);
    expect(mockLoadUserAuthContext).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  it('retorna 401 quando usuário está inativo (loadUserAuthContext retorna null)', async () => {
    const token = await makeValidToken();
    mockLoadUserAuthContext.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------------
  it('popula cityScopeIds como null para admin (acesso global)', async () => {
    const token = await makeValidToken();
    mockLoadUserAuthContext.mockResolvedValue(
      makeUserCtx({ cityScopeIds: null, permissions: ['leads:read', '*'] }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: Record<string, unknown> }>();
    expect(body.user['cityScopeIds']).toBeNull();
  });

  // -------------------------------------------------------------------------
  it('popula cityScopeIds com múltiplas cidades para gestor_regional', async () => {
    const token = await makeValidToken();
    mockLoadUserAuthContext.mockResolvedValue(
      makeUserCtx({ cityScopeIds: [CITY_PORTO_VELHO, CITY_JI_PARANA] }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/test-protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: Record<string, unknown> }>();
    expect(body.user['cityScopeIds']).toEqual([CITY_PORTO_VELHO, CITY_JI_PARANA]);
  });
});
