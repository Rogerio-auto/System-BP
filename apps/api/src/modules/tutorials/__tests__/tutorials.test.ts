// tutorials/__tests__/tutorials.test.ts — Testes das rotas de tutoriais (F12-S02 + F12-S08 + F12-S07).
//
// Cobre:
//   1.  GET /api/help/tutorials — retorna lista de ativos (200)
//   2.  GET /api/help/tutorials — retorna 403 quando flag desabilitada
//   3.  GET /api/admin/tutorials — requer tutorials:manage (200)
//   4.  GET /api/admin/tutorials — rejeita sem permissão (403)
//   5.  POST /api/admin/tutorials — cria tutorial (201)
//   6.  POST /api/admin/tutorials — idempotente quando feature_key já existe (200)
//   7.  POST /api/admin/tutorials — feature_key inválida retorna 422
//   8.  PATCH /api/admin/tutorials/:id — atualiza tutorial (200)
//   9.  PATCH /api/admin/tutorials/:id — 404 quando não encontrado
//   10. DELETE /api/admin/tutorials/:id — soft-delete (204)
//   11. DELETE /api/admin/tutorials/:id — 404 quando não encontrado
//   12. GET /api/admin/feature-keys — retorna catálogo (200)
//   13. GET /api/admin/feature-keys — rejeita sem permissão (403)
//   14. POST /api/admin/tutorials — persiste durationSeconds quando fornecido (F12-S08)
//   15. POST /api/admin/tutorials — durationSeconds ausente resulta em null na resposta (F12-S08)
//   16. PATCH /api/admin/tutorials/:id — atualiza durationSeconds via PATCH (F12-S08)
//   17. GET /api/help/tutorials — durationSeconds aparece na resposta pública (F12-S08)
//   18. POST /api/help/tutorial-events — registra tutorial_opened (201) (F12-S07)
//   19. POST /api/help/tutorial-events — registra tutorial_completed (201) (F12-S07)
//   20. POST /api/help/tutorial-events — body inválido retorna 422 (F12-S07)
//   21. POST /api/help/tutorial-events — 403 quando flag desabilitada (F12-S07)
//   22. POST /api/help/tutorial-events — rate-limit: segunda chamada rápida retorna 204 (F12-S07)

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks de infraestrutura — devem vir antes dos imports dos módulos
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

vi.mock('../../../db/client.js', () => ({
  db: {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
}));

vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    /* no-op — user preenchido pelo hook global em buildTestApp */
  },
}));

// ---------------------------------------------------------------------------
// featureGate mock
//
// O preHandler retornado por featureGate() é instalado na rota quando o plugin
// registra as rotas (uma única vez). Para simular flag desabilitada em testes
// específicos, o preHandler verifica `featureGateShouldFail` em runtime.
// ---------------------------------------------------------------------------

let featureGateShouldFail = false;

vi.mock('../../../plugins/featureGate.js', () => ({
  featureGate: (_flagKey: string) => async () => {
    if (featureGateShouldFail) {
      const { FeatureDisabledError } = await import('../../../shared/errors.js');
      throw new FeatureDisabledError('tutorials.enabled');
    }
  },
}));

// ---------------------------------------------------------------------------
// authorize mock
//
// Similar ao featureGate: o preHandler verifica `authorizeShouldFail` em runtime.
// ---------------------------------------------------------------------------

let authorizeShouldFail = false;

vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize: (_opts: unknown) => async () => {
    if (authorizeShouldFail) {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      throw new ForbiddenError('Acesso negado: permissões insuficientes');
    }
  },
}));

// ---------------------------------------------------------------------------
// Repository mocks
// ---------------------------------------------------------------------------

const mockListActiveTutorials = vi.fn();
const mockListAllTutorials = vi.fn();
const mockFindTutorialById = vi.fn();
const mockFindActiveByFeatureKey = vi.fn();
const mockCreateTutorial = vi.fn();
const mockUpdateTutorial = vi.fn();
const mockSoftDeleteTutorial = vi.fn();
const mockRecordTutorialEvent = vi.fn().mockResolvedValue(undefined);

vi.mock('../repository.js', () => ({
  listActiveTutorials: (...args: unknown[]) => mockListActiveTutorials(...args),
  listAllTutorials: (...args: unknown[]) => mockListAllTutorials(...args),
  findTutorialById: (...args: unknown[]) => mockFindTutorialById(...args),
  findActiveByFeatureKey: (...args: unknown[]) => mockFindActiveByFeatureKey(...args),
  createTutorial: (...args: unknown[]) => mockCreateTutorial(...args),
  updateTutorial: (...args: unknown[]) => mockUpdateTutorial(...args),
  softDeleteTutorial: (...args: unknown[]) => mockSoftDeleteTutorial(...args),
  recordTutorialEvent: (...args: unknown[]) => mockRecordTutorialEvent(...args),
}));

// audit mock
vi.mock('../../../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue('audit-uuid'),
}));

// ---------------------------------------------------------------------------
// Import das rotas (após mocks declarados)
// ---------------------------------------------------------------------------

const { tutorialsRoutes } = await import('../routes.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TUTORIAL_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const tutorialPublicFixture = {
  id: TUTORIAL_ID,
  featureKey: 'crm.lead.create' as const,
  title: 'Como criar um lead',
  description: 'Aprenda a criar um lead no CRM.',
  provider: 'youtube' as const,
  videoRef: 'dQw4w9WgXcQ',
  videoHash: null,
  articleSlug: 'crm/criar-lead',
  durationSeconds: 154,
};

const tutorialAdminFixture = {
  ...tutorialPublicFixture,
  organizationId: null,
  isActive: true,
  createdBy: USER_ID,
  createdAt: '2026-06-09T12:00:00.000Z',
  updatedAt: '2026-06-09T12:00:00.000Z',
  deletedAt: null,
};

// Fixture sem durationSeconds (campo omitido no body → null na resposta)
const tutorialAdminFixtureNoDuration = {
  ...tutorialAdminFixture,
  durationSeconds: null,
};

type UserPayload = {
  id: string;
  organizationId: string;
  permissions: string[];
  cityScopeIds: null;
};

// ---------------------------------------------------------------------------
// Factory do app de teste
// ---------------------------------------------------------------------------

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Injeta request.user para todos os requests do app de teste
  app.addHook('preHandler', async (request) => {
    (request as unknown as { user: UserPayload }).user = {
      id: USER_ID,
      organizationId: ORG_ID,
      permissions: ['tutorials:manage'],
      cityScopeIds: null,
    };
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const { AppError } = await import('../../../shared/errors.js');
    if (error instanceof AppError) {
      await reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    if (error !== null && typeof error === 'object' && 'validation' in error) {
      await reply.status(422).send({ error: 'VALIDATION_ERROR', message: 'Validation failed' });
      return;
    }
    await reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });

  await app.register(tutorialsRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Testes: GET /api/help/tutorials
// ---------------------------------------------------------------------------

describe('GET /api/help/tutorials', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('1. retorna lista de tutoriais ativos (200)', async () => {
    mockListActiveTutorials.mockResolvedValue([tutorialPublicFixture]);

    const res = await app.inject({ method: 'GET', url: '/api/help/tutorials' });

    expect(res.statusCode).toBe(200);
    type Body = { data: (typeof tutorialPublicFixture)[] };
    const body = res.json() as Body;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.featureKey).toBe('crm.lead.create');
    // Resposta pública não contém campos de auditoria
    expect(body.data[0]).not.toHaveProperty('createdAt');
    expect(body.data[0]).not.toHaveProperty('isActive');
    expect(mockListActiveTutorials).toHaveBeenCalledOnce();
  });

  it('2. retorna 403 quando feature flag está desabilitada', async () => {
    featureGateShouldFail = true;

    const res = await app.inject({ method: 'GET', url: '/api/help/tutorials' });

    expect(res.statusCode).toBe(403);
    expect(mockListActiveTutorials).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Testes: GET /api/admin/tutorials
// ---------------------------------------------------------------------------

describe('GET /api/admin/tutorials', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('3. retorna lista completa com campos de auditoria (200)', async () => {
    mockListAllTutorials.mockResolvedValue([tutorialAdminFixture]);

    const res = await app.inject({ method: 'GET', url: '/api/admin/tutorials' });

    expect(res.statusCode).toBe(200);
    type Body = { data: (typeof tutorialAdminFixture)[] };
    const body = res.json() as Body;
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.isActive).toBe(true);
    expect(body.data[0]!.createdAt).toBeTruthy();
  });

  it('4. retorna 403 sem permissão tutorials:manage', async () => {
    authorizeShouldFail = true;

    const res = await app.inject({ method: 'GET', url: '/api/admin/tutorials' });

    expect(res.statusCode).toBe(403);
    expect(mockListAllTutorials).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Testes: POST /api/admin/tutorials
// ---------------------------------------------------------------------------

describe('POST /api/admin/tutorials', () => {
  let app: FastifyInstance;

  const validBody = {
    featureKey: 'crm.lead.create',
    title: 'Como criar um lead',
    description: 'Aprenda a criar um lead.',
    provider: 'youtube',
    videoRef: 'dQw4w9WgXcQ',
    isActive: true,
    idempotencyKey: 'tutorial-crm-lead-create-v1',
  };

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('5. cria tutorial e retorna 201', async () => {
    mockFindActiveByFeatureKey.mockResolvedValue(null);
    mockCreateTutorial.mockResolvedValue(tutorialAdminFixture);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tutorials',
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    type Body = typeof tutorialAdminFixture;
    const body = res.json() as Body;
    expect(body.featureKey).toBe('crm.lead.create');
    expect(mockFindActiveByFeatureKey).toHaveBeenCalledWith(expect.anything(), 'crm.lead.create');
    expect(mockCreateTutorial).toHaveBeenCalledOnce();
  });

  it('6. retorna 200 idempotente quando feature_key já existe', async () => {
    mockFindActiveByFeatureKey.mockResolvedValue(tutorialAdminFixture);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tutorials',
      payload: validBody,
    });

    expect(res.statusCode).toBe(200);
    expect(mockCreateTutorial).not.toHaveBeenCalled();
  });

  it('7. feature_key inválida retorna 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tutorials',
      payload: { ...validBody, featureKey: 'chave.invalida.nao.existe' },
    });

    expect(res.statusCode).toBe(422);
    expect(mockCreateTutorial).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Testes: PATCH /api/admin/tutorials/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/tutorials/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('8. atualiza tutorial e retorna 200', async () => {
    const updated = { ...tutorialAdminFixture, title: 'Título atualizado', isActive: false };
    mockFindTutorialById.mockResolvedValue(tutorialAdminFixture);
    mockUpdateTutorial.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tutorials/${TUTORIAL_ID}`,
      payload: { title: 'Título atualizado', isActive: false },
    });

    expect(res.statusCode).toBe(200);
    type Body = typeof tutorialAdminFixture;
    const body = res.json() as Body;
    expect(body.title).toBe('Título atualizado');
    expect(mockUpdateTutorial).toHaveBeenCalledOnce();
  });

  it('9. retorna 404 quando tutorial não encontrado', async () => {
    mockFindTutorialById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tutorials/${TUTORIAL_ID}`,
      payload: { isActive: false },
    });

    expect(res.statusCode).toBe(404);
    expect(mockUpdateTutorial).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Testes: DELETE /api/admin/tutorials/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/tutorials/:id', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('10. soft-delete retorna 204', async () => {
    mockFindTutorialById.mockResolvedValue(tutorialAdminFixture);
    mockSoftDeleteTutorial.mockResolvedValue(true);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/tutorials/${TUTORIAL_ID}`,
    });

    expect(res.statusCode).toBe(204);
    expect(mockSoftDeleteTutorial).toHaveBeenCalledWith(expect.anything(), TUTORIAL_ID);
  });

  it('11. retorna 404 quando tutorial não encontrado', async () => {
    mockFindTutorialById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/tutorials/${TUTORIAL_ID}`,
    });

    expect(res.statusCode).toBe(404);
    expect(mockSoftDeleteTutorial).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Testes: GET /api/admin/feature-keys
// ---------------------------------------------------------------------------

describe('GET /api/admin/feature-keys', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('12. retorna catálogo de feature keys (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/feature-keys' });

    expect(res.statusCode).toBe(200);
    type Body = { data: string[] };
    const body = res.json() as Body;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data).toContain('crm.lead.create');
    expect(body.data).toContain('credit.analysis.create');
  });

  it('13. retorna 403 sem permissão tutorials:manage', async () => {
    authorizeShouldFail = true;

    const res = await app.inject({ method: 'GET', url: '/api/admin/feature-keys' });

    expect(res.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Testes: durationSeconds (F12-S08)
// ---------------------------------------------------------------------------

describe('durationSeconds — F12-S08', () => {
  let app: FastifyInstance;

  const validBody = {
    featureKey: 'crm.lead.create',
    title: 'Como criar um lead',
    description: 'Aprenda a criar um lead.',
    provider: 'youtube',
    videoRef: 'dQw4w9WgXcQ',
    isActive: true,
    idempotencyKey: 'tutorial-crm-lead-create-v1',
  };

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('14. POST persiste durationSeconds quando fornecido', async () => {
    mockFindActiveByFeatureKey.mockResolvedValue(null);
    mockCreateTutorial.mockResolvedValue(tutorialAdminFixture); // tem durationSeconds: 154

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tutorials',
      payload: { ...validBody, durationSeconds: 154 },
    });

    expect(res.statusCode).toBe(201);
    type Body = typeof tutorialAdminFixture;
    const body = res.json() as Body;
    expect(body.durationSeconds).toBe(154);
    // Verifica que createTutorial recebeu o campo
    expect(mockCreateTutorial).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ durationSeconds: 154 }),
      USER_ID,
    );
  });

  it('15. POST sem durationSeconds resulta em null na resposta', async () => {
    mockFindActiveByFeatureKey.mockResolvedValue(null);
    mockCreateTutorial.mockResolvedValue(tutorialAdminFixtureNoDuration);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tutorials',
      payload: validBody,
    });

    expect(res.statusCode).toBe(201);
    type Body = typeof tutorialAdminFixtureNoDuration;
    const body = res.json() as Body;
    expect(body.durationSeconds).toBeNull();
  });

  it('16. PATCH atualiza durationSeconds', async () => {
    const updated = { ...tutorialAdminFixture, durationSeconds: 210 };
    mockFindTutorialById.mockResolvedValue(tutorialAdminFixture);
    mockUpdateTutorial.mockResolvedValue(updated);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tutorials/${TUTORIAL_ID}`,
      payload: { durationSeconds: 210 },
    });

    expect(res.statusCode).toBe(200);
    type Body = typeof updated;
    const body = res.json() as Body;
    expect(body.durationSeconds).toBe(210);
    expect(mockUpdateTutorial).toHaveBeenCalledWith(
      expect.anything(),
      TUTORIAL_ID,
      expect.objectContaining({ durationSeconds: 210 }),
    );
  });

  it('17. GET /api/help/tutorials inclui durationSeconds na resposta pública', async () => {
    mockListActiveTutorials.mockResolvedValue([tutorialPublicFixture]);

    const res = await app.inject({ method: 'GET', url: '/api/help/tutorials' });

    expect(res.statusCode).toBe(200);
    type Body = { data: (typeof tutorialPublicFixture)[] };
    const body = res.json() as Body;
    expect(body.data[0]).toHaveProperty('durationSeconds', 154);
  });
});

// ---------------------------------------------------------------------------
// Testes: POST /api/help/tutorial-events (F12-S07)
// ---------------------------------------------------------------------------

describe('POST /api/help/tutorial-events — F12-S07', () => {
  let app: FastifyInstance;

  const validOpenedBody = {
    tutorialId: TUTORIAL_ID,
    featureKey: 'crm.lead.create',
    eventType: 'tutorial_opened',
  };

  const validCompletedBody = {
    tutorialId: TUTORIAL_ID,
    featureKey: 'crm.lead.create',
    eventType: 'tutorial_completed',
  };

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    vi.clearAllMocks();
    featureGateShouldFail = false;
    authorizeShouldFail = false;
  });

  it('18. registra tutorial_opened e retorna 201', async () => {
    mockRecordTutorialEvent.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/help/tutorial-events',
      payload: validOpenedBody,
    });

    expect(res.statusCode).toBe(201);
    expect(mockRecordTutorialEvent).toHaveBeenCalledOnce();
    expect(mockRecordTutorialEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'tutorial_opened' }),
      USER_ID,
    );
  });

  it('19. registra tutorial_completed e retorna 201', async () => {
    mockRecordTutorialEvent.mockResolvedValue(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/api/help/tutorial-events',
      payload: validCompletedBody,
    });

    expect(res.statusCode).toBe(201);
    expect(mockRecordTutorialEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'tutorial_completed' }),
      USER_ID,
    );
  });

  it('20. body inválido (eventType desconhecido) retorna 422', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/help/tutorial-events',
      payload: {
        tutorialId: TUTORIAL_ID,
        featureKey: 'crm.lead.create',
        eventType: 'tutorial_paused', // inválido
      },
    });

    expect(res.statusCode).toBe(422);
    expect(mockRecordTutorialEvent).not.toHaveBeenCalled();
  });

  it('21. retorna 403 quando feature flag está desabilitada', async () => {
    featureGateShouldFail = true;

    const res = await app.inject({
      method: 'POST',
      url: '/api/help/tutorial-events',
      payload: validOpenedBody,
    });

    expect(res.statusCode).toBe(403);
    expect(mockRecordTutorialEvent).not.toHaveBeenCalled();
  });

  it('22. rate-limit: segunda chamada rápida com mesmo (tutorialId, eventType) retorna 204', async () => {
    // Primeira chamada — registra e seta o rate-limit no mapa in-memory.
    mockRecordTutorialEvent.mockResolvedValue(undefined);
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/help/tutorial-events',
      payload: { ...validOpenedBody, tutorialId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
    });
    expect(res1.statusCode).toBe(201);

    // Segunda chamada imediata com o mesmo payload — deve cair no rate-limit.
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/help/tutorial-events',
      payload: { ...validOpenedBody, tutorialId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' },
    });
    expect(res2.statusCode).toBe(204);
    // recordTutorialEvent só foi chamado uma vez (na primeira requisição).
    expect(mockRecordTutorialEvent).toHaveBeenCalledOnce();
  });
});
