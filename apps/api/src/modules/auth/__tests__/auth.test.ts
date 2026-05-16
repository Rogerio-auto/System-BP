// =============================================================================
// auth.test.ts — Testes de integração do módulo auth.
//
// Estratégia: sobe Fastify com apenas o plugin authRoutes (sem DB real).
//   - `pg` mockado para evitar conexão real com Postgres.
//   - Drizzle mockado para retornar dados controlados de cada cenário.
//
// Testes cobertos:
//   1. login com credenciais corretas → 200 + access_token + cookies
//   2. login com senha errada → 401
//   3. login com email inexistente → 401 (mesma mensagem — anti-enumeração)
//   4. refresh válido → 200 + novo access_token + cookies rotacionados
//   5. refresh sem cookie → 401
//   6. refresh com CSRF errado → 401
//   7. logout → 204 + cookies limpos
//   8. rate-limit em /login → 429 após 5 tentativas
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg — evita conexão real com Postgres
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
// Mock do módulo de repositório — controla dados retornados por cada teste
// ---------------------------------------------------------------------------
const mockFindUserByEmail = vi.fn();
const mockFindUserById = vi.fn();
const mockUpdateUserLastLogin = vi.fn();
const mockCreateSession = vi.fn();
const mockFindSessionByTokenHash = vi.fn();
const mockRevokeSession = vi.fn();
const mockRotateSession = vi.fn();
const mockPurgeExpiredSessions = vi.fn();

vi.mock('../repository.js', () => ({
  findUserByEmail: (...args: unknown[]) => mockFindUserByEmail(...args),
  findUserById: (...args: unknown[]) => mockFindUserById(...args),
  updateUserLastLogin: (...args: unknown[]) => mockUpdateUserLastLogin(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  findSessionByTokenHash: (...args: unknown[]) => mockFindSessionByTokenHash(...args),
  findSessionById: () => vi.fn(),
  revokeSession: (...args: unknown[]) => mockRevokeSession(...args),
  rotateSession: (...args: unknown[]) => mockRotateSession(...args),
  purgeExpiredSessions: (...args: unknown[]) => mockPurgeExpiredSessions(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
import { passwordHash } from '../../../shared/password.js';

let hashedPassword: string;

beforeAll(async () => {
  hashedPassword = await passwordHash('senha-correta-123');
});

// UUIDs fixos válidos para usar nas fixtures
const FIXTURE_USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FIXTURE_ORG_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const makeUser = (overrides?: Record<string, unknown>) => ({
  id: FIXTURE_USER_ID,
  organizationId: FIXTURE_ORG_ID,
  email: 'agente@bdp.ro.gov.br',
  passwordHash: hashedPassword,
  fullName: 'Agente Teste',
  status: 'active' as const,
  lastLoginAt: null,
  totpSecret: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const FIXTURE_SESSION_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

const makeSession = (overrides?: Record<string, unknown>) => ({
  id: FIXTURE_SESSION_ID,
  userId: FIXTURE_USER_ID,
  refreshTokenHash: 'hash',
  userAgent: 'vitest',
  ip: '127.0.0.1',
  createdAt: new Date(),
  lastUsedAt: new Date(),
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  revokedAt: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup do app de teste
// ---------------------------------------------------------------------------
async function buildTestApp(): Promise<FastifyInstance> {
  // Import dinâmico depois dos mocks para garantir interceptação correta
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { authRoutes },
    { isAppError },
    { default: rateLimit },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
    import('../../../shared/errors.js'),
    import('@fastify/rate-limit'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Rate-limit global (necessário para config.rateLimit por rota)
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // Error handler que espelha o de app.ts — necessário para AppError virar 4xx
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }
    if (
      error !== null &&
      typeof error === 'object' &&
      'validation' in error &&
      (error as Record<string, unknown>)['validation'] !== undefined
    ) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: (error as Record<string, unknown>)['validation'],
      });
    }
    // Erros com statusCode explícito (ex: rate-limit 429, sensible errors)
    const errObj = error as { statusCode?: number; code?: string; message?: string };
    if (errObj.statusCode !== undefined && errObj.statusCode >= 400 && errObj.statusCode < 600) {
      return reply.status(errObj.statusCode).send({
        error: errObj.code ?? 'ERROR',
        message: errObj.message ?? 'Error',
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(authRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------
describe('POST /api/auth/login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUserLastLogin.mockResolvedValue(undefined);
    mockCreateSession.mockResolvedValue(undefined);
  });

  it('retorna 200 com access_token e seta cookies quando credenciais corretas', async () => {
    mockFindUserByEmail.mockResolvedValue(makeUser());

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'agente@bdp.ro.gov.br', password: 'senha-correta-123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('expires_in');
    expect(body['user']).toMatchObject({
      id: FIXTURE_USER_ID,
      email: 'agente@bdp.ro.gov.br',
      full_name: 'Agente Teste',
      organization_id: FIXTURE_ORG_ID,
    });

    const setCookieHeader = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ''];
    const refreshCookie = cookies.find((c) => c.startsWith('refresh_token='));
    const csrfCookie = cookies.find((c) => c.startsWith('csrf_token='));

    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(csrfCookie).toBeDefined();
    // csrf_token NÃO deve ter HttpOnly (precisa ser lido pelo JS)
    expect(csrfCookie).not.toMatch(/HttpOnly/i);
  });

  it('retorna 401 quando senha incorreta', async () => {
    mockFindUserByEmail.mockResolvedValue(makeUser());

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'agente@bdp.ro.gov.br', password: 'senha-errada' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<Record<string, unknown>>()['error']).toBe('UNAUTHORIZED');
  });

  it('retorna 401 quando email não existe (sem revelar existência)', async () => {
    mockFindUserByEmail.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nao-existe@bdp.ro.gov.br', password: 'qualquer' },
    });

    expect(res.statusCode).toBe(401);
    // Mesma mensagem que senha errada — anti-enumeração de usuários
    expect(res.json<Record<string, unknown>>()['message']).toBe('Credenciais inválidas');
  });

  it('retorna 401 quando usuário está disabled', async () => {
    mockFindUserByEmail.mockResolvedValue(makeUser({ status: 'disabled' }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'agente@bdp.ro.gov.br', password: 'senha-correta-123' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 400 quando body inválido (email malformado)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nao-e-email', password: 'abc' },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/auth/refresh', () => {
  let app: FastifyInstance;
  let validRefreshToken: string;
  let validSessionId: string;
  let validTokenHash: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRotateSession.mockResolvedValue(undefined);

    // Gerar um refresh token válido para usar nos testes
    const { signRefreshToken, hashRefreshToken } = await import('../../../shared/jwt.js');
    validSessionId = FIXTURE_SESSION_ID;
    validRefreshToken = await signRefreshToken({ sub: FIXTURE_USER_ID, jti: validSessionId });
    validTokenHash = await hashRefreshToken(validRefreshToken);
  });

  it('retorna 200 com novo access_token quando refresh válido', async () => {
    mockFindSessionByTokenHash.mockResolvedValue(makeSession({ refreshTokenHash: validTokenHash }));
    mockFindUserById.mockResolvedValue(makeUser());

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: validRefreshToken },
      headers: { 'x-csrf-token': validSessionId },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('access_token');
    expect(body).toHaveProperty('expires_in');

    // Verifica rotação de cookies
    const setCookieHeader = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ''];
    expect(cookies.some((c) => c.startsWith('refresh_token='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('csrf_token='))).toBe(true);
    expect(mockRotateSession).toHaveBeenCalledOnce();
  });

  it('retorna 401 quando refresh_token cookie ausente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { 'x-csrf-token': 'qualquer' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 quando CSRF header ausente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: validRefreshToken },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 quando CSRF token não bate com jti do refresh token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: validRefreshToken },
      headers: { 'x-csrf-token': 'csrf-errado-nao-bate' },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 quando sessão não existe no banco (revogada)', async () => {
    mockFindSessionByTokenHash.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refresh_token: validRefreshToken },
      headers: { 'x-csrf-token': validSessionId },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/auth/logout', () => {
  let app: FastifyInstance;
  let validRefreshToken: string;
  let validSessionId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRevokeSession.mockResolvedValue(undefined);
    mockPurgeExpiredSessions.mockResolvedValue(undefined);

    const { signRefreshToken } = await import('../../../shared/jwt.js');
    validSessionId = FIXTURE_SESSION_ID;
    validRefreshToken = await signRefreshToken({ sub: FIXTURE_USER_ID, jti: validSessionId });
  });

  it('retorna 204 e limpa cookies quando refresh token válido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { refresh_token: validRefreshToken },
      payload: {},
    });

    expect(res.statusCode).toBe(204);

    // Verifica que os cookies foram limpos (maxAge=0 ou expires no passado)
    const setCookieHeader = res.headers['set-cookie'];
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ''];
    const refreshCookie = cookies.find((c) => c.startsWith('refresh_token='));
    expect(refreshCookie).toMatch(/Max-Age=0/i);
  });

  it('retorna 204 mesmo sem cookie de refresh (idempotente)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: {},
    });

    expect(res.statusCode).toBe(204);
    expect(mockRevokeSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Rate-limit em /api/auth/login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    // Sempre retorna user não encontrado — falha rápida sem bcrypt
    mockFindUserByEmail.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 429 após 5 tentativas de login por IP', async () => {
    // Fazer 5 tentativas que falham (401) — dentro do limite
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: `user${i}@test.com`, password: 'wrong' },
      });
    }

    // A 6ª tentativa deve retornar 429
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user6@test.com', password: 'wrong' },
    });

    expect(res.statusCode).toBe(429);
  });
});
