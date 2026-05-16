// =============================================================================
// dashboard/__tests__/routes.test.ts — Testes de integração (F8-S03).
//
// Estratégia: sobe Fastify com dashboardRoutes, mocka authenticate/authorize
// e service para controlar contexto e dados.
//
// Cobre:
//   1.  GET /api/dashboard/metrics                        → 200 shape completo
//   2.  GET /api/dashboard/metrics?range=today            → 200 range 'today'
//   3.  GET /api/dashboard/metrics?range=7d               → 200 range '7d'
//   4.  GET /api/dashboard/metrics?range=mtd              → 200 range 'mtd'
//   5.  GET /api/dashboard/metrics?range=ytd              → 200 range 'ytd'
//   6.  GET /api/dashboard/metrics?range=30d              → 200 range '30d'
//   7.  GET /api/dashboard/metrics?cityId=<uuid>          → 200 cityId no escopo
//   8.  GET /api/dashboard/metrics?cityId=<uuid>          → 403 cityId fora do escopo
//   9.  GET /api/dashboard/metrics (seed vazio)           → 200 todos arrays vazios
//   10. Sem auth → 403
//   11. Sem permissão dashboard:read → 403
//   12. City scope: agente com escopo limitado passa cityScopeIds corretamente
// =============================================================================
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isAppError } from '../../../shared/errors.js';
import { dashboardRoutes } from '../routes.js';

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
const mockGetDashboardMetrics = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getDashboardMetrics: (...args: unknown[]) => mockGetDashboardMetrics(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_1 = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID_2 = 'cccccccc-0000-0000-0000-000000000002';
const FIXTURE_STAGE_ID_1 = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_AGENT_ID_1 = 'eeeeeeee-0000-0000-0000-000000000001';

/** Shape completo de resposta com todos os arrays vazios (seed vazio). */
function makeEmptyMetricsResponse() {
  return {
    range: {
      from: new Date().toISOString(),
      to: new Date().toISOString(),
      label: 'Últimos 30 dias',
    },
    leads: {
      total: 0,
      newInRange: 0,
      byStatus: [],
      byCity: [],
      bySource: [],
      staleCount: 0,
    },
    interactions: {
      totalInRange: 0,
      byChannel: [],
      inboundOutboundRatio: { inbound: 0, outbound: 0 },
    },
    kanban: {
      cardsByStage: [],
      avgDaysInStage: [],
    },
    agents: {
      topByLeadsClosed: [],
    },
  };
}

/** Shape completo de resposta com dados fictícios. */
function makeMetricsResponse() {
  return {
    range: {
      from: new Date().toISOString(),
      to: new Date().toISOString(),
      label: 'Últimos 30 dias',
    },
    leads: {
      total: 42,
      newInRange: 10,
      byStatus: [
        { status: 'new', count: 20 },
        { status: 'qualifying', count: 12 },
      ],
      byCity: [{ cityId: FIXTURE_CITY_ID_1, cityName: 'Porto Velho', count: 42 }],
      bySource: [
        { source: 'whatsapp', count: 30 },
        { source: 'manual', count: 12 },
      ],
      staleCount: 5,
    },
    interactions: {
      totalInRange: 88,
      byChannel: [
        { channel: 'whatsapp', count: 60 },
        { channel: 'phone', count: 28 },
      ],
      inboundOutboundRatio: { inbound: 50, outbound: 38 },
    },
    kanban: {
      cardsByStage: [{ stageId: FIXTURE_STAGE_ID_1, stageName: 'Pré-atendimento', count: 20 }],
      avgDaysInStage: [{ stageId: FIXTURE_STAGE_ID_1, days: 3.5 }],
    },
    agents: {
      topByLeadsClosed: [{ agentId: FIXTURE_AGENT_ID_1, displayName: 'João Silva', closedWon: 8 }],
    },
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['dashboard:read'],
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

  await app.register(dashboardRoutes);
  return app;
}

// ---------------------------------------------------------------------------
// Shared app
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
// GET /api/dashboard/metrics — ranges
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/metrics — range default (30d)', () => {
  it('retorna 200 com shape completo no range padrão', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeMetricsResponse());

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/metrics' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toHaveProperty('range');
    expect(body).toHaveProperty('leads');
    expect(body).toHaveProperty('interactions');
    expect(body).toHaveProperty('kanban');
    expect(body).toHaveProperty('agents');

    // Verificar que service foi chamado com range default '30d'
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: FIXTURE_ORG_ID }),
      expect.objectContaining({ range: '30d' }),
    );
  });

  it('range=today passa corretamente ao service', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeEmptyMetricsResponse());

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics?range=today',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ range: 'today' }),
    );
  });

  it('range=7d passa corretamente ao service', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeEmptyMetricsResponse());

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics?range=7d',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ range: '7d' }),
    );
  });

  it('range=mtd passa corretamente ao service', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeEmptyMetricsResponse());

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics?range=mtd',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ range: 'mtd' }),
    );
  });

  it('range=ytd passa corretamente ao service', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeEmptyMetricsResponse());

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics?range=ytd',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ range: 'ytd' }),
    );
  });

  it('range=30d explícito passa corretamente ao service', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeEmptyMetricsResponse());

    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/metrics?range=30d',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ range: '30d' }),
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/metrics — cityId
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/metrics — cityId scope', () => {
  it('cityId no escopo → 200 (service retorna normalmente)', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeMetricsResponse());

    const res = await app.inject({
      method: 'GET',
      url: `/api/dashboard/metrics?cityId=${FIXTURE_CITY_ID_1}`,
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cityId: FIXTURE_CITY_ID_1 }),
    );
  });

  it('cityId fora do escopo → 403 (service lança ForbiddenError)', async () => {
    const { ForbiddenError } = await import('../../../shared/errors.js');
    mockGetDashboardMetrics.mockRejectedValue(
      new ForbiddenError('Acesso negado: cidade não está no escopo do usuário'),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/dashboard/metrics?cityId=${FIXTURE_CITY_ID_2}`,
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('FORBIDDEN');
  });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/metrics — seed vazio
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/metrics — seed vazio', () => {
  it('retorna 200 com todos os arrays vazios e contagens zero', async () => {
    mockGetDashboardMetrics.mockResolvedValue(makeEmptyMetricsResponse());

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/metrics' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      leads: { total: number; byStatus: unknown[]; byCity: unknown[] };
      interactions: { totalInRange: number; byChannel: unknown[] };
      kanban: { cardsByStage: unknown[] };
      agents: { topByLeadsClosed: unknown[] };
    }>();

    expect(body.leads.total).toBe(0);
    expect(body.leads.byStatus).toEqual([]);
    expect(body.leads.byCity).toEqual([]);
    expect(body.interactions.totalInRange).toBe(0);
    expect(body.interactions.byChannel).toEqual([]);
    expect(body.kanban.cardsByStage).toEqual([]);
    expect(body.agents.topByLeadsClosed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// RBAC — autenticação e autorização
// ---------------------------------------------------------------------------

describe('RBAC — dashboard', () => {
  it('retorna 403 quando usuário sem dashboard:read acessa GET /api/dashboard/metrics', async () => {
    const restrictedApp = await buildTestApp(['leads:read']);

    const res = await restrictedApp.inject({
      method: 'GET',
      url: '/api/dashboard/metrics',
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('FORBIDDEN');
    await restrictedApp.close();
  });

  it('retorna 403 quando request.user não está definido (authenticate não rodou)', async () => {
    const noUserApp = await buildTestApp([], false);

    const res = await noUserApp.inject({
      method: 'GET',
      url: '/api/dashboard/metrics',
    });

    expect([401, 403]).toContain(res.statusCode);
    await noUserApp.close();
  });

  it('repassa cityScopeIds ao service quando usuário tem escopo limitado', async () => {
    const scopedIds = [FIXTURE_CITY_ID_1];
    const scopedApp = await buildTestApp(['dashboard:read'], true, scopedIds);

    mockGetDashboardMetrics.mockResolvedValue(makeEmptyMetricsResponse());

    const res = await scopedApp.inject({
      method: 'GET',
      url: '/api/dashboard/metrics',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetDashboardMetrics).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cityScopeIds: scopedIds }),
      expect.anything(),
    );
    await scopedApp.close();
  });
});
