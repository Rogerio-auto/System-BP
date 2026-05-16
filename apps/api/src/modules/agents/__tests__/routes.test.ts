// =============================================================================
// agents/__tests__/routes.test.ts — Testes de integração (F8-S01).
//
// Estratégia: sobe Fastify com agentsRoutes, mocka authenticate/authorize
// e service para controlar contexto e dados.
//
// Cobre:
//   1.  GET  /api/admin/agents                          → 200 lista paginada
//   2.  GET  /api/admin/agents?cityId=...               → 200 repassa filtro
//   3.  POST /api/admin/agents                          → 201 criado
//   4.  POST /api/admin/agents                          → 409 userId duplicado
//   5.  POST /api/admin/agents                          → 400 body inválido (sem cityIds)
//   6.  POST /api/admin/agents                          → 400 primaryCityId fora de cityIds
//   7.  PATCH /api/admin/agents/:id                     → 200 atualizado
//   8.  PATCH /api/admin/agents/:id                     → 404 não encontrado
//   9.  POST /api/admin/agents/:id/deactivate           → 200 desativado
//   10. POST /api/admin/agents/:id/deactivate           → 409 último ativo com leads
//   11. POST /api/admin/agents/:id/reactivate           → 200 reativado
//   12. POST /api/admin/agents/:id/reactivate           → 409 já ativo
//   13. PUT  /api/admin/agents/:id/cities               → 200 cidades atualizadas
//   14. PUT  /api/admin/agents/:id/cities               → 400 body inválido
//   15. Sem auth → 403
//   16. Sem permissão agents:manage → 403
//   17. City scope: usuário com escopo limitado passa cityScopeIds corretamente
// =============================================================================
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppError } from '../../../shared/errors.js';
import { agentsRoutes } from '../routes.js';

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
// Mock authenticate
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook global no buildTestApp
  },
}));

// ---------------------------------------------------------------------------
// Mock authorize
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
const mockListAgents = vi.fn();
const mockCreateAgent = vi.fn();
const mockUpdateAgentService = vi.fn();
const mockDeactivateAgentService = vi.fn();
const mockReactivateAgentService = vi.fn();
const mockSetAgentCities = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    listAgents: (...args: unknown[]) => mockListAgents(...args),
    createAgent: (...args: unknown[]) => mockCreateAgent(...args),
    updateAgentService: (...args: unknown[]) => mockUpdateAgentService(...args),
    deactivateAgentService: (...args: unknown[]) => mockDeactivateAgentService(...args),
    reactivateAgentService: (...args: unknown[]) => mockReactivateAgentService(...args),
    setAgentCities: (...args: unknown[]) => mockSetAgentCities(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_AGENT_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_1 = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_2 = 'dddddddd-0000-0000-0000-000000000002';

function makeAgentResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: FIXTURE_AGENT_ID,
    organization_id: FIXTURE_ORG_ID,
    user_id: FIXTURE_USER_ID,
    display_name: 'João Silva',
    phone: '+5569991234567',
    is_active: true,
    cities: [{ city_id: FIXTURE_CITY_ID_1, is_primary: true }],
    primary_city_id: FIXTURE_CITY_ID_1,
    city_count: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

const CREATE_AGENT_PAYLOAD = {
  displayName: 'João Silva',
  phone: '+5569991234567',
  userId: FIXTURE_USER_ID,
  cityIds: [FIXTURE_CITY_ID_1],
  primaryCityId: FIXTURE_CITY_ID_1,
};

// ---------------------------------------------------------------------------
// Build test app — importações estáticas no topo para evitar timeout no beforeAll
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['agents:manage'],
  injectUser = true,
  cityScopeIds: string[] | null = null,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (injectUser) {
    app.addHook('preHandler', async (request) => {
      request.user = {
        id: FIXTURE_USER_ID,
        organizationId: FIXTURE_ORG_ID,
        permissions,
        cityScopeIds,
      };
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
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

  await app.register(agentsRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Shared app (permissions = agents:manage, cityScopeIds = null)
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
}, 30000);

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /api/admin/agents
// ---------------------------------------------------------------------------

describe('GET /api/admin/agents', () => {
  it('retorna 200 com lista paginada', async () => {
    mockListAgents.mockResolvedValue({
      data: [makeAgentResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/admin/agents' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
    expect(Array.isArray(body['data'])).toBe(true);
  });

  it('repassa filtros ao service (cityId, isActive, q)', async () => {
    mockListAgents.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/agents?cityId=${FIXTURE_CITY_ID_1}&isActive=true&q=joao`,
    });

    expect(res.statusCode).toBe(200);
    expect(mockListAgents).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: FIXTURE_ORG_ID }),
      expect.objectContaining({ cityId: FIXTURE_CITY_ID_1, isActive: true, q: 'joao' }),
      expect.objectContaining({ cityScopeIds: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/agents
// ---------------------------------------------------------------------------

describe('POST /api/admin/agents', () => {
  it('retorna 201 ao criar agente', async () => {
    mockCreateAgent.mockResolvedValue(makeAgentResponse());

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: CREATE_AGENT_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['id']).toBe(FIXTURE_AGENT_ID);
    expect(body['display_name']).toBe('João Silva');
  });

  it('retorna 409 quando userId já está vinculado a agente ativo', async () => {
    const { AgentUserConflictError } = await import('../service.js');
    mockCreateAgent.mockRejectedValue(new AgentUserConflictError());

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: CREATE_AGENT_PAYLOAD,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('CONFLICT');
  });

  it('retorna 400 quando cityIds está vazio', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { displayName: 'Fulano', cityIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando displayName tem menos de 2 chars', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { displayName: 'A', cityIds: [FIXTURE_CITY_ID_1] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando primaryCityId não está em cityIds', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: {
        displayName: 'João',
        cityIds: [FIXTURE_CITY_ID_1],
        primaryCityId: FIXTURE_CITY_ID_2, // não está em cityIds
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando body está vazio', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/agents/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/agents/:id', () => {
  it('retorna 200 com agente atualizado', async () => {
    mockUpdateAgentService.mockResolvedValue(
      makeAgentResponse({ display_name: 'João Atualizado' }),
    );

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}`,
      payload: { displayName: 'João Atualizado' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['display_name']).toBe('João Atualizado');
  });

  it('retorna 404 quando agente não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateAgentService.mockRejectedValue(new NotFoundError('Agente não encontrado'));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}`,
      payload: { displayName: 'Fulano' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json<Record<string, unknown>>()['error']).toBe('NOT_FOUND');
  });

  it('retorna 400 quando body está vazio (nenhum campo informado)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/deactivate
// ---------------------------------------------------------------------------

describe('POST /api/admin/agents/:id/deactivate', () => {
  it('retorna 200 com agente desativado', async () => {
    mockDeactivateAgentService.mockResolvedValue(
      makeAgentResponse({ is_active: false, deleted_at: new Date().toISOString() }),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/deactivate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['is_active']).toBe(false);
  });

  it('retorna 409 quando agente é o último ativo com leads abertos', async () => {
    const { AgentLastActiveInCityError } = await import('../service.js');
    mockDeactivateAgentService.mockRejectedValue(
      new AgentLastActiveInCityError(FIXTURE_CITY_ID_1, 3),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/deactivate`,
    });

    expect(res.statusCode).toBe(409);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('CONFLICT');
    expect((body['details'] as Record<string, unknown> | undefined)?.['cityId']).toBe(
      FIXTURE_CITY_ID_1,
    );
    expect((body['details'] as Record<string, unknown> | undefined)?.['openLeads']).toBe(3);
  });

  it('retorna 409 quando agente já está inativo', async () => {
    const { ConflictError } = await import('../../../shared/errors.js');
    mockDeactivateAgentService.mockRejectedValue(new ConflictError('Agente já está inativo'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/deactivate`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<Record<string, unknown>>()['error']).toBe('CONFLICT');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/agents/:id/reactivate
// ---------------------------------------------------------------------------

describe('POST /api/admin/agents/:id/reactivate', () => {
  it('retorna 200 com agente reativado', async () => {
    mockReactivateAgentService.mockResolvedValue(makeAgentResponse({ is_active: true }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/reactivate`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['is_active']).toBe(true);
  });

  it('retorna 409 quando agente já está ativo', async () => {
    const { ConflictError } = await import('../../../shared/errors.js');
    mockReactivateAgentService.mockRejectedValue(new ConflictError('Agente já está ativo'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/reactivate`,
    });

    expect(res.statusCode).toBe(409);
    expect(res.json<Record<string, unknown>>()['error']).toBe('CONFLICT');
  });

  it('retorna 404 quando agente não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockReactivateAgentService.mockRejectedValue(new NotFoundError('Agente não encontrado'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/reactivate`,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/agents/:id/cities
// ---------------------------------------------------------------------------

describe('PUT /api/admin/agents/:id/cities', () => {
  it('retorna 200 com cidades substituídas atomicamente', async () => {
    mockSetAgentCities.mockResolvedValue(
      makeAgentResponse({
        cities: [
          { city_id: FIXTURE_CITY_ID_1, is_primary: true },
          { city_id: FIXTURE_CITY_ID_2, is_primary: false },
        ],
        city_count: 2,
      }),
    );

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/cities`,
      payload: {
        cityIds: [FIXTURE_CITY_ID_1, FIXTURE_CITY_ID_2],
        primaryCityId: FIXTURE_CITY_ID_1,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect((body['cities'] as unknown[]).length).toBe(2);
    expect(body['primary_city_id']).toBe(FIXTURE_CITY_ID_1);
  });

  it('retorna 400 quando cityIds está vazio', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/cities`,
      payload: { cityIds: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando primaryCityId não está em cityIds', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/cities`,
      payload: {
        cityIds: [FIXTURE_CITY_ID_1],
        primaryCityId: FIXTURE_CITY_ID_2,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 404 quando agente não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockSetAgentCities.mockRejectedValue(new NotFoundError('Agente não encontrado'));

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/agents/${FIXTURE_AGENT_ID}/cities`,
      payload: { cityIds: [FIXTURE_CITY_ID_1] },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// RBAC — autenticação e autorização
// ---------------------------------------------------------------------------

describe('RBAC — agentes', () => {
  it('retorna 403 quando usuário sem agents:manage acessa GET /api/admin/agents', async () => {
    const restrictedApp = await buildTestApp(['leads:read']);
    mockListAgents.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await restrictedApp.inject({ method: 'GET', url: '/api/admin/agents' });

    expect(res.statusCode).toBe(403);
    expect(res.json<Record<string, unknown>>()['error']).toBe('FORBIDDEN');
    await restrictedApp.close();
  });

  it('retorna 403 quando request.user não está definido (authenticate não rodou)', async () => {
    const noUserApp = await buildTestApp([], false);

    const res = await noUserApp.inject({ method: 'GET', url: '/api/admin/agents' });

    expect([401, 403]).toContain(res.statusCode);
    await noUserApp.close();
  });

  it('repassa cityScopeIds ao service quando usuário tem escopo limitado', async () => {
    const scopedIds = [FIXTURE_CITY_ID_1];
    const scopedApp = await buildTestApp(['agents:manage'], true, scopedIds);

    mockListAgents.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    const res = await scopedApp.inject({ method: 'GET', url: '/api/admin/agents' });

    expect(res.statusCode).toBe(200);
    expect(mockListAgents).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cityScopeIds: scopedIds }),
    );
    await scopedApp.close();
  });
});
