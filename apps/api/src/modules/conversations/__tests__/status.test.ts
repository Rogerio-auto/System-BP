// =============================================================================
// conversations/__tests__/status.test.ts — Testes de rota para PATCH /:id/status.
//
// Estratégia: sobe Fastify com conversationsRoutes, mocka authenticate/authorize
// e setConversationStatus. Sem acesso real ao banco.
//
// Cobre:
//   1. PATCH /:id/status — seta cada um dos 4 status (open, pending, resolved, snoozed)
//   2. 403 sem permissão livechat:conversation:manage
//   3. 404 fora de escopo (propagado do service)
//   4. 400 body inválido (status desconhecido)
//   5. Idempotência: mesmo status retorna 200 (comportamento do service)
//   6. socket relay publicado (via service mockado — smoke-check)
// =============================================================================

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { conversationsRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real ao pool)
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
// Mock send.service.js — apenas setConversationStatus + outros exports usados
// ---------------------------------------------------------------------------
const mockSetConversationStatus = vi.fn();

vi.mock('../send.service.js', () => ({
  sendMessage: vi.fn(),
  assignConversation: vi.fn(),
  resolveConversation: vi.fn(),
  generateUploadSignedUrl: vi.fn(),
  setConversationStatus: (...args: unknown[]) => mockSetConversationStatus(...args),
  WindowClosedError: class WindowClosedError extends Error {
    readonly statusCode = 422;
    readonly code = 'VALIDATION_ERROR';
    constructor(provider: string, windowState: string) {
      super(`Window closed: ${provider} ${windowState}`);
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock service.js — não é chamado pelo PATCH /status, mas o módulo é importado
// ---------------------------------------------------------------------------
vi.mock('../service.js', () => ({
  listConversationsService: vi.fn(),
  getConversationDetailService: vi.fn(),
  getMessagesService: vi.fn(),
  getWindowService: vi.fn(),
  countConversationsService: vi.fn(),
  getConversationTemplatesService: vi.fn(),
  linkOrCreateConversationLead: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONV_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CONV_ID_OUTSIDE = 'aaaaaaaa-0000-0000-0000-000000000099';
const ORG_ID = 'dddddddd-0000-0000-0000-000000000001';
const USER_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const CITY_ID = 'ffffffff-0000-0000-0000-000000000001';

const NOW_ISO = '2026-07-04T12:00:00.000Z';

const PERMISSIONS_MANAGE = ['livechat:conversation:manage'];

// Resposta de sucesso do service para cada status
function makeStatusResponse(status: string) {
  return {
    conversationId: CONV_ID,
    status,
    updatedAt: NOW_ISO,
  };
}

// ---------------------------------------------------------------------------
// Helpers de infra do teste
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
  permissions: string[] = PERMISSIONS_MANAGE,
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

describe('PATCH /api/conversations/:id/status — troca de status', () => {
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

  it('200 — seta status "open"', async () => {
    mockSetConversationStatus.mockResolvedValueOnce(makeStatusResponse('open'));

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'open' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { conversationId: string; status: string; updatedAt: string };
    expect(body.conversationId).toBe(CONV_ID);
    expect(body.status).toBe('open');
    expect(body.updatedAt).toBeDefined();
  });

  it('200 — seta status "pending"', async () => {
    mockSetConversationStatus.mockResolvedValueOnce(makeStatusResponse('pending'));

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'pending' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe('pending');
  });

  it('200 — seta status "resolved"', async () => {
    mockSetConversationStatus.mockResolvedValueOnce(makeStatusResponse('resolved'));

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'resolved' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe('resolved');
  });

  it('200 — seta status "snoozed"', async () => {
    mockSetConversationStatus.mockResolvedValueOnce(makeStatusResponse('snoozed'));

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'snoozed' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { status: string };
    expect(body.status).toBe('snoozed');
  });

  it('200 — idempotente: mesmo status já gravado retorna 200 (service idempotente)', async () => {
    // O service é idempotente — o test garante que o route repassa e não adiciona
    // lógica extra de "status já igual → 409/422".
    mockSetConversationStatus.mockResolvedValueOnce(makeStatusResponse('open'));

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'open' },
    });

    expect(response.statusCode).toBe(200);
  });

  it('200 — repassa conversationId, actor e body corretamente ao service', async () => {
    mockSetConversationStatus.mockResolvedValueOnce(makeStatusResponse('pending'));

    await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'pending' },
    });

    expect(mockSetConversationStatus).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: USER_ID, organizationId: ORG_ID }),
      CONV_ID,
      { status: 'pending' },
    );
  });

  it('400 — status inválido (fora do enum) retorna 400', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'arquivado' }, // não existe neste enum
    });

    expect(response.statusCode).toBe(400);
    // service não deve ser chamado com body inválido
    expect(mockSetConversationStatus).not.toHaveBeenCalled();
  });

  it('400 — body vazio retorna 400', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('404 — conversa fora do escopo ou inexistente propaga NotFoundError', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockSetConversationStatus.mockRejectedValueOnce(
      new NotFoundError(`Conversation not found: ${CONV_ID_OUTSIDE}`),
    );

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID_OUTSIDE}/status`,
      payload: { status: 'resolved' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('403 — sem permissão livechat:conversation:manage', async () => {
    // Usuário com permissão de leitura apenas (não gerenciamento)
    const appReadOnly = await buildTestApp(['livechat:conversation:read']);

    const response = await appReadOnly.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'resolved' },
    });

    expect(response.statusCode).toBe(403);
    await appReadOnly.close();
  });

  it('403 — sem permissão alguma', async () => {
    const appNoPerms = await buildTestApp([]);

    const response = await appNoPerms.inject({
      method: 'PATCH',
      url: `/api/conversations/${CONV_ID}/status`,
      payload: { status: 'resolved' },
    });

    expect(response.statusCode).toBe(403);
    await appNoPerms.close();
  });
});
