// =============================================================================
// channels/__tests__/channels.test.ts — Testes de integração (F16-S11).
//
// Estratégia: sobe Fastify com channelsRoutes, mocka authenticate/authorize,
// graphClient e service. Sem acesso real ao banco.
//
// Cobre (DoD F16-S11):
//   1. POST /api/channels/connect → 201 canal criado (meta_whatsapp)
//   2. POST /api/channels/connect → 422 credencial inválida (meta_whatsapp)
//   3. POST /api/channels/connect → 409 duplicata (mesmo phoneNumberId)
//   4. GET  /api/channels         → 200 lista filtrada por organização
//   5. GET  /api/channels?status=active → 200 filtrando por status
//   6. DELETE /api/channels/:id   → 204 soft-delete
//   7. RBAC negativo: sem channel.connect → 403
//   8. POST body inválido (sem provider) → 400
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { channelsRoutes } from '../routes.js';

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
// Mock authenticate/authorize
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook global no buildTestApp
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

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockConnectChannelService = vi.fn();
const mockListChannelsService = vi.fn();
const mockDeleteChannelService = vi.fn();

vi.mock('../service.js', () => ({
  connectChannelService: (...args: unknown[]) => mockConnectChannelService(...args),
  listChannelsService: (...args: unknown[]) => mockListChannelsService(...args),
  deleteChannelService: (...args: unknown[]) => mockDeleteChannelService(...args),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CHANNEL_ID = 'd0000001-0000-0000-0000-000000000001';
const ORG_ID = 'd0000002-0000-0000-0000-000000000002';
const USER_ID = 'd0000003-0000-0000-0000-000000000003';
const CITY_ID = 'd0000004-0000-0000-0000-000000000004';

const ALL_PERMISSIONS = ['channel.connect'];

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_PERMISSIONS,
  cityScopeIds: [CITY_ID] as string[] | null,
};

const NOW = '2026-06-15T10:00:00.000Z';

const SAMPLE_CHANNEL_RESPONSE = {
  id: CHANNEL_ID,
  organization_id: ORG_ID,
  city_id: CITY_ID,
  provider: 'meta_whatsapp' as const,
  name: 'WhatsApp Banco do Povo',
  display_handle: 'WhatsApp Banco do Povo',
  phone_number_id: '100123456789',
  waba_id: '200987654321',
  ig_user_id: null,
  ig_username: null,
  is_active: true,
  is_default: false,
  created_at: NOW,
  updated_at: NOW,
};

const VALID_CONNECT_BODY = {
  provider: 'meta_whatsapp',
  name: 'WhatsApp Banco do Povo',
  phoneNumber: '+5569999999999',
  accessToken: 'EAAxxxxxxxx',
  appSecret: 'abc123secret',
  phoneNumberId: '100123456789',
  wabaId: '200987654321',
  cityId: CITY_ID,
};

// ---------------------------------------------------------------------------
// App factory de teste
// ---------------------------------------------------------------------------

type TestUser = typeof TEST_USER;

function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _req, reply) => {
    if (error !== null && typeof error === 'object' && 'statusCode' in error && 'code' in error) {
      const appErr = error as { statusCode: number; code: string; message: string };
      return reply.status(appErr.statusCode).send({
        error: appErr.code,
        message: appErr.message,
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });
}

async function buildTestApp(
  user: TestUser | null = TEST_USER,
  withErrorHandler = false,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  if (withErrorHandler) {
    registerErrorHandler(typedApp);
  }

  if (user !== null) {
    typedApp.addHook('preHandler', async (request) => {
      // `as` justificado: injeção de test fixture sem passar por autenticação real
      (request as unknown as { user: TestUser }).user = user;
    });
  }

  await typedApp.register(channelsRoutes);
  await typedApp.ready();
  return typedApp;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('Channels Module — F16-S11', () => {
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

  // ---- POST /api/channels/connect -----------------------------------------

  describe('POST /api/channels/connect', () => {
    it('1. cria canal meta_whatsapp com sucesso (201)', async () => {
      mockConnectChannelService.mockResolvedValue(SAMPLE_CHANNEL_RESPONSE);

      const res = await app.inject({
        method: 'POST',
        url: '/api/channels/connect',
        payload: VALID_CONNECT_BODY,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<typeof SAMPLE_CHANNEL_RESPONSE>();
      expect(body.id).toBe(CHANNEL_ID);
      expect(body.provider).toBe('meta_whatsapp');
      expect(body.phone_number_id).toBe('100123456789');
      // LGPD: phoneNumber não deve estar na resposta
      expect(body).not.toHaveProperty('phoneNumber');
      expect(body).not.toHaveProperty('access_token');
      expect(body).not.toHaveProperty('app_secret');
      expect(mockConnectChannelService).toHaveBeenCalledOnce();
    });

    it('2. credencial inválida → 422 INVALID_CREDENTIAL', async () => {
      const { AppError } = await import('../../../shared/errors.js');
      mockConnectChannelService.mockRejectedValue(
        new AppError(422, 'VALIDATION_ERROR', 'Credencial inválida ou sem permissão no provider', {
          code: 'INVALID_CREDENTIAL',
        }),
      );

      const appWithErrorHandler = await buildTestApp(TEST_USER, true);

      const res = await appWithErrorHandler.inject({
        method: 'POST',
        url: '/api/channels/connect',
        payload: VALID_CONNECT_BODY,
      });

      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: string; message: string }>();
      expect(body.error).toBe('VALIDATION_ERROR');

      await appWithErrorHandler.close();
    });

    it('3. duplicata (mesmo phoneNumberId) → 409 CONFLICT', async () => {
      const { AppError } = await import('../../../shared/errors.js');
      mockConnectChannelService.mockRejectedValue(
        new AppError(
          409,
          'CONFLICT',
          'Canal meta_whatsapp com este identificador já está cadastrado',
          { code: 'CHANNEL_DUPLICATE' },
        ),
      );

      const appWithErrorHandler = await buildTestApp(TEST_USER, true);

      const res = await appWithErrorHandler.inject({
        method: 'POST',
        url: '/api/channels/connect',
        payload: VALID_CONNECT_BODY,
      });

      expect(res.statusCode).toBe(409);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('CONFLICT');

      await appWithErrorHandler.close();
    });

    it('8. body inválido (sem provider) → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/channels/connect',
        payload: { name: 'Teste', accessToken: 'abc' }, // falta provider obrigatório
      });

      expect(res.statusCode).toBe(400);
      // Service nunca deve ser chamado — erro de validação Zod antes do handler
      expect(mockConnectChannelService).not.toHaveBeenCalled();
    });

    it('8b. body inválido (provider desconhecido) → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/channels/connect',
        payload: { provider: 'telegram', name: 'Teste', accessToken: 'abc' },
      });

      expect(res.statusCode).toBe(400);
      expect(mockConnectChannelService).not.toHaveBeenCalled();
    });

    it('7a. RBAC negativo: sem channel.connect → 403 (POST)', async () => {
      const noPermUser = { ...TEST_USER, permissions: ['some:other:permission'] };
      const appNoPerms = await buildTestApp(noPermUser);

      const res = await appNoPerms.inject({
        method: 'POST',
        url: '/api/channels/connect',
        payload: VALID_CONNECT_BODY,
      });

      expect(res.statusCode).toBe(403);
      await appNoPerms.close();
    });
  });

  // ---- GET /api/channels --------------------------------------------------

  describe('GET /api/channels', () => {
    it('4. retorna lista de canais da organização (200)', async () => {
      mockListChannelsService.mockResolvedValue({
        data: [SAMPLE_CHANNEL_RESPONSE],
      });

      const res = await app.inject({ method: 'GET', url: '/api/channels' });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: (typeof SAMPLE_CHANNEL_RESPONSE)[] }>();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe(CHANNEL_ID);
      expect(body.data[0]?.provider).toBe('meta_whatsapp');
      // LGPD: sem segredos na resposta
      expect(body.data[0]).not.toHaveProperty('access_token');
      expect(body.data[0]).not.toHaveProperty('app_secret');
      expect(mockListChannelsService).toHaveBeenCalledOnce();
      // Verifica que o city scope foi passado
      expect(mockListChannelsService).toHaveBeenCalledWith(
        expect.anything(), // db
        expect.objectContaining({ organizationId: ORG_ID, cityScopeIds: [CITY_ID] }),
        expect.objectContaining({}),
      );
    });

    it('5. filtra por status=active via query param', async () => {
      mockListChannelsService.mockResolvedValue({ data: [SAMPLE_CHANNEL_RESPONSE] });

      const res = await app.inject({ method: 'GET', url: '/api/channels?status=active' });

      expect(res.statusCode).toBe(200);
      expect(mockListChannelsService).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ status: 'active' }),
      );
    });

    it('status=invalid_value → 400', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/channels?status=deleted' });
      expect(res.statusCode).toBe(400);
    });

    it('7b. RBAC negativo: sem channel.connect → 403 (GET)', async () => {
      const noPermUser = { ...TEST_USER, permissions: [] as string[] };
      const appNoPerms = await buildTestApp(noPermUser);

      const res = await appNoPerms.inject({ method: 'GET', url: '/api/channels' });

      expect(res.statusCode).toBe(403);
      await appNoPerms.close();
    });
  });

  // ---- DELETE /api/channels/:id -------------------------------------------

  describe('DELETE /api/channels/:id', () => {
    it('6. soft-delete → 204', async () => {
      mockDeleteChannelService.mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: `/api/channels/${CHANNEL_ID}`,
      });

      expect(res.statusCode).toBe(204);
      expect(mockDeleteChannelService).toHaveBeenCalledOnce();
      expect(mockDeleteChannelService).toHaveBeenCalledWith(
        expect.anything(), // db
        expect.objectContaining({ organizationId: ORG_ID, userId: USER_ID }),
        CHANNEL_ID,
      );
    });

    it('canal não encontrado → 404', async () => {
      const { NotFoundError } = await import('../../../shared/errors.js');
      mockDeleteChannelService.mockRejectedValue(
        new NotFoundError('Canal não encontrado ou já removido'),
      );

      const appWithErr = await buildTestApp(TEST_USER, true);

      const res = await appWithErr.inject({
        method: 'DELETE',
        url: `/api/channels/${CHANNEL_ID}`,
      });

      expect(res.statusCode).toBe(404);
      await appWithErr.close();
    });

    it('7c. RBAC negativo: sem channel.connect → 403 (DELETE)', async () => {
      const noPermUser = { ...TEST_USER, permissions: [] as string[] };
      const appNoPerms = await buildTestApp(noPermUser);

      const res = await appNoPerms.inject({
        method: 'DELETE',
        url: `/api/channels/${CHANNEL_ID}`,
      });

      expect(res.statusCode).toBe(403);
      await appNoPerms.close();
    });

    it('UUID inválido no param → 400', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/channels/nao-e-uuid',
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
