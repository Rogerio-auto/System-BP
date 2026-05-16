// =============================================================================
// routes.test.ts — Testes de integração HTTP de kanban/routes.ts (F1-S13).
//
// Estratégia: Fastify em memória com mocks de service, auth e pg.
//
// Cenários cobertos:
//   POST /api/kanban/cards/:id/move
//     1. 200 em transição válida
//     2. 422 em transição inválida
//     3. 401 sem autenticação
//     4. 403 sem permissão kanban:move
//     5. 400 com body inválido (sem toStageId)
//     6. 404 card não encontrado
//   GET /api/kanban/stages
//     7. 200 retorna lista ordenada de stages
//     8. 401 sem autenticação
//     9. 403 sem permissão leads:read
//   GET /api/kanban/cards
//     10. 200 retorna lista paginada de cards
//     11. 200 com filtros (stage_id, city_id)
//     12. 400 com query inválida (page = 0)
//     13. 401 sem autenticação
//     14. 403 sem permissão leads:read
//     15. City scope: agente com cityScopeIds recebe cards do scope
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
// Mock service functions
// ---------------------------------------------------------------------------
const mockMoveCard = vi.fn();
const mockListKanbanStages = vi.fn();
const mockListKanbanCards = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  // importOriginal gets the real module so we can spread its exports
  // (needed for InvalidTransitionError class used in test assertions)
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    moveCard: (...args: unknown[]) => mockMoveCard(...args),
    listKanbanStages: (...args: unknown[]) => mockListKanbanStages(...args),
    listKanbanCards: (...args: unknown[]) => mockListKanbanCards(...args),
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
    cityScopeIds: string[] | null;
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
  permissions: ['kanban:move', 'leads:read', 'admin'],
  cityScopeIds: null as string[] | null,
};

const USER_NO_KANBAN = {
  id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  organizationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  permissions: ['leads:read'],
  cityScopeIds: null as string[] | null,
};

/** Agente com escopo restrito de cidade */
const CITY_SCOPE_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENT_USER = {
  id: 'd4e5f6a7-b8c9-4023-8def-234567890123',
  organizationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  permissions: ['leads:read', 'kanban:move'],
  cityScopeIds: [CITY_SCOPE_ID] as string[],
};

/** Usuário sem nenhuma permissão relevante */
const USER_NO_PERMS = {
  id: 'e5f6a7b8-c9d0-1234-efgh-345678901234',
  organizationId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  permissions: [] as string[],
  cityScopeIds: null as string[] | null,
};

const setAuth = (
  user: typeof ADMIN_USER | typeof AGENT_USER | typeof USER_NO_PERMS | null,
): void => {
  authState.user = user;
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CARD_ID = 'cccccccc-0000-0000-0000-000000000001';
const STAGE_ID = 'dddddddd-0000-0000-0000-000000000002';
const LEAD_ID = 'eeeeeeee-0000-0000-0000-000000000003';

const STAGE_1_ID = 'ffffffff-1111-1111-1111-111111111111';
const STAGE_2_ID = 'ffffffff-2222-2222-2222-222222222222';

const mockStages = [
  {
    id: STAGE_1_ID,
    name: 'Novo Lead',
    slug: 'novo-lead',
    position: 0,
    color: '#3B82F6',
    cityId: '',
    organizationId: ADMIN_USER.organizationId,
  },
  {
    id: STAGE_2_ID,
    name: 'Em Análise',
    slug: 'em-analise',
    position: 1,
    color: '#EAB308',
    cityId: '',
    organizationId: ADMIN_USER.organizationId,
  },
];

const mockCards = [
  {
    id: CARD_ID,
    stageId: STAGE_ID,
    leadId: LEAD_ID,
    leadName: 'Ana Silva',
    phoneMasked: '+55 69 ****-1234',
    agentId: null,
    agentName: null,
    loanAmountCents: null,
    position: 0,
    lastNote: null,
    updatedAt: new Date('2026-05-12T10:00:00Z').toISOString(),
  },
];

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
    const mockErr = error as {
      statusCode?: number;
      code?: string;
      name?: string;
      message?: string;
    };
    if (mockErr.name === 'AppError' && mockErr.statusCode !== undefined) {
      return reply.status(mockErr.statusCode).send({
        error: mockErr.code ?? 'ERROR',
        message: mockErr.message ?? 'Error',
      });
    }
    if (
      error !== null &&
      typeof error === 'object' &&
      'validation' in error &&
      (error as Record<string, unknown>)['validation'] !== undefined
    ) {
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

// ---------------------------------------------------------------------------
// GET /api/kanban/stages
// ---------------------------------------------------------------------------

describe('GET /api/kanban/stages', () => {
  let app: ReturnType<typeof buildTestApp> extends Promise<infer T> ? T : never;

  beforeEach(async () => {
    // Type inference helper: app is FastifyInstance
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app = (await buildTestApp()) as any;
    vi.clearAllMocks();
    setAuth(null);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (app as any).close();
  });

  it('200 — retorna lista de stages envolta em { stages: [...] }', async () => {
    setAuth(ADMIN_USER);
    mockListKanbanStages.mockResolvedValueOnce(mockStages);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/stages' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { stages: typeof mockStages };
    expect(body.stages).toHaveLength(2);
    expect(body.stages[0]!.name).toBe('Novo Lead');
    expect(body.stages[0]!.position).toBe(0);
    expect(body.stages[1]!.name).toBe('Em Análise');
    expect(mockListKanbanStages).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ADMIN_USER.organizationId }),
    );
  });

  it('401 — sem autenticação', async () => {
    setAuth(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/stages' });
    expect(res.statusCode).toBe(401);
    expect(mockListKanbanStages).not.toHaveBeenCalled();
  });

  it('403 — sem permissão leads:read', async () => {
    setAuth(USER_NO_PERMS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/stages' });
    expect(res.statusCode).toBe(403);
    expect(mockListKanbanStages).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/kanban/cards
// ---------------------------------------------------------------------------

describe('GET /api/kanban/cards', () => {
  let app: ReturnType<typeof buildTestApp> extends Promise<infer T> ? T : never;

  beforeEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app = (await buildTestApp()) as any;
    vi.clearAllMocks();
    setAuth(null);
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (app as any).close();
  });

  it('200 — retorna lista paginada de cards', async () => {
    setAuth(ADMIN_USER);
    mockListKanbanCards.mockResolvedValueOnce({ cards: mockCards, total: 1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/cards' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { cards: typeof mockCards; total: number };
    expect(body.total).toBe(1);
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0]!.id).toBe(CARD_ID);
    // LGPD: phoneMasked nunca expõe telefone completo
    expect(body.cards[0]!.phoneMasked).toMatch(/\*{4}/);
    expect(mockListKanbanCards).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 50 }),
      expect.objectContaining({ orgId: ADMIN_USER.organizationId, cityScopeIds: null }),
    );
  });

  it('200 — filtros stage_id e city_id repassados ao service', async () => {
    setAuth(ADMIN_USER);
    mockListKanbanCards.mockResolvedValueOnce({ cards: [], total: 0 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({
      method: 'GET',
      url: `/api/kanban/cards?stage_id=${STAGE_ID}&city_id=${CITY_SCOPE_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(mockListKanbanCards).toHaveBeenCalledWith(
      expect.objectContaining({
        stageId: STAGE_ID,
        cityId: CITY_SCOPE_ID,
      }),
      expect.anything(),
    );
  });

  it('400 — page inválido (zero)', async () => {
    setAuth(ADMIN_USER);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/cards?page=0' });

    expect(res.statusCode).toBe(400);
    expect(mockListKanbanCards).not.toHaveBeenCalled();
  });

  it('400 — limit acima do máximo (101)', async () => {
    setAuth(ADMIN_USER);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/cards?limit=101' });

    expect(res.statusCode).toBe(400);
    expect(mockListKanbanCards).not.toHaveBeenCalled();
  });

  it('401 — sem autenticação', async () => {
    setAuth(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/cards' });
    expect(res.statusCode).toBe(401);
  });

  it('403 — sem permissão leads:read', async () => {
    setAuth(USER_NO_PERMS);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/cards' });
    expect(res.statusCode).toBe(403);
    expect(mockListKanbanCards).not.toHaveBeenCalled();
  });

  it('city scope — agente com cityScopeIds recebe escopo repassado ao service', async () => {
    setAuth(AGENT_USER);
    mockListKanbanCards.mockResolvedValueOnce({ cards: mockCards, total: 1 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (app as any).inject({ method: 'GET', url: '/api/kanban/cards' });

    expect(res.statusCode).toBe(200);
    // Verifica que o city scope do agente foi repassado ao service
    expect(mockListKanbanCards).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cityScopeIds: AGENT_USER.cityScopeIds }),
    );
  });
});
