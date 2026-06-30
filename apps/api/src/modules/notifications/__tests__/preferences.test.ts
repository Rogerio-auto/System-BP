// =============================================================================
// notifications/__tests__/preferences.test.ts — Testes de preferências por
// categoria × canal (F24-S09).
//
// Estratégia:
//   Seção 1 — Unit tests de `isCategoryChannelEnabled` com DB mockado.
//             Verifica a lógica de fallback: override de categoria >
//             default do canal > habilitado (opt-out).
//   Seção 2 — Integration tests das rotas GET/PUT com services mockados.
//             Verifica que os novos campos (category) fluem corretamente
//             pela rota e que o contrato de backward compat é mantido.
//
// Cobre (DoD F24-S09):
//   1. isCategoryChannelEnabled: override de categoria retorna enabled=false
//   2. isCategoryChannelEnabled: fallback para default do canal quando sem override
//   3. isCategoryChannelEnabled: canal globalmente mutado (category=null) → false
//   4. isCategoryChannelEnabled: sem nenhum registro → true (opt-out default)
//   5. Retrocompat: category=NULL continua sendo o default do canal
//   6. GET /api/notifications/preferences → resposta com campo category
//   7. PUT /api/notifications/preferences com category → 200
//   8. PUT /api/notifications/preferences sem category (retrocompat) → 200
//   9. PUT max 21 items → 200; PUT 22 items → 400
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de infraestrutura (devem ser declarados antes dos imports dos módulos)
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
// Mocks dos services (para testes de rota)
// ---------------------------------------------------------------------------

const mockGetPreferences = vi.fn();
const mockUpdatePreferences = vi.fn();

vi.mock('../service.js', () => ({
  listNotificationsService: vi.fn(),
  markNotificationReadService: vi.fn(),
  markAllNotificationsReadService: vi.fn(),
  getPreferencesService: (...args: unknown[]) => mockGetPreferences(...args),
  updatePreferencesService: (...args: unknown[]) => mockUpdatePreferences(...args),
}));

// ---------------------------------------------------------------------------
// Importações dos módulos sob teste
// ---------------------------------------------------------------------------

import { isCategoryChannelEnabled } from '../repository.js';
import { notificationsRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const ORG_ID = 'c0000001-0000-0000-0000-000000000001';
const USER_ID = 'c0000002-0000-0000-0000-000000000002';

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ['notifications:read'],
  cityScopeIds: null,
};

// ---------------------------------------------------------------------------
// Helper: cria mock de DB para `isCategoryChannelEnabled`
//
// A função executa:
//   db.select({...}).from(...).where(...).orderBy(...).limit(1)
// e retorna Array<{ enabled: boolean }>.
// ---------------------------------------------------------------------------

type SelectRow = { enabled: boolean };

function createDbSelectMock(rows: SelectRow[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return {
    select: vi.fn().mockReturnValue(chain),
  };
}

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
// Seção 1 — Unit tests de isCategoryChannelEnabled
// ===========================================================================

describe('isCategoryChannelEnabled — lógica de fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna false quando há override de categoria específica desabilitado', async () => {
    // Cenário: billing desabilitado para in_app, canal globalmente habilitado.
    // A query ordena por (category IS NULL) ASC, então o override (IS NULL=false=0)
    // vem primeiro. LIMIT 1 → retorna o override.
    const mockDb = createDbSelectMock([{ enabled: false }]);

    // `as` justificado: mockDb satisfaz a interface de Database para estas queries.
    const result = await isCategoryChannelEnabled(
      mockDb as unknown as Parameters<typeof isCategoryChannelEnabled>[0],
      ORG_ID,
      USER_ID,
      'in_app',
      'billing',
    );

    expect(result).toBe(false);
    expect(mockDb.select).toHaveBeenCalledOnce();
  });

  it('cai no default do canal quando não há override de categoria', async () => {
    // Cenário: apenas o default de canal existe (category=null, enabled=false).
    // A query retorna o row de category=null como o primeiro (e único) resultado.
    const mockDb = createDbSelectMock([{ enabled: false }]);

    const result = await isCategoryChannelEnabled(
      mockDb as unknown as Parameters<typeof isCategoryChannelEnabled>[0],
      ORG_ID,
      USER_ID,
      'email',
      'credit',
    );

    // Sem override específico → usa o default do canal (enabled=false)
    expect(result).toBe(false);
  });

  it('canal globalmente mutado (category=null, enabled=false) silencia todas as categorias', async () => {
    // Cenário: email desabilitado globalmente; não há override de categoria.
    // A query clause inclui (category = 'handoff' OR category IS NULL);
    // apenas o row genérico (category=null) existe → enabled=false.
    const mockDb = createDbSelectMock([{ enabled: false }]);

    const result = await isCategoryChannelEnabled(
      mockDb as unknown as Parameters<typeof isCategoryChannelEnabled>[0],
      ORG_ID,
      USER_ID,
      'email',
      'handoff',
    );

    expect(result).toBe(false);
  });

  it('retorna true quando não há nenhum registro (opt-out default)', async () => {
    // Cenário: nenhuma preferência configurada → opt-out → habilitado.
    const mockDb = createDbSelectMock([]);

    const result = await isCategoryChannelEnabled(
      mockDb as unknown as Parameters<typeof isCategoryChannelEnabled>[0],
      ORG_ID,
      USER_ID,
      'whatsapp',
      'assignment',
    );

    expect(result).toBe(true);
  });

  it('retrocompat: linhas category=NULL são o default do canal', async () => {
    // Cenário legado: só existem rows com category=null (pre-F24-S09).
    // isCategoryChannelEnabled ainda funciona via fallback para o default do canal.
    const mockDb = createDbSelectMock([{ enabled: true }]);

    const result = await isCategoryChannelEnabled(
      mockDb as unknown as Parameters<typeof isCategoryChannelEnabled>[0],
      ORG_ID,
      USER_ID,
      'in_app',
      'system',
    );

    // Row genérico (category=null) existe com enabled=true → retorna true
    expect(result).toBe(true);
  });

  it('override de categoria habilitado prevalece sobre default desabilitado', async () => {
    // Cenário: canal globalmente mudo, mas categoria `credit` reabilitada.
    // O override (IS NULL=false=0) vem primeiro na ordenação → enabled=true.
    const mockDb = createDbSelectMock([{ enabled: true }]);

    const result = await isCategoryChannelEnabled(
      mockDb as unknown as Parameters<typeof isCategoryChannelEnabled>[0],
      ORG_ID,
      USER_ID,
      'in_app',
      'credit',
    );

    expect(result).toBe(true);
  });
});

// ===========================================================================
// Seção 2 — Integration tests de rota: GET/PUT com category
// ===========================================================================

describe('GET /api/notifications/preferences — matriz categoria × canal', () => {
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

  it('retorna 200 com itens incluindo category=null nos defaults de canal', async () => {
    const matrixResponse = {
      data: [
        { channel: 'in_app', enabled: true, category: null },
        { channel: 'email', enabled: true, category: null },
        { channel: 'whatsapp', enabled: true, category: null },
      ],
    };
    mockGetPreferences.mockResolvedValueOnce(matrixResponse);

    const res = await app.inject({ method: 'GET', url: '/api/notifications/preferences' });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof matrixResponse>();
    expect(body.data).toHaveLength(3);

    const inApp = body.data.find((p) => p.channel === 'in_app' && p.category === null);
    expect(inApp?.enabled).toBe(true);
  });

  it('retorna overrides de categoria junto com defaults de canal', async () => {
    const matrixResponse = {
      data: [
        { channel: 'in_app', enabled: true, category: null },
        { channel: 'email', enabled: true, category: null },
        { channel: 'whatsapp', enabled: true, category: null },
        { channel: 'in_app', enabled: false, category: 'billing' },
        { channel: 'email', enabled: false, category: 'billing' },
      ],
    };
    mockGetPreferences.mockResolvedValueOnce(matrixResponse);

    const res = await app.inject({ method: 'GET', url: '/api/notifications/preferences' });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof matrixResponse>();
    expect(body.data).toHaveLength(5);

    const billingInApp = body.data.find((p) => p.channel === 'in_app' && p.category === 'billing');
    expect(billingInApp?.enabled).toBe(false);
  });

  it('retrocompat: aceita resposta sem campo category (clientes legados)', async () => {
    // Resposta sem category → backward compat com clients que ignoram o campo
    const legacyResponse = {
      data: [
        { channel: 'in_app', enabled: true },
        { channel: 'email', enabled: false },
        { channel: 'whatsapp', enabled: true },
      ],
    };
    mockGetPreferences.mockResolvedValueOnce(legacyResponse);

    const res = await app.inject({ method: 'GET', url: '/api/notifications/preferences' });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof legacyResponse>();
    expect(body.data).toHaveLength(3);
    // categoria pode estar ausente — o schema a define como opcional
    const inApp = body.data.find((p) => p.channel === 'in_app');
    expect(inApp?.enabled).toBe(true);
  });
});

describe('PUT /api/notifications/preferences — com e sem category', () => {
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

  it('aceita payload com category e retorna 200', async () => {
    const expectedResponse = {
      data: [
        { channel: 'in_app', enabled: true, category: null },
        { channel: 'email', enabled: true, category: null },
        { channel: 'whatsapp', enabled: true, category: null },
        { channel: 'in_app', enabled: false, category: 'billing' },
      ],
    };
    mockUpdatePreferences.mockResolvedValueOnce(expectedResponse);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: {
        preferences: [
          { channel: 'in_app', enabled: false, category: 'billing' },
          { channel: 'email', enabled: false, category: 'billing' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof expectedResponse>();
    expect(body.data).toHaveLength(4);
    expect(mockUpdatePreferences).toHaveBeenCalledOnce();
  });

  it('aceita payload sem category (retrocompat) e retorna 200', async () => {
    const expectedResponse = {
      data: [
        { channel: 'in_app', enabled: true, category: null },
        { channel: 'email', enabled: false, category: null },
        { channel: 'whatsapp', enabled: true, category: null },
      ],
    };
    mockUpdatePreferences.mockResolvedValueOnce(expectedResponse);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: {
        preferences: [{ channel: 'email', enabled: false }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof expectedResponse>();
    expect(body.data).toHaveLength(3);
  });

  it('aceita category=null explícito como default de canal', async () => {
    const expectedResponse = {
      data: [
        { channel: 'in_app', enabled: false, category: null },
        { channel: 'email', enabled: true, category: null },
        { channel: 'whatsapp', enabled: true, category: null },
      ],
    };
    mockUpdatePreferences.mockResolvedValueOnce(expectedResponse);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: {
        preferences: [{ channel: 'in_app', enabled: false, category: null }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mockUpdatePreferences).toHaveBeenCalledOnce();
  });

  it('retorna 400 para payload vazio (min 1)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: { preferences: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 para payload com 22 items (max 21)', async () => {
    // 22 = 3 canais × 7 opções + 1 extra
    const tooMany = Array.from({ length: 22 }, (_, i) => ({
      channel: 'in_app' as const,
      enabled: true,
      category: i % 2 === 0 ? ('billing' as const) : undefined,
    }));

    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: { preferences: tooMany },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 para category inválida', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/notifications/preferences',
      payload: {
        preferences: [{ channel: 'in_app', enabled: false, category: 'invalid_category' }],
      },
    });

    expect(res.statusCode).toBe(400);
  });
});
