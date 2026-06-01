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
// Mock db/client — o service.ts de auth agora usa db.transaction em verify2fa
// (MED-1 hardening). O mock executa o callback passando o próprio objeto db,
// o que garante que os mocks de repository continuem a ser chamados dentro
// da transação simulada.
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => {
  const mockDb = {
    // Simula db.transaction executando o callback com o próprio mockDb como tx.
    // Isso garante que markTotpChallengeUsedAtomic e createSession (chamados
    // dentro do callback) continuem a usar os mocks de repository.
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
  };
  return { db: mockDb, pool: { end: vi.fn() } };
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
// 2FA mocks
const mockCreateTotpChallenge = vi.fn();
const mockFindTotpChallengeByHash = vi.fn();
// markTotpChallengeUsedAtomic: gate CAS — retorna true (consumido com sucesso) por padrão.
const mockMarkTotpChallengeUsedAtomic = vi.fn().mockResolvedValue(true);

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
  // 2FA
  createTotpChallenge: (...args: unknown[]) => mockCreateTotpChallenge(...args),
  findTotpChallengeByHash: (...args: unknown[]) => mockFindTotpChallengeByHash(...args),
  // Renomeado para gate atômico (F8-S11 hardening MED-1)
  markTotpChallengeUsedAtomic: (...args: unknown[]) => mockMarkTotpChallengeUsedAtomic(...args),
  purgeExpiredChallenges: vi.fn().mockResolvedValue(undefined),
}));

// Mock do account/repository.js (para listAvailableRecoveryCodes e markRecoveryCodeUsedAtomic)
const mockListAvailableRecoveryCodes = vi.fn();
// markRecoveryCodeUsedAtomic: gate CAS — retorna true por padrão.
const mockMarkRecoveryCodeUsedAtomic = vi.fn().mockResolvedValue(true);

vi.mock('../../account/repository.js', () => ({
  listAvailableRecoveryCodes: (...args: unknown[]) => mockListAvailableRecoveryCodes(...args),
  markRecoveryCodeUsedAtomic: (...args: unknown[]) => mockMarkRecoveryCodeUsedAtomic(...args),
}));

// Mock de queryUserPermissions — usado pelo service para popular user.permissions
// no response do login/verify-2fa/refresh. Sem este mock o service tenta executar
// uma query Drizzle real (db.select().from().innerJoin()...) contra o mockDb e
// crasha em runtime → 500.
const mockQueryUserPermissions = vi.fn().mockResolvedValue([] as string[]);
vi.mock('../middlewares/user-context.repository.js', () => ({
  queryUserPermissions: (...args: unknown[]) => mockQueryUserPermissions(...args),
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
  totpConfirmedAt: null, // 2FA desativado por padrão
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

  it('retorna 200 com access_token e seta cookies quando credenciais corretas (sem 2FA)', async () => {
    mockFindUserByEmail.mockResolvedValue(makeUser());

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'agente@bdp.ro.gov.br', password: 'senha-correta-123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['status']).toBe('ok');
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
describe('POST /api/auth/login com 2FA ativo', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateTotpChallenge.mockResolvedValue(undefined);
  });

  it('retorna 2fa_required quando usuário tem 2FA ativo', async () => {
    mockFindUserByEmail.mockResolvedValue(makeUser({ totpConfirmedAt: new Date() }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'agente@bdp.ro.gov.br', password: 'senha-correta-123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['status']).toBe('2fa_required');
    expect(body).toHaveProperty('challenge_token');
    expect(typeof body['challenge_token']).toBe('string');
    // Não deve emitir access_token nem cookies de sessão
    expect(body).not.toHaveProperty('access_token');
    expect(mockCreateTotpChallenge).toHaveBeenCalledOnce();
  });

  it('não emite cookies de sessão quando 2FA é requerido', async () => {
    mockFindUserByEmail.mockResolvedValue(makeUser({ totpConfirmedAt: new Date() }));

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'agente@bdp.ro.gov.br', password: 'senha-correta-123' },
    });

    const setCookieHeader = res.headers['set-cookie'];
    // Não deve ter refresh_token nem csrf_token quando 2FA é requerido
    const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ''];
    const hasRefreshCookie = cookies.some(
      (c) => c.startsWith('refresh_token=') && !c.includes('Max-Age=0'),
    );
    expect(hasRefreshCookie).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/auth/verify-2fa', () => {
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
    // Gate atômico retorna true (consumido com sucesso) por padrão
    mockMarkTotpChallengeUsedAtomic.mockResolvedValue(true);
  });

  it('retorna 401 quando challenge token inválido', async () => {
    mockFindTotpChallengeByHash.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-2fa',
      payload: {
        challengeToken: 'token-invalido',
        code: '123456',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 400 quando body está vazio', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-2fa',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 401 quando código TOTP inválido', async () => {
    mockFindTotpChallengeByHash.mockResolvedValue({
      id: 'challenge-id',
      userId: FIXTURE_USER_ID,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      createdAt: new Date(),
    });
    // Usuário com 2FA ativo mas totp_secret que não baterá com código 000000
    const { encryptPii } = await import('../../../lib/crypto/pii.js');
    const { generateTotpSecret } = await import('../../../lib/totp.js');
    const secret = generateTotpSecret();
    const encrypted = Buffer.from(await encryptPii(secret));
    mockFindUserById.mockResolvedValue(
      makeUser({ totpSecret: encrypted, totpConfirmedAt: new Date() }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-2fa',
      payload: {
        challengeToken: crypto.randomUUID(),
        code: '000000',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 quando challenge já foi consumido (gate CAS retorna false — replay/race)', async () => {
    mockFindTotpChallengeByHash.mockResolvedValue({
      id: 'challenge-id',
      userId: FIXTURE_USER_ID,
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60000),
      usedAt: null,
      createdAt: new Date(),
    });
    const { encryptPii } = await import('../../../lib/crypto/pii.js');
    const { generateTotpSecret, verifyTotpCode, generateOtpauthUri } = await import(
      '../../../lib/totp.js'
    );
    const secret = generateTotpSecret();
    const encrypted = Buffer.from(await encryptPii(secret));
    mockFindUserById.mockResolvedValue(
      makeUser({ totpSecret: encrypted, totpConfirmedAt: new Date() }),
    );

    // Simular o gate CAS retornando false — challenge já consumido por outra requisição
    mockMarkTotpChallengeUsedAtomic.mockResolvedValueOnce(false);

    // Gerar um código TOTP válido para o secret atual
    const { TOTP } = await import('otpauth');
    const totp = new TOTP({ secret, digits: 6, period: 30 });
    const validCode = totp.generate();
    // Confirma que o código é válido (o erro deve vir do gate, não do código)
    expect(verifyTotpCode(secret, validCode)).toBe(true);
    void generateOtpauthUri; // evitar lint de unused

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/verify-2fa',
      payload: {
        challengeToken: crypto.randomUUID(),
        code: validCode,
      },
    });

    // Deve rejeitar com 401 mesmo com código correto — o challenge foi consumido
    expect(res.statusCode).toBe(401);
    expect(mockMarkTotpChallengeUsedAtomic).toHaveBeenCalledOnce();
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
    // Disparar 5 tentativas em paralelo (rate-limit conta por IP, ordem irrelevante).
    // Promise.all garante que todas as 5 requisições são lançadas antes de qualquer
    // uma terminar — elimina a janela de tempo em que o contador poderia expirar
    // entre iterações sequenciais num ambiente CI lento.
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: `user${i}@test.com`, password: 'wrong' },
        }),
      ),
    );

    // A 6ª tentativa deve retornar 429
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user6@test.com', password: 'wrong' },
    });

    expect(res.statusCode).toBe(429);
  }, 15000);
});
