// =============================================================================
// routes.test.ts — Testes de integração HTTP de kanban/routes.ts (F1-S13).
//
// Estratégia: Fastify em memória com mocks de service, auth e pg.
//
// Cenários cobertos:
//   1. POST /api/kanban/cards/:id/move — 200 em transição válida
//   2. POST /api/kanban/cards/:id/move — 422 em transição inválida
//   3. POST /api/kanban/cards/:id/move — 401 sem autenticação
//   4. POST /api/kanban/cards/:id/move — 403 sem permissão kanban:move
//   5. POST /api/kanban/cards/:id/move — 400 com body inválido (sem toStageId)
//   6. POST /api/kanban/cards/:id/move — 404 card não encontrado
// =============================================================================
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    LANGGRAPH_INTERNAL_TOKEN: 'test-internal-token-32-chars-minimum!!',
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
  },
}));

// ---------------------------------------------------------------------------
// Mock db client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((fn: (tx: unknown) => unknown) =>
      fn({ insert: vi.fn(), update: vi.fn(), select: vi.fn() }),
    ),
  },
}));

// ---------------------------------------------------------------------------
// Mock service.moveCard
// ---------------------------------------------------------------------------
const mockMoveCard = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  // importOriginal gets the real module so we can spread its exports
  // (needed for InvalidTransitionError class used in test assertions)
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    moveCard: (...args: unknown[]) => mockMoveCard(...args),
  };
});

// ---------------------------------------------------------------------------
// Mock auth middlewares
// ---------------------------------------------------------------------------
const authState = {
  user: null as null | {
    id: string;
    organizationId: string;
    permissions: string[];
    cityScopeIds: null;
  },
};

vi.mock('../../../modules/auth/middlewares/authenticate.js', () => ({
  authenticate: () => async (request: { user?: unknown }) => {
    if (!authState.user) {
      throw Object.assign(new Error('Token de acesso ausente ou mal formatado'), {
        name: 'AppError',
        statusCode: 401,
        code: 'UNAUTHORIZED',
      });
    }
    request.user = authState.user;
  },
}));

vi.mock('../../../modules/auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) => async (request: { user?: { permissions: string[] } }) => {
      if (!request.user) {
        throw Object.assign(new Error('Não autenticado'), {
          name: 'AppError',
          statusCode: 401,
          code: 'UNAUTHORIZED',
        });
      }
      const missing = opts.permissions.filter(
        (p) => !request.user!.permissions.includes(p) && !request.user!.permissions.includes('*'),
      );
      if (missing.length > 0) {
        throw Object.assign(new Error('Acesso negado: permissões insuficientes'), {
          name: 'AppError',
          statusCode: 403,
          code: 'FORBIDDEN',
        });
      }
    },
}));

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
const ADMIN_USER = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  organizationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  permissions: ['kanban:move', 'admin'],
  cityScopeIds: null as null,
};

const USER_NO_KANBAN = {
  id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  organizationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  permissions: ['leads:read'],
  cityScopeIds: null as null,
};

const setAuth = (user: typeof ADMIN_USER | null): void => {
  authState.user = user;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CARD_ID = 'cccccccc-0000-0000-0000-000000000001';
const STAGE_ID = 'dddddddd-0000-0000-0000-000000000002';

const mockUpdatedCard = {
  id: CARD_ID,
  organizationId: ADMIN_USER.organizationId,
  leadId: 'eeeeeeee-0000-0000-0000-000000000003',
  stageId: STAGE_ID,
  assigneeUserId: null,
  priority: 0,
  notes: null,
  enteredStageAt: new Date('2026-05-12T12:00:00Z'),
  createdAt: new Date('2026-05-12T10:00:00Z'),
  updatedAt: new Date('2026-05-12T12:00:00Z'),
};

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------
async function buildTestApp(): Promise<FastifyInstance> {
  const [
    { default: Fastify },
    { serializerCompiler, validatorCompiler },
    { kanbanRoutes },
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

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = { error: error.code, message: error.message };
      if (error.details !== undefined) body['details'] = error.details;
      return reply.status(error.statusCode).send(body);
    }
    const mockErr = error as { statusCode?: number; code?: string; name?: string };
    if (mockErr.name === 'AppError' && mockErr.statusCode !== undefined) {
      return reply.status(mockErr.statusCode).send({
        error: mockErr.code ?? 'ERROR',
        message: error.message,
      });
    }
    if (error.validation !== undefined) {
      return reply.status(400).send({ error: 'VALIDATION_ERROR', message: 'Validation failed' });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(kanbanRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('POST /api/kanban/cards/:id/move', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
    vi.clearAllMocks();
    setAuth(null);
  });

  afterEach(async () => {
    await app.close();
  });

  it('200 — transição válida retorna card atualizado', async () => {
    setAuth(ADMIN_USER);
    mockMoveCard.mockResolvedValueOnce(mockUpdatedCard);

    const res = await app.inject({
      method: 'POST',
      url: `/api/kanban/cards/${CARD_ID}/move`,
      payload: { toStageId: STAGE_ID },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; stageId: string }>();
    expect(body.id).toBe(CARD_ID);
    expect(body.stageId).toBe(STAGE_ID);
    expect(mockMoveCard).toHaveBeenCalledWith(
      CARD_ID,
      STAGE_ID,
      expect.objectContaining({ userId: ADMIN_USER.id, orgId: ADMIN_USER.organizationId }),
    );
  });

  it('422 — transição inválida retorna INVALID_TRANSITION', async () => {
    setAuth(ADMIN_USER);

    // O mock simula o InvalidTransitionError do service
    const { InvalidTransitionError } = await import('../service.js');
    mockMoveCard.mockRejectedValueOnce(
      new InvalidTransitionError('Convertido', 'Perdido', 'Teste'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/kanban/cards/${CARD_ID}/move`,
      payload: { toStageId: STAGE_ID },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('INVALID_TRANSITION');
  });

  it('401 — sem autenticação', async () => {
    setAuth(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/kanban/cards/${CARD_ID}/move`,
      payload: { toStageId: STAGE_ID },
    });

    expect(res.statusCode).toBe(401);
  });

  it('403 — sem permissão kanban:move', async () => {
    setAuth(USER_NO_KANBAN);

    const res = await app.inject({
      method: 'POST',
      url: `/api/kanban/cards/${CARD_ID}/move`,
      payload: { toStageId: STAGE_ID },
    });

    expect(res.statusCode).toBe(403);
    expect(mockMoveCard).not.toHaveBeenCalled();
  });

  it('400 — body sem toStageId', async () => {
    setAuth(ADMIN_USER);

    const res = await app.inject({
      method: 'POST',
      url: `/api/kanban/cards/${CARD_ID}/move`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(mockMoveCard).not.toHaveBeenCalled();
  });

  it('400 — toStageId não é UUID', async () => {
    setAuth(ADMIN_USER);

    const res = await app.inject({
      method: 'POST',
      url: `/api/kanban/cards/${CARD_ID}/move`,
      payload: { toStageId: 'not-a-uuid' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('404 — card não encontrado', async () => {
    setAuth(ADMIN_USER);

    const { NotFoundError } = await import('../../../shared/errors.js');
    mockMoveCard.mockRejectedValueOnce(new NotFoundError('Card não encontrado'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/kanban/cards/${CARD_ID}/move`,
      payload: { toStageId: STAGE_ID },
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NOT_FOUND');
  });
});
