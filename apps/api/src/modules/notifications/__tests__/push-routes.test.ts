// =============================================================================
// notifications/__tests__/push-routes.test.ts — Testes de rota dos endpoints
// de Web Push (F27-S06).
//
// Cobre (DoD F27-S06):
//   1. GET  /push/public-key: 200 com public_key (service resolve normalmente)
//   2. GET  /push/public-key: 200 com public_key=null (gate off — degradação graciosa)
//   3. GET  /push/public-key: 401 sem autenticação
//   4. POST /push/subscription: 200 com body válido, service chamado com actor+body
//   5. POST /push/subscription: 400 body inválido (endpoint não é URL)
//   6. POST /push/subscription: 403 quando service recusa (gate flag/env off)
//   7. POST /push/subscription: idempotente — reenviar o mesmo payload retorna 200
//   8. DELETE /push/subscription: 200 com querystring válida
//   9. DELETE /push/subscription: 400 sem querystring `endpoint`
//   10. DELETE /push/subscription: 403 quando service recusa (gate flag/env off)
//   11. RBAC: sem permissão notifications:read → 403 nas 3 rotas
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de infraestrutura
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

vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: user injetado via addHook no buildTestApp
  },
}));

vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) =>
    async (request: { user?: { permissions: string[] } }, _reply: unknown) => {
      const { ForbiddenError, UnauthorizedError } = await import('../../../shared/errors.js');
      if (!request.user) throw new UnauthorizedError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

vi.mock('../../../db/client.js', () => ({
  db: {},
}));

// ---------------------------------------------------------------------------
// Mocks dos services (rotas sob teste)
// ---------------------------------------------------------------------------

const mockGetPushPublicKey = vi.fn();
const mockSubscribePush = vi.fn();
const mockUnsubscribePush = vi.fn();

vi.mock('../service.js', () => ({
  listNotificationsService: vi.fn(),
  markNotificationReadService: vi.fn(),
  markAllNotificationsReadService: vi.fn(),
  getPreferencesService: vi.fn(),
  updatePreferencesService: vi.fn(),
  getPushPublicKeyService: (...args: unknown[]) => mockGetPushPublicKey(...args),
  subscribePushService: (...args: unknown[]) => mockSubscribePush(...args),
  unsubscribePushService: (...args: unknown[]) => mockUnsubscribePush(...args),
}));

// ---------------------------------------------------------------------------
// Importações dos módulos sob teste
// ---------------------------------------------------------------------------

import { notificationsRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const ORG_ID = 'f0000001-0000-0000-0000-000000000001';
const USER_ID = 'f0000002-0000-0000-0000-000000000002';
const VALID_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/test-device-endpoint';

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ['notifications:read'],
  cityScopeIds: null,
};

const VALID_SUBSCRIPTION_BODY = {
  endpoint: VALID_ENDPOINT,
  keys: { p256dh: 'p256dh-fake-key', auth: 'auth-fake-secret' },
  userAgent: 'Chrome/128 (Windows)',
};

// ---------------------------------------------------------------------------
// Helper: cria app de teste para rotas
// ---------------------------------------------------------------------------

async function buildTestApp(user: typeof TEST_USER | null = TEST_USER): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (user !== null) {
    app.addHook('preHandler', async (request) => {
      // `as` justificado: injeção controlada de contexto de usuário nos testes.
      (request as { user?: typeof TEST_USER }).user = user;
    });
  }

  app.setErrorHandler((error: unknown, _request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    const code = (error as { code?: string }).code ?? 'INTERNAL_ERROR';
    const message = (error as { message?: string }).message ?? 'Internal server error';
    return reply.status(status).send({ error: code, message });
  });

  await app.register(notificationsRoutes);
  return app;
}

// ===========================================================================
// GET /api/notifications/push/public-key
// ===========================================================================

describe('GET /api/notifications/push/public-key', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 com public_key quando disponível', async () => {
    mockGetPushPublicKey.mockResolvedValueOnce({ public_key: 'vapid-public-key-base64' });

    const res = await app.inject({ method: 'GET', url: '/api/notifications/push/public-key' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ public_key: 'vapid-public-key-base64' });
  });

  it('retorna 200 com public_key=null quando push indisponível (degradação graciosa)', async () => {
    mockGetPushPublicKey.mockResolvedValueOnce({ public_key: null });

    const res = await app.inject({ method: 'GET', url: '/api/notifications/push/public-key' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ public_key: null });
  });
});

describe('GET /api/notifications/push/public-key — sem autenticação', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp(null);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('retorna 401 quando request.user ausente', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications/push/public-key' });

    expect(res.statusCode).toBe(401);
  });
});

// ===========================================================================
// POST /api/notifications/push/subscription
// ===========================================================================

describe('POST /api/notifications/push/subscription', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 e chama o service com actor + body', async () => {
    mockSubscribePush.mockResolvedValueOnce({ subscribed: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/push/subscription',
      payload: VALID_SUBSCRIPTION_BODY,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ subscribed: true });
    expect(mockSubscribePush).toHaveBeenCalledOnce();

    const [, actorArg, bodyArg] = mockSubscribePush.mock.calls[0] as [
      unknown,
      { organizationId: string; userId: string },
      typeof VALID_SUBSCRIPTION_BODY,
    ];
    expect(actorArg.organizationId).toBe(ORG_ID);
    expect(actorArg.userId).toBe(USER_ID);
    expect(bodyArg).toEqual(VALID_SUBSCRIPTION_BODY);
  });

  it('retorna 400 quando endpoint não é uma URL válida', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/push/subscription',
      payload: { ...VALID_SUBSCRIPTION_BODY, endpoint: 'not-a-url' },
    });

    expect(res.statusCode).toBe(400);
    expect(mockSubscribePush).not.toHaveBeenCalled();
  });

  it('retorna 400 quando keys.p256dh está ausente', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/push/subscription',
      payload: { endpoint: VALID_ENDPOINT, keys: { auth: 'auth-only' } },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 403 quando o service recusa (gate flag/env off)', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockSubscribePush.mockRejectedValueOnce(new ForbiddenError('Web Push não está configurado'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/push/subscription',
      payload: VALID_SUBSCRIPTION_BODY,
    });

    expect(res.statusCode).toBe(403);
  });

  it('idempotente: reenviar o mesmo payload retorna 200 novamente', async () => {
    mockSubscribePush.mockResolvedValue({ subscribed: true });

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/notifications/push/subscription',
      payload: VALID_SUBSCRIPTION_BODY,
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/notifications/push/subscription',
      payload: VALID_SUBSCRIPTION_BODY,
    });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(mockSubscribePush).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// DELETE /api/notifications/push/subscription
// ===========================================================================

describe('DELETE /api/notifications/push/subscription', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 200 com querystring válida', async () => {
    mockUnsubscribePush.mockResolvedValueOnce({ unsubscribed: true });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/notifications/push/subscription?endpoint=${encodeURIComponent(VALID_ENDPOINT)}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ unsubscribed: true });
  });

  it('retorna 400 quando querystring `endpoint` está ausente', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/notifications/push/subscription',
    });

    expect(res.statusCode).toBe(400);
    expect(mockUnsubscribePush).not.toHaveBeenCalled();
  });

  it('retorna 403 quando o service recusa (gate flag/env off)', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockUnsubscribePush.mockRejectedValueOnce(new ForbiddenError('Web Push não está configurado'));

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/notifications/push/subscription?endpoint=${encodeURIComponent(VALID_ENDPOINT)}`,
    });

    expect(res.statusCode).toBe(403);
  });

  it('idempotente: remover 2x responde 200 nas duas chamadas', async () => {
    mockUnsubscribePush.mockResolvedValue({ unsubscribed: true });

    const url = `/api/notifications/push/subscription?endpoint=${encodeURIComponent(VALID_ENDPOINT)}`;
    const res1 = await app.inject({ method: 'DELETE', url });
    const res2 = await app.inject({ method: 'DELETE', url });

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
  });
});

// ===========================================================================
// RBAC — sem permissão notifications:read
// ===========================================================================

describe('RBAC — rotas de push sem permissão notifications:read', () => {
  let app: FastifyInstance;

  const USER_NO_PERMISSION = { ...TEST_USER, permissions: [] as string[] };

  beforeAll(async () => {
    app = await buildTestApp(USER_NO_PERMISSION);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /push/public-key → 403 sem permissão', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications/push/public-key' });
    expect(res.statusCode).toBe(403);
  });

  it('POST /push/subscription → 403 sem permissão', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/push/subscription',
      payload: VALID_SUBSCRIPTION_BODY,
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE /push/subscription → 403 sem permissão', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/notifications/push/subscription?endpoint=${encodeURIComponent(VALID_ENDPOINT)}`,
    });
    expect(res.statusCode).toBe(403);
  });
});
