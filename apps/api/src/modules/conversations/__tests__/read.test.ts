// =============================================================================
// conversations/__tests__/read.test.ts — Testes de integração (F16-S12).
//
// Estratégia: sobe Fastify com conversationsRoutes, mocka authenticate/authorize
// e service. Sem acesso real ao banco.
//
// Cobre (DoD F16-S12):
//   1. GET /api/conversations — lista com status default (open), escopo de cidade
//   2. GET /api/conversations — cursor de paginação corretamente gerado
//   3. GET /api/conversations — RBAC negativo (sem livechat:conversation:read → 403)
//   4. GET /api/conversations/:id — detalhe com composerState incluído
//   5. GET /api/conversations/:id — 404 se conversa fora do escopo / não existe
//   6. GET /api/conversations/:id — contactPhone presente com permissão crm:contact:phone:read
//   7. GET /api/conversations/:id — contactPhone ausente sem permissão crm:contact:phone:read
//   8. GET /api/conversations/:id/messages — lista mensagens + marca como lido
//   9. GET /api/conversations/:id/messages — cursor de paginação regressiva
//  10. GET /api/conversations/:id/messages — 404 se conversa não existe
//  11. GET /api/conversations/:id/window — estado da janela de composição
//  12. Querystring inválida → 400
// =============================================================================

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { conversationsRoutes } from '../routes.js';

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
    // no-op: request.user injetado via addHook no buildTestApp
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
// Mocks das funções de serviço
// ---------------------------------------------------------------------------
const mockListConversationsService = vi.fn();
const mockGetConversationDetailService = vi.fn();
const mockGetMessagesService = vi.fn();
const mockGetWindowService = vi.fn();
const mockCountConversationsService = vi.fn();

vi.mock('../service.js', () => ({
  listConversationsService: (...args: unknown[]) => mockListConversationsService(...args),
  getConversationDetailService: (...args: unknown[]) => mockGetConversationDetailService(...args),
  getMessagesService: (...args: unknown[]) => mockGetMessagesService(...args),
  getWindowService: (...args: unknown[]) => mockGetWindowService(...args),
  countConversationsService: (...args: unknown[]) => mockCountConversationsService(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONV_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CONV_ID_2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const MSG_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const MSG_ID_2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const CHANNEL_ID = 'cccccccc-0000-0000-0000-000000000001';
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001';
const USER_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const CITY_ID = 'ffffffff-0000-0000-0000-000000000001';

const NOW = '2026-06-16T10:00:00.000Z';
const OLDER = '2026-06-15T08:00:00.000Z';

const SAMPLE_CONVERSATION = {
  id: CONV_ID,
  organizationId: ORG_ID,
  cityId: CITY_ID,
  channelId: CHANNEL_ID,
  contactRemoteId: '5521999990001',
  contactName: 'Maria Silva',
  leadId: null,
  customerId: null,
  status: 'open' as const,
  assignedUserId: null,
  lastInboundAt: NOW,
  lastMessageAt: NOW,
  kind: 'dm' as const,
  // `provider` é obrigatório em ConversationSchema (vem do INNER JOIN com channels).
  // Adicionado ao fixture para evitar erro de serialização Zod (500 → 200 correto).
  provider: 'meta_whatsapp' as const,
  unreadCount: 2,
  createdAt: OLDER,
  updatedAt: NOW,
};

const SAMPLE_CONVERSATION_DETAIL = {
  ...SAMPLE_CONVERSATION,
  contactPhone: null,
};

const SAMPLE_COMPOSER_STATE = {
  conversationId: CONV_ID,
  provider: 'meta_whatsapp' as const,
  window: 'open' as const,
  lastInboundAt: NOW,
  remainingMs: 82_800_000,
};

const SAMPLE_MESSAGE = {
  id: MSG_ID,
  conversationId: CONV_ID,
  channelId: CHANNEL_ID,
  direction: 'in' as const,
  externalId: 'wamid.xxx',
  type: 'text' as const,
  content: 'Olá, preciso de ajuda',
  mediaUrl: null,
  mediaMime: null,
  mediaSizeBytes: null,
  mediaSha256: null,
  interactivePayload: null,
  viewStatus: 'read' as const,
  metadata: {},
  createdAt: NOW,
  updatedAt: NOW,
};

const PERMISSIONS_READ = ['livechat:conversation:read'];
const PERMISSIONS_WITH_PHONE = ['livechat:conversation:read', 'crm:contact:phone:read'];

// ---------------------------------------------------------------------------
// App factory de teste
// ---------------------------------------------------------------------------

function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _req, reply) => {
    if (error !== null && typeof error === 'object' && 'statusCode' in error && 'code' in error) {
      const appErr = error as { statusCode: number; code: string; message: string };
      return reply.status(appErr.statusCode).send({
        error: appErr.code,
        message: appErr.message,
      });
    }
    if (error !== null && typeof error === 'object' && 'validation' in error) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Validation failed' });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });
}

async function buildTestApp(
  permissions: string[] = PERMISSIONS_READ,
  cityScopeIds: string[] | null = [CITY_ID],
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  // Injeta request.user antes de qualquer hook de rota
  app.addHook('preHandler', async (request) => {
    request.user = {
      id: USER_ID,
      organizationId: ORG_ID,
      permissions,
      cityScopeIds,
    };
  });

  await app.register(conversationsRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/conversations — lista conversas', () => {
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

  it('200 — retorna lista de conversas com default status=open', async () => {
    const listResult = {
      data: [SAMPLE_CONVERSATION],
      nextCursor: null,
    };
    mockListConversationsService.mockResolvedValueOnce(listResult);

    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[]; nextCursor: unknown };
    expect(body.data).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    // Verifica que o service recebeu escopo correto
    expect(mockListConversationsService).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: ORG_ID, cityScopeIds: [CITY_ID] }),
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('200 — cursor de paginação retornado quando há mais páginas', async () => {
    const conversations = Array.from({ length: 50 }, (_, i) => ({
      ...SAMPLE_CONVERSATION,
      id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, '0')}`,
    }));
    const lastId = conversations[49]?.id ?? CONV_ID;

    mockListConversationsService.mockResolvedValueOnce({
      data: conversations,
      nextCursor: lastId,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations?limit=50',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { nextCursor: string | null };
    expect(body.nextCursor).toBe(lastId);
  });

  it('200 — filtros status e channelId passados ao service', async () => {
    mockListConversationsService.mockResolvedValueOnce({ data: [], nextCursor: null });

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations?status=resolved&channelId=${CHANNEL_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(mockListConversationsService).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ status: 'resolved', channelId: CHANNEL_ID }),
    );
  });

  it('400 — limit inválido (> 100)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations?limit=999',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/conversations — RBAC', () => {
  it('403 — sem permissão livechat:conversation:read', async () => {
    const appNoPerms = await buildTestApp([]);

    const response = await appNoPerms.inject({
      method: 'GET',
      url: '/api/conversations',
    });

    expect(response.statusCode).toBe(403);
    await appNoPerms.close();
  });
});

describe('GET /api/conversations/:id — detalhe', () => {
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

  it('200 — detalhe com composerState incluído', async () => {
    mockGetConversationDetailService.mockResolvedValueOnce({
      data: SAMPLE_CONVERSATION_DETAIL,
      composerState: SAMPLE_COMPOSER_STATE,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown; composerState: unknown };
    expect(body.data).toBeDefined();
    expect(body.composerState).toBeDefined();
    expect((body.composerState as { conversationId: string }).conversationId).toBe(CONV_ID);
  });

  it('200 — contactPhone null sem permissão crm:contact:phone:read', async () => {
    mockGetConversationDetailService.mockResolvedValueOnce({
      data: { ...SAMPLE_CONVERSATION_DETAIL, contactPhone: null },
      composerState: SAMPLE_COMPOSER_STATE,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { contactPhone: unknown } };
    expect(body.data.contactPhone).toBeNull();

    // Verifica que hasPhonePermission=false foi passado (RBAC sem phone permission)
    expect(mockGetConversationDetailService).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: ORG_ID }),
      CONV_ID,
      false, // hasPhonePermission
    );
  });

  it('200 — contactPhone decifrado com permissão crm:contact:phone:read', async () => {
    const appWithPhone = await buildTestApp(PERMISSIONS_WITH_PHONE);
    mockGetConversationDetailService.mockResolvedValueOnce({
      data: { ...SAMPLE_CONVERSATION_DETAIL, contactPhone: '+5521999990001' },
      composerState: SAMPLE_COMPOSER_STATE,
    });

    const response = await appWithPhone.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: { contactPhone: string | null } };
    expect(body.data.contactPhone).toBe('+5521999990001');

    // Verifica que hasPhonePermission=true foi passado
    expect(mockGetConversationDetailService).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: ORG_ID }),
      CONV_ID,
      true, // hasPhonePermission
    );

    await appWithPhone.close();
  });

  it('404 — conversa não existe ou fora do escopo', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetConversationDetailService.mockRejectedValueOnce(
      new NotFoundError('Conversation not found'),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID_2}`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('403 — sem permissão livechat:conversation:read', async () => {
    const appNoPerms = await buildTestApp([]);

    const response = await appNoPerms.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}`,
    });

    expect(response.statusCode).toBe(403);
    await appNoPerms.close();
  });
});

describe('GET /api/conversations/:id/messages — histórico', () => {
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

  it('200 — lista mensagens e marca como lido (nextCursor null)', async () => {
    mockGetMessagesService.mockResolvedValueOnce({
      data: [SAMPLE_MESSAGE],
      nextCursor: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}/messages`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[]; nextCursor: unknown };
    expect(body.data).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    expect(mockGetMessagesService).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: ORG_ID }),
      CONV_ID,
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('200 — cursor de paginação regressiva corretamente retornado', async () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({
      ...SAMPLE_MESSAGE,
      id: `bbbbbbbb-0000-0000-0000-${String(i).padStart(12, '0')}`,
    }));
    const firstId = msgs[0]?.id ?? MSG_ID;

    mockGetMessagesService.mockResolvedValueOnce({
      data: msgs,
      nextCursor: firstId,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}/messages?limit=50`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { nextCursor: string | null };
    expect(body.nextCursor).toBe(firstId);
  });

  it('200 — `before` cursor passado ao service', async () => {
    mockGetMessagesService.mockResolvedValueOnce({ data: [], nextCursor: null });

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}/messages?before=${MSG_ID_2}`,
    });

    expect(response.statusCode).toBe(200);
    expect(mockGetMessagesService).toHaveBeenCalledWith(
      {},
      expect.anything(),
      CONV_ID,
      expect.objectContaining({ before: MSG_ID_2 }),
    );
  });

  it('404 — conversa não existe ou fora do escopo', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetMessagesService.mockRejectedValueOnce(new NotFoundError('Conversation not found'));

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID_2}/messages`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('403 — sem permissão livechat:conversation:read', async () => {
    const appNoPerms = await buildTestApp([]);

    const response = await appNoPerms.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}/messages`,
    });

    expect(response.statusCode).toBe(403);
    await appNoPerms.close();
  });
});

describe('GET /api/conversations/:id/window — estado da janela', () => {
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

  it('200 — retorna estado da janela de composição', async () => {
    mockGetWindowService.mockResolvedValueOnce(SAMPLE_COMPOSER_STATE);

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}/window`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      conversationId: string;
      provider: string;
      window: string;
    };
    expect(body.conversationId).toBe(CONV_ID);
    expect(body.provider).toBe('meta_whatsapp');
    expect(body.window).toBe('open');
  });

  it('200 — janela template_only para conversa WA > 24h', async () => {
    mockGetWindowService.mockResolvedValueOnce({
      ...SAMPLE_COMPOSER_STATE,
      window: 'template_only',
      remainingMs: 0,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}/window`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { window: string };
    expect(body.window).toBe('template_only');
  });

  it('404 — conversa não existe ou fora do escopo', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetWindowService.mockRejectedValueOnce(new NotFoundError('Conversation not found'));

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID_2}/window`,
    });

    expect(response.statusCode).toBe(404);
  });

  it('403 — sem permissão livechat:conversation:read', async () => {
    const appNoPerms = await buildTestApp([]);

    const response = await appNoPerms.inject({
      method: 'GET',
      url: `/api/conversations/${CONV_ID}/window`,
    });

    expect(response.statusCode).toBe(403);
    await appNoPerms.close();
  });
});

// ---------------------------------------------------------------------------
// GET /api/conversations/counts — contagem por status
// ---------------------------------------------------------------------------

describe('GET /api/conversations/counts — contagem por status', () => {
  let app: FastifyInstance;

  const SAMPLE_COUNTS = {
    open: 12,
    pending: 3,
    resolved: 45,
    snoozed: 1,
    total: 61,
  };

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('200 — retorna contagem correta por status com total', async () => {
    mockCountConversationsService.mockResolvedValueOnce(SAMPLE_COUNTS);

    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations/counts',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as typeof SAMPLE_COUNTS;
    expect(body.open).toBe(12);
    expect(body.pending).toBe(3);
    expect(body.resolved).toBe(45);
    expect(body.snoozed).toBe(1);
    expect(body.total).toBe(61);
  });

  it('200 — retorna zeros para org sem conversas', async () => {
    mockCountConversationsService.mockResolvedValueOnce({
      open: 0,
      pending: 0,
      resolved: 0,
      snoozed: 0,
      total: 0,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations/counts',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as typeof SAMPLE_COUNTS;
    expect(body.total).toBe(0);
  });

  it('200 — repassa filtros channelId e assignedUserId ao service', async () => {
    mockCountConversationsService.mockResolvedValueOnce(SAMPLE_COUNTS);

    const response = await app.inject({
      method: 'GET',
      url: `/api/conversations/counts?channelId=${CHANNEL_ID}&assignedUserId=${USER_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(mockCountConversationsService).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: ORG_ID }),
      expect.objectContaining({ channelId: CHANNEL_ID, assignedUserId: USER_ID }),
    );
  });

  it('400 — channelId inválido (não é UUID)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations/counts?channelId=nao-e-uuid',
    });

    expect(response.statusCode).toBe(400);
  });

  it('403 — sem permissão livechat:conversation:read', async () => {
    const appNoPerms = await buildTestApp([]);

    const response = await appNoPerms.inject({
      method: 'GET',
      url: '/api/conversations/counts',
    });

    expect(response.statusCode).toBe(403);
    await appNoPerms.close();
  });

  it('/counts NÃO é casado como /:id — retorna 200 com forma correta', async () => {
    // Garante que "counts" não é tratado como conversationId pelo router.
    mockCountConversationsService.mockResolvedValueOnce(SAMPLE_COUNTS);

    const response = await app.inject({
      method: 'GET',
      url: '/api/conversations/counts',
    });

    // Se Fastify cometesse o erro de casar /counts como /:id, o service de
    // detalhe seria chamado e mockCountConversationsService não teria sido chamado.
    expect(response.statusCode).toBe(200);
    expect(mockCountConversationsService).toHaveBeenCalledTimes(1);
  });
});
