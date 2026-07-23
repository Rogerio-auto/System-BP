// =============================================================================
// quick-replies/__tests__/routes.test.ts — Testes de integração HTTP (F28-S03).
//
// Estratégia: sobe Fastify com quickRepliesRoutes, mocka authenticate/
// authorize/authorizeAny e featureGate para controlar contexto, mocka
// service para controlar dados.
//
// Cobre:
//   1.  GET  /api/quick-replies → 200 lista paginada
//   2.  GET  /api/quick-replies/:id → 200 detalhe
//   3.  GET  /api/quick-replies/:id → 404 não encontrado
//   4.  POST /api/quick-replies → 201 criado
//   5.  PATCH /api/quick-replies/:id → 200 atualizado
//   6.  DELETE /api/quick-replies/:id → 204
//   7.  PATCH /api/quick-replies/reorder → 200 (rota não capturada por :id)
//   8.  Sem auth → 403
//   9.  Sem permissão de leitura → 403
//   10. POST sem write NEM manage (authorizeAny) → 403
//   11. POST com write apenas (sem manage) → chega ao service (piso da rota)
//   12. Reorder sem manage → 403
//   13. Feature flag desabilitada → 403 em list, create e reorder
//   14. POST /uploads/signed-url → 200; sem write → 403; flag off → 403 (F28-S04)
//   15. POST /:id/used → 204; sem read → 403; flag off → 403; 404 propagado (F28-S04)
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock authenticate
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook global no buildTestApp
  },
}));

// ---------------------------------------------------------------------------
// Mock authorize / authorizeAny
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) =>
    async (request: { user?: { permissions: string[] } }, _reply: unknown) => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      if (!request.user) throw new ForbiddenError('Não autenticado');
      const missing = opts.permissions.filter((p) => !request.user!.permissions.includes(p));
      if (missing.length > 0) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
  authorizeAny:
    (opts: { permissions: string[] }) =>
    async (request: { user?: { permissions: string[] } }, _reply: unknown) => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      if (!request.user) throw new ForbiddenError('Não autenticado');
      const hasAny = opts.permissions.some((p) => request.user!.permissions.includes(p));
      if (!hasAny) throw new ForbiddenError('Acesso negado: permissões insuficientes');
    },
}));

// ---------------------------------------------------------------------------
// Mock featureGate (controlável por teste)
// ---------------------------------------------------------------------------
const mockFeatureGateEnabled = vi.fn<() => boolean>().mockReturnValue(true);

vi.mock('../../../plugins/featureGate.js', () => ({
  featureGate: (_key: string) => async (_request: unknown, _reply: unknown) => {
    const { FeatureDisabledError } = await import('../../../shared/errors.js');
    if (!mockFeatureGateEnabled()) {
      throw new FeatureDisabledError('livechat.quick_replies.enabled');
    }
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
const mockListQuickRepliesService = vi.fn();
const mockGetQuickReplyService = vi.fn();
const mockCreateQuickReplyService = vi.fn();
const mockUpdateQuickReplyService = vi.fn();
const mockDeleteQuickReplyService = vi.fn();
const mockReorderQuickRepliesService = vi.fn();
const mockRequestQuickReplyUploadSignedUrlService = vi.fn();
const mockMarkQuickReplyUsedService = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listQuickRepliesService: (...args: unknown[]) => mockListQuickRepliesService(...args),
    getQuickReplyService: (...args: unknown[]) => mockGetQuickReplyService(...args),
    createQuickReplyService: (...args: unknown[]) => mockCreateQuickReplyService(...args),
    updateQuickReplyService: (...args: unknown[]) => mockUpdateQuickReplyService(...args),
    deleteQuickReplyService: (...args: unknown[]) => mockDeleteQuickReplyService(...args),
    reorderQuickRepliesService: (...args: unknown[]) => mockReorderQuickRepliesService(...args),
    requestQuickReplyUploadSignedUrlService: (...args: unknown[]) =>
      mockRequestQuickReplyUploadSignedUrlService(...args),
    markQuickReplyUsedService: (...args: unknown[]) => mockMarkQuickReplyUsedService(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_QUICK_REPLY_ID = 'cccccccc-0000-0000-0000-000000000001';

function makeQuickReplyResponse(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: FIXTURE_QUICK_REPLY_ID,
    organizationId: FIXTURE_ORG_ID,
    ownerUserId: null,
    visibility: 'organization',
    shortcut: 'saudacao',
    title: 'Saudação padrão',
    body: 'Olá! Como posso ajudar?',
    category: null,
    mediaUrl: null,
    mediaMime: null,
    mediaKind: null,
    mediaSizeBytes: null,
    mediaFileName: null,
    cityIds: [],
    isActive: true,
    sortOrder: 0,
    usageCount: 0,
    lastUsedAt: null,
    createdBy: FIXTURE_USER_ID,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

const CREATE_PAYLOAD = {
  visibility: 'organization',
  shortcut: 'saudacao',
  title: 'Saudação padrão',
  body: 'Olá {{atendente.primeiro_nome|equipe}}, tudo bem?',
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = [
    'livechat:quick_reply:read',
    'livechat:quick_reply:write',
    'livechat:quick_reply:manage',
  ],
  injectUser = true,
): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { quickRepliesRoutes },
    { isAppError },
  ] = await Promise.all([
    import('fastify'),
    import('fastify-type-provider-zod'),
    import('../routes.js'),
    import('../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (injectUser) {
    app.addHook('preHandler', async (request) => {
      request.user = {
        id: FIXTURE_USER_ID,
        organizationId: FIXTURE_ORG_ID,
        permissions,
        cityScopeIds: null,
      };
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = { error: error.code, message: error.message };
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

  await app.register(quickRepliesRoutes);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFeatureGateEnabled.mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// GET /api/quick-replies
// ---------------------------------------------------------------------------

describe('GET /api/quick-replies', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('1. retorna 200 com lista paginada', async () => {
    mockListQuickRepliesService.mockResolvedValueOnce({
      data: [makeQuickReplyResponse()],
      nextCursor: null,
    });

    const res = await app.inject({ method: 'GET', url: '/api/quick-replies' });

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(1);
  });

  it('9. sem permissão de leitura → 403', async () => {
    const restrictedApp = await buildTestApp([]);
    const res = await restrictedApp.inject({ method: 'GET', url: '/api/quick-replies' });
    expect(res.statusCode).toBe(403);
    await restrictedApp.close();
  });

  it('8. sem autenticação (request.user ausente) → 403', async () => {
    const noAuthApp = await buildTestApp([], false);
    const res = await noAuthApp.inject({ method: 'GET', url: '/api/quick-replies' });
    expect(res.statusCode).toBe(403);
    await noAuthApp.close();
  });

  it('13a. feature flag desabilitada → 403', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);
    const res = await app.inject({ method: 'GET', url: '/api/quick-replies' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FEATURE_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// GET /api/quick-replies/:id
// ---------------------------------------------------------------------------

describe('GET /api/quick-replies/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('2. retorna 200 com detalhe', async () => {
    mockGetQuickReplyService.mockResolvedValueOnce(makeQuickReplyResponse());
    const res = await app.inject({
      method: 'GET',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(FIXTURE_QUICK_REPLY_ID);
  });

  it('3. retorna 404 quando não encontrada/visível', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetQuickReplyService.mockRejectedValueOnce(
      new NotFoundError('Resposta rápida não encontrada'),
    );
    const res = await app.inject({
      method: 'GET',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}`,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/quick-replies
// ---------------------------------------------------------------------------

describe('POST /api/quick-replies', () => {
  it('4. retorna 201 quando criado com sucesso', async () => {
    const app = await buildTestApp();
    mockCreateQuickReplyService.mockResolvedValueOnce(makeQuickReplyResponse());

    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      payload: CREATE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    await app.close();
  });

  it('10. sem write NEM manage → 403 (piso de autorização da rota)', async () => {
    const app = await buildTestApp(['livechat:quick_reply:read']);
    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
    expect(mockCreateQuickReplyService).not.toHaveBeenCalled();
    await app.close();
  });

  it('11. com write apenas (sem manage) → passa do piso da rota (decisão fina é do service)', async () => {
    const app = await buildTestApp(['livechat:quick_reply:read', 'livechat:quick_reply:write']);
    mockCreateQuickReplyService.mockResolvedValueOnce(
      makeQuickReplyResponse({ visibility: 'personal', ownerUserId: FIXTURE_USER_ID }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      payload: { ...CREATE_PAYLOAD, visibility: 'personal' },
    });

    expect(res.statusCode).toBe(201);
    expect(mockCreateQuickReplyService).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('13b. feature flag desabilitada → 403', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      payload: CREATE_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/quick-replies/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/quick-replies/:id', () => {
  it('5. retorna 200 quando atualizado', async () => {
    const app = await buildTestApp();
    mockUpdateQuickReplyService.mockResolvedValueOnce(
      makeQuickReplyResponse({ title: 'Novo título' }),
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}`,
      payload: { title: 'Novo título' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe('Novo título');
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/quick-replies/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/quick-replies/:id', () => {
  it('6. retorna 204 quando removido', async () => {
    const app = await buildTestApp();
    mockDeleteQuickReplyService.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}`,
    });

    expect(res.statusCode).toBe(204);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/quick-replies/reorder
// ---------------------------------------------------------------------------

describe('PATCH /api/quick-replies/reorder', () => {
  it('7. retorna 200 e NÃO é capturada pela rota /:id (roteamento correto)', async () => {
    const app = await buildTestApp();
    mockReorderQuickRepliesService.mockResolvedValueOnce({ updated: 2 });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quick-replies/reorder',
      payload: {
        items: [
          { id: FIXTURE_QUICK_REPLY_ID, sortOrder: 1 },
          { id: 'dddddddd-0000-0000-0000-000000000001', sortOrder: 2 },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ updated: 2 });
    // Prova de que a rota certa foi chamada (e não updateQuickReplyController
    // tentando tratar "reorder" como :id).
    expect(mockReorderQuickRepliesService).toHaveBeenCalledTimes(1);
    expect(mockUpdateQuickReplyService).not.toHaveBeenCalled();
    await app.close();
  });

  it('12. sem manage → 403', async () => {
    const app = await buildTestApp(['livechat:quick_reply:read', 'livechat:quick_reply:write']);
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quick-replies/reorder',
      payload: { items: [{ id: FIXTURE_QUICK_REPLY_ID, sortOrder: 1 }] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('13c. feature flag desabilitada → 403', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/quick-replies/reorder',
      payload: { items: [{ id: FIXTURE_QUICK_REPLY_ID, sortOrder: 1 }] },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /api/quick-replies/uploads/signed-url (F28-S04)
// ---------------------------------------------------------------------------

describe('POST /api/quick-replies/uploads/signed-url', () => {
  const SIGNED_URL_PAYLOAD = { fileName: 'brasao.png', mime: 'image/png', sizeBytes: 1024 };

  it('14a. retorna 200 com { uploadUrl, publicMediaUrl, expiresAt }', async () => {
    const app = await buildTestApp();
    mockRequestQuickReplyUploadSignedUrlService.mockResolvedValueOnce({
      uploadUrl: 'https://storage.example.com/upload?sig=abc',
      publicMediaUrl: 'https://cdn.example.com/quick-replies/org/uuid.png',
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies/uploads/signed-url',
      payload: SIGNED_URL_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('uploadUrl');
    expect(body).toHaveProperty('publicMediaUrl');
    expect(body).toHaveProperty('expiresAt');
    await app.close();
  });

  it('14b. sem write → 403 (piso da rota, não chega ao service)', async () => {
    const app = await buildTestApp(['livechat:quick_reply:read']);

    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies/uploads/signed-url',
      payload: SIGNED_URL_PAYLOAD,
    });

    expect(res.statusCode).toBe(403);
    expect(mockRequestQuickReplyUploadSignedUrlService).not.toHaveBeenCalled();
    await app.close();
  });

  it('14c. feature flag desabilitada → 403', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies/uploads/signed-url',
      payload: SIGNED_URL_PAYLOAD,
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('14d. não é capturada pela rota /:id (roteamento correto — path estático "uploads")', async () => {
    const app = await buildTestApp();
    mockRequestQuickReplyUploadSignedUrlService.mockResolvedValueOnce({
      uploadUrl: 'https://storage.example.com/upload?sig=abc',
      publicMediaUrl: 'https://cdn.example.com/quick-replies/org/uuid.png',
      expiresAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/quick-replies/uploads/signed-url',
      payload: SIGNED_URL_PAYLOAD,
    });

    expect(res.statusCode).toBe(200);
    expect(mockRequestQuickReplyUploadSignedUrlService).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

// ---------------------------------------------------------------------------
// POST /api/quick-replies/:id/used (F28-S04)
// ---------------------------------------------------------------------------

describe('POST /api/quick-replies/:id/used', () => {
  it('15a. retorna 204 quando o uso é registrado', async () => {
    const app = await buildTestApp();
    mockMarkQuickReplyUsedService.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}/used`,
    });

    expect(res.statusCode).toBe(204);
    expect(mockMarkQuickReplyUsedService).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('15b. sem permissão de leitura → 403 (piso da rota, não chega ao service)', async () => {
    const app = await buildTestApp([]);

    const res = await app.inject({
      method: 'POST',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}/used`,
    });

    expect(res.statusCode).toBe(403);
    expect(mockMarkQuickReplyUsedService).not.toHaveBeenCalled();
    await app.close();
  });

  it('15c. feature flag desabilitada → 403', async () => {
    mockFeatureGateEnabled.mockReturnValue(false);
    const app = await buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}/used`,
    });

    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('15d. 404 quando a resposta é pessoal de outro operador (propaga NotFoundError)', async () => {
    const app = await buildTestApp();
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockMarkQuickReplyUsedService.mockRejectedValueOnce(
      new NotFoundError('Resposta rápida não encontrada'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/quick-replies/${FIXTURE_QUICK_REPLY_ID}/used`,
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
