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

import type { EventOutbox } from '../../../db/schema/events.js';
import { handleFanoutNotification } from '../../../handlers/fanout-notification.js';
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
// Mocks do fan-out (handleFanoutNotification — F24-S06)
//
// O handler chama requireFlag(db, ...) antes de tudo — sem stub, o db mock
// (que não implementa .select) faria `listAllFlags` estourar. Como os 3
// testes abaixo provam roteamento de fan-out por canal (não a feature flag
// em si), o mais fiel é stubar requireFlag no nível do módulo e cobrir o
// caminho flag-off separadamente (ver teste dedicado).
// ---------------------------------------------------------------------------

const mockRequireFlag = vi.fn();
vi.mock('../../../lib/featureFlags.js', () => ({
  requireFlag: (...args: unknown[]) => mockRequireFlag(...args),
}));

const mockResolveRuleRecipients = vi.fn();
vi.mock('../../notification-rules/recipients.js', () => ({
  resolveRuleRecipients: (...args: unknown[]) => mockResolveRuleRecipients(...args),
}));

const mockIsCategoryChannelEnabled = vi.fn();
vi.mock('../repository.js', () => ({
  isCategoryChannelEnabled: (...args: unknown[]) => mockIsCategoryChannelEnabled(...args),
}));

const mockSendInApp = vi.fn();
vi.mock('../senders/inApp.js', () => ({
  sendInApp: (...args: unknown[]) => mockSendInApp(...args),
}));

const mockSendEmail = vi.fn();
vi.mock('../senders/email.js', () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
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
  severity: 'info' as const,
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
// Fan-out: handleFanoutNotification (testes de unidade — F24-S06/F24-S20)
//
// F24-S06 reescreveu handleFanoutNotification para ser rules-driven:
//   requireFlag → busca notification_rules (db.select) → resolveRuleRecipients
//   → isCategoryChannelEnabled → dispatch por canal → recordDelivery (db.insert).
// O handler recebe uma ROW de event_outbox (EventOutbox), não um payload de
// emissão — daí os fixtures abaixo espelharem exatamente esse shape.
// ---------------------------------------------------------------------------

const OUTBOX_TASK_ID = 'b0000007-0000-0000-0000-000000000007';
const OUTBOX_CONTRACT_ID = 'b0000008-0000-0000-0000-000000000008';
const OUTBOX_LEAD_ID = 'b0000009-0000-0000-0000-000000000009';
const RULE_TASK_ID = 'b000000a-0000-0000-0000-00000000000a';
const RULE_CONTRACT_ID = 'b000000b-0000-0000-0000-00000000000b';
const LEAD_ID = 'b000000c-0000-0000-0000-00000000000c';

const TASK_CREATED_EVENT: EventOutbox = {
  id: OUTBOX_TASK_ID,
  organizationId: ORG_ID,
  eventName: 'task.created',
  eventVersion: 1,
  aggregateType: 'task',
  aggregateId: TASK_ID,
  payload: {
    event_id: OUTBOX_TASK_ID,
    occurred_at: '2026-06-15T10:00:00.000Z',
    actor: { kind: 'system', id: null, ip: null },
    correlation_id: null,
    data: {
      task_id: TASK_ID,
      assignee_role: 'agente',
      city_id: CITY_ID,
      type: 'spc_inclusion',
      entity_type: 'customer',
      entity_id: USER_ID,
      organization_id: ORG_ID,
    },
  },
  correlationId: null,
  idempotencyKey: `task.created:${TASK_ID}`,
  attempts: 0,
  lastError: null,
  processedAt: null,
  failedAt: null,
  createdAt: new Date('2026-06-15T10:00:00.000Z'),
};

const CONTRACT_SIGNED_EVENT: EventOutbox = {
  id: OUTBOX_CONTRACT_ID,
  organizationId: ORG_ID,
  eventName: 'contract.signed',
  eventVersion: 1,
  aggregateType: 'contract',
  aggregateId: CONTRACT_ID,
  payload: {
    event_id: OUTBOX_CONTRACT_ID,
    occurred_at: '2026-06-15T10:00:00.000Z',
    actor: { kind: 'user', id: USER_ID, ip: null },
    correlation_id: null,
    data: {
      contract_id: CONTRACT_ID,
      customer_id: USER_ID,
      organization_id: ORG_ID,
      signed_at: '2026-06-15T10:00:00.000Z',
    },
  },
  correlationId: null,
  idempotencyKey: `contract.signed:${CONTRACT_ID}`,
  attempts: 0,
  lastError: null,
  processedAt: null,
  failedAt: null,
  createdAt: new Date('2026-06-15T10:00:00.000Z'),
};

const LEADS_CREATED_EVENT: EventOutbox = {
  id: OUTBOX_LEAD_ID,
  organizationId: ORG_ID,
  eventName: 'leads.created',
  eventVersion: 1,
  aggregateType: 'lead',
  aggregateId: LEAD_ID,
  payload: {
    event_id: OUTBOX_LEAD_ID,
    occurred_at: '2026-06-15T10:00:00.000Z',
    actor: { kind: 'user', id: USER_ID, ip: null },
    correlation_id: null,
    data: {
      lead_id: LEAD_ID,
      city_id: null,
      source: 'manual',
      assigned_agent_id: null,
      created_by_kind: 'user',
    },
  },
  correlationId: null,
  idempotencyKey: `leads.created:${LEAD_ID}`,
  attempts: 0,
  lastError: null,
  processedAt: null,
  failedAt: null,
  createdAt: new Date('2026-06-15T10:00:00.000Z'),
};

const TASK_CREATED_RULE = {
  id: RULE_TASK_ID,
  organizationId: ORG_ID,
  name: 'Nova tarefa criada',
  triggerKind: 'event' as const,
  triggerKey: 'task.created',
  category: 'system',
  thresholdHours: null,
  filters: {},
  recipientMode: 'by_role_city' as const,
  recipientRoles: ['agente'],
  severity: 'info' as const,
  channels: ['in_app'],
  titleTemplate: 'Nova tarefa {{task_id}}',
  bodyTemplate: 'Tarefa {{type}} criada para {{entity_type}} {{entity_id}}.',
  cooldownHours: 0,
  enabled: true,
  createdBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const CONTRACT_SIGNED_RULE = {
  id: RULE_CONTRACT_ID,
  organizationId: ORG_ID,
  name: 'Contrato assinado',
  triggerKind: 'event' as const,
  triggerKey: 'contract.signed',
  category: 'system',
  thresholdHours: null,
  filters: {},
  recipientMode: 'managers' as const,
  recipientRoles: [] as string[],
  severity: 'info' as const,
  channels: ['in_app'],
  titleTemplate: 'Contrato {{contract_id}} assinado',
  bodyTemplate: 'Cliente {{customer_id}} assinou o contrato {{contract_id}}.',
  cooldownHours: 0,
  enabled: true,
  createdBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const TASK_RECIPIENT = {
  userId: USER_ID,
  organizationId: ORG_ID,
  displayName: 'Agente Teste',
  channels: ['in_app'] as ('in_app' | 'email')[],
};

const MANAGER_RECIPIENT = {
  userId: USER_ID,
  organizationId: ORG_ID,
  displayName: 'Gestor Teste',
  channels: ['in_app'] as ('in_app' | 'email')[],
};

// ---------------------------------------------------------------------------
// Helper: makeFanoutDb — mock de Database usado só pelo handler de fan-out.
// Espelha o padrão já validado em handlers/__tests__/fanout-notification.test.ts.
// ---------------------------------------------------------------------------

interface MakeFanoutDbOptions {
  rules?: Array<typeof TASK_CREATED_RULE | typeof CONTRACT_SIGNED_RULE>;
  hasDelivery?: boolean;
}

function makeFanoutDb(opts: MakeFanoutDbOptions = {}) {
  const rules = opts.rules ?? [];
  const deliveryRows = opts.hasDelivery === true ? [{ id: 'delivery-uuid' }] : [];

  const mockInsert = {
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
    }),
  };

  const mockSelectRules = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(rules),
    }),
  };

  const mockSelectDelivery = {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(deliveryRows),
      }),
    }),
  };

  let selectCallCount = 0;

  return {
    select: vi.fn().mockImplementation(() => {
      selectCallCount++;
      // 1ª chamada select() = busca de notification_rules.
      // 2ª+ chamadas select() = verificação de delivery (idempotência).
      if (selectCallCount === 1) return mockSelectRules;
      return mockSelectDelivery;
    }),
    insert: vi.fn().mockReturnValue(mockInsert),
    _mockInsert: mockInsert,
  };
}

describe('handleFanoutNotification — fan-out de eventos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireFlag.mockResolvedValue(true);
    mockResolveRuleRecipients.mockResolvedValue([]);
    mockIsCategoryChannelEnabled.mockResolvedValue(true);
    mockSendInApp.mockResolvedValue(undefined);
    mockSendEmail.mockResolvedValue(undefined);
  });

  it('feature flag notifications.rules.enabled off → no-op, sem consultar regras', async () => {
    mockRequireFlag.mockResolvedValue(false);
    const db = makeFanoutDb();

    // `as` justificado: mock parcial de Database — só implementa select/insert,
    // suficiente para o handler sob teste (mesmo padrão de fanout-notification.test.ts).
    await handleFanoutNotification(TASK_CREATED_EVENT, db as never);

    expect(mockRequireFlag).toHaveBeenCalledWith(
      db,
      'notifications.rules.enabled',
      expect.anything(),
    );
    expect(mockResolveRuleRecipients).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
  });

  it('task.created: cria notificação in-app para destinatário correto', async () => {
    mockResolveRuleRecipients.mockResolvedValue([TASK_RECIPIENT]);
    const db = makeFanoutDb({ rules: [TASK_CREATED_RULE], hasDelivery: false });

    // `as` justificado: mock parcial de Database — ver comentário acima.
    await handleFanoutNotification(TASK_CREATED_EVENT, db as never);

    expect(mockResolveRuleRecipients).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: ORG_ID,
        recipientMode: 'by_role_city',
        cityId: CITY_ID,
      }),
    );
    expect(mockSendInApp).toHaveBeenCalledTimes(1);
    expect(mockSendInApp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: USER_ID,
        entityType: 'task',
        entityId: TASK_ID,
      }),
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._mockInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        ruleId: RULE_TASK_ID,
        entityType: 'task',
        entityId: TASK_ID,
        bucket: OUTBOX_TASK_ID,
      }),
    );
  });

  it('contract.signed: notifica admin/gestor da organização', async () => {
    mockResolveRuleRecipients.mockResolvedValue([MANAGER_RECIPIENT]);
    const db = makeFanoutDb({ rules: [CONTRACT_SIGNED_RULE], hasDelivery: false });

    // `as` justificado: mock parcial de Database — ver comentário acima.
    await handleFanoutNotification(CONTRACT_SIGNED_EVENT, db as never);

    expect(mockResolveRuleRecipients).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ organizationId: ORG_ID, recipientMode: 'managers' }),
    );
    expect(mockSendInApp).toHaveBeenCalledTimes(1);
    expect(mockSendInApp).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: USER_ID,
        entityType: 'contract',
        entityId: CONTRACT_ID,
      }),
    );
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db._mockInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        ruleId: RULE_CONTRACT_ID,
        entityType: 'contract',
        entityId: CONTRACT_ID,
        bucket: OUTBOX_CONTRACT_ID,
      }),
    );
  });

  it('leads.created: nenhuma regra cadastrada para o evento → ignora silenciosamente', async () => {
    const db = makeFanoutDb({ rules: [] });

    // `as` justificado: mock parcial de Database — ver comentário acima.
    await expect(handleFanoutNotification(LEADS_CREATED_EVENT, db as never)).resolves.not.toThrow();

    expect(db.select).toHaveBeenCalledTimes(1);
    expect(mockResolveRuleRecipients).not.toHaveBeenCalled();
    expect(mockSendInApp).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
