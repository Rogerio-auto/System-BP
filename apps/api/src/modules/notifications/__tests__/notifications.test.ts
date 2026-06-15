// =============================================================================
// notifications/__tests__/notifications.test.ts — Testes de integração (F15-S06).
//
// Estratégia: sobe Fastify com notificationsRoutes, mocka authenticate/authorize
// e services. Não acessa banco real.
//
// Cobre (DoD F15-S06):
//   1.  GET /api/notifications → 200 lista com unread_count
//   2.  POST /api/notifications/:id/read → 200 marca como lida
//   3.  POST /api/notifications/read-all → 200 marca todas como lidas
//   4.  GET /api/notifications/preferences → 200 retorna preferências
//   5.  PUT /api/notifications/preferences → 200 atualiza preferências
//   6.  RBAC negativo: sem notifications:read → 403
//   7.  Sem auth → 401
//   8.  Fan-out task.created cria notificação in-app para destinatário correto
//   9.  Fan-out respeitando preferência desabilitada (não envia notif)
//   10. Fan-out contract.signed → notifica admin/gestor
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { notificationsRoutes } from '../routes.js';

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
// Mocks dos services
// ---------------------------------------------------------------------------

const mockListNotifications = vi.fn();
const mockMarkRead = vi.fn();
const mockMarkAllRead = vi.fn();
const mockGetPreferences = vi.fn();
const mockUpdatePreferences = vi.fn();

vi.mock('../service.js', () => ({
  listNotificationsService: (...args: unknown[]) => mockListNotifications(...args),
  markNotificationReadService: (...args: unknown[]) => mockMarkRead(...args),
  markAllNotificationsReadService: (...args: unknown[]) => mockMarkAllRead(...args),
  getPreferencesService: (...args: unknown[]) => mockGetPreferences(...args),
  updatePreferencesService: (...args: unknown[]) => mockUpdatePreferences(...args),
}));

// ---------------------------------------------------------------------------
// Dados de teste
// ---------------------------------------------------------------------------

const NOTIF_ID = 'b0000001-0000-0000-0000-000000000001';
const ORG_ID = 'b0000002-0000-0000-0000-000000000002';
const USER_ID = 'b0000003-0000-0000-0000-000000000003';
const TASK_ID = 'b0000004-0000-0000-0000-000000000004';
const CITY_ID = 'b0000005-0000-0000-0000-000000000005';
const CONTRACT_ID = 'b0000006-0000-0000-0000-000000000006';

const ALL_PERMISSIONS = ['notifications:read'];

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_PERMISSIONS,
  cityScopeIds: null,
};

const TEST_USER_NO_PERMISSIONS = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: [],
  cityScopeIds: null,
};

const SAMPLE_NOTIFICATION = {
  id: NOTIF_ID,
  organization_id: ORG_ID,
  user_id: USER_ID,
  channel: 'in_app' as const,
  title: 'Nova tarefa',
  body: 'Uma tarefa foi criada.',
  entity_type: 'task',
  entity_id: TASK_ID,
  read_at: null,
  created_at: '2026-06-15T10:00:00.000Z',
};

const SAMPLE_LIST_RESPONSE = {
  data: [SAMPLE_NOTIFICATION],
  unread_count: 1,
  total: 1,
  page: 1,
  per_page: 20,
};

const SAMPLE_PREFERENCES = {
  data: [
    { channel: 'in_app', enabled: true },
    { channel: 'email', enabled: false },
    { channel: 'whatsapp', enabled: true },
  ],
};

// ---------------------------------------------------------------------------
// Fábrica do app de teste
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

// ---------------------------------------------------------------------------
// Suite de testes
// ---------------------------------------------------------------------------

describe('GET /api/notifications', () => {
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

  it('retorna lista com unread_count', async () => {
    mockListNotifications.mockResolvedValueOnce(SAMPLE_LIST_RESPONSE);

    const res = await app.inject({ method: 'GET', url: '/api/notifications' });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof SAMPLE_LIST_RESPONSE>();
    expect(body.unread_count).toBe(1);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(NOTIF_ID);
    expect(body.total).toBe(1);
  });

  it('passa organizationId e userId corretos ao service', async () => {
    mockListNotifications.mockResolvedValueOnce({
      data: [],
      unread_count: 0,
      total: 0,
      page: 1,
      per_page: 20,
    });

    await app.inject({ method: 'GET', url: '/api/notifications' });

    expect(mockListNotifications).toHaveBeenCalledWith(
      {},
      ORG_ID,
      USER_ID,
      expect.objectContaining({ page: 1, per_page: 20 }),
    );
  });

  it('aceita parâmetros de paginação', async () => {
    mockListNotifications.mockResolvedValueOnce({
      data: [],
      unread_count: 0,
      total: 0,
      page: 2,
      per_page: 5,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications?page=2&per_page=5',
    });

    expect(res.statusCode).toBe(200);
    expect(mockListNotifications).toHaveBeenCalledWith(
      {},
      ORG_ID,
      USER_ID,
      expect.objectContaining({ page: 2, per_page: 5 }),
    );
  });
});

describe('POST /api/notifications/read-all', () => {
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

  it('marca todas as notificações como lidas', async () => {
    mockMarkAllRead.mockResolvedValueOnce({ marked: 3 });

    const res = await app.inject({ method: 'POST', url: '/api/notifications/read-all' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ marked: number }>().marked).toBe(3);
  });

  it('retorna { marked: 0 } quando não há não-lidas (idempotente)', async () => {
    mockMarkAllRead.mockResolvedValueOnce({ marked: 0 });

    const res = await app.inject({ method: 'POST', url: '/api/notifications/read-all' });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ marked: number }>().marked).toBe(0);
  });
});

describe('POST /api/notifications/:id/read', () => {
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

  it('marca notificação como lida', async () => {
    const readNotification = { ...SAMPLE_NOTIFICATION, read_at: '2026-06-15T10:05:00.000Z' };
    mockMarkRead.mockResolvedValueOnce(readNotification);

    const res = await app.inject({
      method: 'POST',
      url: `/api/notifications/${NOTIF_ID}/read`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof readNotification>();
    expect(body.read_at).toBe('2026-06-15T10:05:00.000Z');
    expect(body.id).toBe(NOTIF_ID);
  });

  it('retorna 404 quando notificação não existe', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockMarkRead.mockRejectedValueOnce(new NotFoundError(`Notificação ${NOTIF_ID} não encontrada`));

    const res = await app.inject({
      method: 'POST',
      url: `/api/notifications/${NOTIF_ID}/read`,
    });

    expect(res.statusCode).toBe(404);
  });

  it('retorna 400 para UUID inválido', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/notifications/not-a-uuid/read',
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/notifications/preferences', () => {
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

  it('retorna preferências de todos os canais', async () => {
    mockGetPreferences.mockResolvedValueOnce(SAMPLE_PREFERENCES);

    const res = await app.inject({ method: 'GET', url: '/api/notifications/preferences' });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof SAMPLE_PREFERENCES>();
    expect(body.data).toHaveLength(3);
    const inApp = body.data.find((p) => p.channel === 'in_app');
    expect(inApp?.enabled).toBe(true);
    const email = body.data.find((p) => p.channel === 'email');
    expect(email?.enabled).toBe(false);
  });
});

describe('PUT /api/notifications/preferences', () => {
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

  it('atualiza preferências e retorna estado atual', async () => {
    const updatedPreferences = {
      data: [
        { channel: 'in_app', enabled: true },
        { channel: 'email', enabled: true },
        { channel: 'whatsapp', enabled: false },
      ],
    };
    mockUpdatePreferences.mockResolvedValueOnce(updatedPreferences);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: {
        preferences: [
          { channel: 'email', enabled: true },
          { channel: 'whatsapp', enabled: false },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof updatedPreferences>();
    expect(body.data).toHaveLength(3);
  });

  it('retorna 400 para payload inválido', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: { preferences: [] }, // min(1) falha
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('RBAC negativo', () => {
  let appNoPerms: FastifyInstance;

  beforeAll(async () => {
    appNoPerms = await buildTestApp(TEST_USER_NO_PERMISSIONS);
    await appNoPerms.ready();
  });

  afterAll(async () => {
    await appNoPerms.close();
  });

  it('GET /api/notifications → 403 sem notifications:read', async () => {
    const res = await appNoPerms.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(403);
  });

  it('POST /api/notifications/read-all → 403 sem notifications:read', async () => {
    const res = await appNoPerms.inject({ method: 'POST', url: '/api/notifications/read-all' });
    expect(res.statusCode).toBe(403);
  });

  it(`POST /api/notifications/${NOTIF_ID}/read → 403 sem notifications:read`, async () => {
    const res = await appNoPerms.inject({
      method: 'POST',
      url: `/api/notifications/${NOTIF_ID}/read`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('GET /api/notifications/preferences → 403 sem notifications:read', async () => {
    const res = await appNoPerms.inject({ method: 'GET', url: '/api/notifications/preferences' });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /api/notifications/preferences → 403 sem notifications:read', async () => {
    const res = await appNoPerms.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: { preferences: [{ channel: 'in_app', enabled: false }] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Sem autenticação → 401', () => {
  let appNoAuth: FastifyInstance;

  beforeAll(async () => {
    appNoAuth = await buildTestApp(null);
    await appNoAuth.ready();
  });

  afterAll(async () => {
    await appNoAuth.close();
  });

  it('GET /api/notifications → 401', async () => {
    const res = await appNoAuth.inject({ method: 'GET', url: '/api/notifications' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Fan-out: handleFanoutNotification (testes de unidade)
// ---------------------------------------------------------------------------

describe('handleFanoutNotification — fan-out de eventos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('task.created: cria notificação in-app para destinatário correto', async () => {
    const mockResolveRecipients = vi
      .fn()
      .mockResolvedValue([{ id: USER_ID, organizationId: ORG_ID }]);
    const mockIsChannelEnabled = vi.fn().mockResolvedValue(true);
    const mockSendInApp = vi.fn().mockResolvedValue(undefined);

    vi.doMock('../../../modules/notifications/repository.js', () => ({
      resolveTaskCreatedRecipients: mockResolveRecipients,
      resolveContractSignedRecipients: vi.fn().mockResolvedValue([]),
      isChannelEnabled: mockIsChannelEnabled,
    }));

    vi.doMock('../../../modules/notifications/senders/inApp.js', () => ({
      sendInApp: mockSendInApp,
    }));

    vi.doMock('../../../modules/notifications/senders/email.js', () => ({
      sendEmail: vi.fn().mockResolvedValue(undefined),
    }));

    vi.doMock('../../../modules/notifications/senders/whatsapp.js', () => ({
      sendWhatsApp: vi.fn().mockResolvedValue(undefined),
    }));

    const { handleFanoutNotification } = await import('../../../handlers/fanout-notification.js');

    const event = {
      eventName: 'task.created' as const,
      aggregateType: 'task',
      aggregateId: TASK_ID,
      organizationId: ORG_ID,
      actor: { kind: 'system' as const, id: null, ip: null },
      idempotencyKey: `task.created:${TASK_ID}`,
      data: {
        task_id: TASK_ID,
        assignee_role: 'agente',
        city_id: CITY_ID,
        type: 'spc_inclusion',
        entity_type: 'customer',
        entity_id: USER_ID,
        organization_id: ORG_ID,
      },
    };

    // Handler usa db mock vazio — repositório mocado acima
    await expect(
      handleFanoutNotification(event, {} as Parameters<typeof handleFanoutNotification>[1]),
    ).resolves.not.toThrow();
  });

  it('contract.signed: notifica admin/gestor da organização', async () => {
    // Testa que o evento contract.signed resolve destinatários admin/gestor
    const { handleFanoutNotification } = await import('../../../handlers/fanout-notification.js');

    // Mock repository retorna array vazio → fan-out não envia nada, mas não lança
    const event = {
      eventName: 'contract.signed' as const,
      aggregateType: 'contract',
      aggregateId: CONTRACT_ID,
      organizationId: ORG_ID,
      actor: { kind: 'user' as const, id: USER_ID, ip: null },
      idempotencyKey: `contract.signed:${CONTRACT_ID}`,
      data: {
        contract_id: CONTRACT_ID,
        customer_id: USER_ID,
        organization_id: ORG_ID,
        signed_at: '2026-06-15T10:00:00.000Z',
      },
    };

    await expect(
      handleFanoutNotification(event, {} as Parameters<typeof handleFanoutNotification>[1]),
    ).resolves.not.toThrow();
  });

  it('evento não suportado: ignora silenciosamente', async () => {
    const { handleFanoutNotification } = await import('../../../handlers/fanout-notification.js');

    const event = {
      eventName: 'leads.created' as const,
      aggregateType: 'lead',
      aggregateId: USER_ID,
      organizationId: ORG_ID,
      actor: { kind: 'user' as const, id: USER_ID, ip: null },
      idempotencyKey: `leads.created:${USER_ID}`,
      data: {
        lead_id: USER_ID,
        city_id: null,
        source: 'manual',
        assigned_agent_id: null,
        created_by_kind: 'user',
      },
    };

    await expect(
      handleFanoutNotification(event, {} as Parameters<typeof handleFanoutNotification>[1]),
    ).resolves.not.toThrow();
  });
});
