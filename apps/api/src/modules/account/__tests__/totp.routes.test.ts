// =============================================================================
// account/__tests__/totp.routes.test.ts — Testes de integração 2FA (F8-S11).
//
// Estratégia: sobe Fastify com accountRoutes, mocka authenticate e service
// para controlar contexto e dados.
//
// Testes cobertos:
//   1.  GET  /api/account/2fa/status          → 200 { enabled: false }
//   2.  GET  /api/account/2fa/status          → 200 { enabled: true }
//   3.  POST /api/account/2fa/enroll          → 200 retorna otpauthUri + secret
//   4.  POST /api/account/2fa/activate        → 200 retorna recoveryCodes
//   5.  POST /api/account/2fa/activate código errado → 401
//   6.  POST /api/account/2fa/activate código inválido (body) → 400
//   7.  POST /api/account/2fa/disable         → 204
//   8.  POST /api/account/2fa/disable código errado → 401
//   9.  POST /api/account/2fa/disable sem auth → não retorna 204
//   10. POST /api/account/2fa/activate sem enroll → 401 (sem secret pendente)
// =============================================================================
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppError } from '../../../shared/errors.js';
import { accountRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Mock pg
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
// Mock authenticate
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo hook global no buildTestApp
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockGetProfile = vi.fn();
const mockUpdateProfile = vi.fn();
const mockChangePassword = vi.fn();
const mockGet2faStatus = vi.fn();
const mockEnroll2fa = vi.fn();
const mockActivate2fa = vi.fn();
const mockDisable2fa = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getProfile: (...args: unknown[]) => mockGetProfile(...args),
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
    changePassword: (...args: unknown[]) => mockChangePassword(...args),
    get2faStatus: (...args: unknown[]) => mockGet2faStatus(...args),
    enroll2fa: (...args: unknown[]) => mockEnroll2fa(...args),
    activate2fa: (...args: unknown[]) => mockActivate2fa(...args),
    disable2fa: (...args: unknown[]) => mockDisable2fa(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

const FIXTURE_ENROLL_RESPONSE = {
  otpauthUri:
    'otpauth://totp/Elemento%20%E2%80%93%20Banco%20do%20Povo:agente%40bdp.ro.gov.br?secret=JBSWY3DPEHPK3PXP&issuer=Elemento%20%E2%80%93%20Banco%20do%20Povo',
  secret: 'JBSWY3DPEHPK3PXP',
};

const FIXTURE_RECOVERY_CODES = [
  'ABCDE-FGHJK',
  'LMNPQ-RSTUV',
  'WXYZ2-34567',
  'ABCDE-FGHJK',
  'LMNPQ-RSTUV',
  'WXYZ2-34567',
  'ABCDE-FGHJK',
  'LMNPQ-RSTUV',
  'WXYZ2-34567',
  'ABCDE-FGHJK',
];

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(injectUser = true): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (injectUser) {
    app.addHook('preHandler', async (request) => {
      request.user = {
        id: FIXTURE_USER_ID,
        organizationId: FIXTURE_ORG_ID,
        permissions: [],
        cityScopeIds: null,
      };
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
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
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(accountRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------

let app: FastifyInstance;
let appNoUser: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp(true);
  appNoUser = await buildTestApp(false);
}, 30000);

afterAll(async () => {
  await app.close();
  await appNoUser.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/account/2fa/status', () => {
  it('1. retorna enabled=false quando 2FA desativado', async () => {
    mockGet2faStatus.mockResolvedValueOnce({ enabled: false });

    const res = await app.inject({ method: 'GET', url: '/api/account/2fa/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
    expect(mockGet2faStatus).toHaveBeenCalledOnce();
    const [_db, actor] = mockGet2faStatus.mock.calls[0]!;
    expect(actor.userId).toBe(FIXTURE_USER_ID);
  });

  it('2. retorna enabled=true quando 2FA ativo', async () => {
    mockGet2faStatus.mockResolvedValueOnce({ enabled: true });

    const res = await app.inject({ method: 'GET', url: '/api/account/2fa/status' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true });
  });
});

describe('POST /api/account/2fa/enroll', () => {
  it('3. retorna otpauthUri e secret para QR code', async () => {
    mockEnroll2fa.mockResolvedValueOnce(FIXTURE_ENROLL_RESPONSE);

    const res = await app.inject({ method: 'POST', url: '/api/account/2fa/enroll' });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof FIXTURE_ENROLL_RESPONSE>();
    expect(body.otpauthUri).toContain('otpauth://totp/');
    expect(body.secret).toBe('JBSWY3DPEHPK3PXP');
    // Verificar que o userId correto é passado ao service
    const [_db, actor] = mockEnroll2fa.mock.calls[0]!;
    expect((actor as { userId: string }).userId).toBe(FIXTURE_USER_ID);
  });
});

describe('POST /api/account/2fa/activate', () => {
  it('4. ativa 2FA e retorna recovery codes com código válido', async () => {
    mockActivate2fa.mockResolvedValueOnce({ recoveryCodes: FIXTURE_RECOVERY_CODES });

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/activate',
      headers: { 'content-type': 'application/json' },
      payload: { code: '123456' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ recoveryCodes: string[] }>();
    expect(body.recoveryCodes).toHaveLength(10);
    expect(body.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  });

  it('5. código TOTP inválido → 401', async () => {
    const { UnauthorizedError } = await import('../../../shared/errors.js');
    mockActivate2fa.mockRejectedValueOnce(
      new UnauthorizedError(
        'Código inválido ou expirado. Verifique o código no seu app autenticador.',
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/activate',
      headers: { 'content-type': 'application/json' },
      payload: { code: '000000' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('6. código com formato inválido (não 6 dígitos) → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/activate',
      headers: { 'content-type': 'application/json' },
      payload: { code: 'abc' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('6b. body ausente → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/activate',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  it('10. sem enroll anterior (sem secret pendente) → 401', async () => {
    const { UnauthorizedError } = await import('../../../shared/errors.js');
    mockActivate2fa.mockRejectedValueOnce(
      new UnauthorizedError('Nenhum enrolamento pendente. Inicie o processo de ativação do 2FA.'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/activate',
      headers: { 'content-type': 'application/json' },
      payload: { code: '123456' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('POST /api/account/2fa/disable', () => {
  it('7. desativa 2FA com código TOTP válido → 204', async () => {
    mockDisable2fa.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/disable',
      headers: { 'content-type': 'application/json' },
      payload: { code: '123456' },
    });

    expect(res.statusCode).toBe(204);
    // Verificar que o userId correto é passado ao service
    const [_db, actor] = mockDisable2fa.mock.calls[0]!;
    expect((actor as { userId: string }).userId).toBe(FIXTURE_USER_ID);
  });

  it('7b. desativa 2FA com recovery code → 204', async () => {
    mockDisable2fa.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/disable',
      headers: { 'content-type': 'application/json' },
      payload: { code: 'ABCDE-FGHJK' },
    });

    expect(res.statusCode).toBe(204);
  });

  it('8. código inválido → 401', async () => {
    const { UnauthorizedError } = await import('../../../shared/errors.js');
    mockDisable2fa.mockRejectedValueOnce(
      new UnauthorizedError(
        'Código inválido. Informe o código do app autenticador ou um recovery code válido.',
      ),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/account/2fa/disable',
      headers: { 'content-type': 'application/json' },
      payload: { code: '999999' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('9. sem autenticação → não retorna 204', async () => {
    const res = await appNoUser.inject({
      method: 'POST',
      url: '/api/account/2fa/disable',
      headers: { 'content-type': 'application/json' },
      payload: { code: '123456' },
    });

    expect(res.statusCode).not.toBe(204);
    expect(mockDisable2fa).not.toHaveBeenCalled();
  });

  it('9b. escopo de self-service: service recebe userId do request.user', async () => {
    mockDisable2fa.mockResolvedValueOnce(undefined);

    await app.inject({
      method: 'POST',
      url: '/api/account/2fa/disable',
      headers: { 'content-type': 'application/json' },
      payload: {
        code: '123456',
        // Tentativa de escalonamento de privilégio — userId ignorado pelo schema
        userId: 'atacante-uuid',
      },
    });

    const [_db, actor] = mockDisable2fa.mock.calls[0]!;
    expect((actor as { userId: string }).userId).toBe(FIXTURE_USER_ID);
    expect((actor as { userId: string }).userId).not.toBe('atacante-uuid');
  });
});
