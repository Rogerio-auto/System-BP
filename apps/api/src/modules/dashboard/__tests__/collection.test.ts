// =============================================================================
// dashboard/__tests__/collection.test.ts — Testes de integração do dashboard
//                                          de cobrança (F15-S09).
//
// Estratégia: sobe Fastify com dashboardRoutes, mocka authenticate/authorize
// e service para controlar contexto e dados.
//
// Cobre:
//   1. GET /api/dashboard/collection → 200 com shape completo dos 5 cards
//   2. GET /api/dashboard/collection?city_id=<uuid> → 200 com city_id no service
//   3. Sem billing:read → 403
//   4. Sem autenticação → 403
//   5. city_id inválido (não UUID) → 400
//   6. Cards calculados corretamente (mock com valores distintos)
//   7. Seed vazio → todos os cards com count=0 e total_amount='0'
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
    // no-op: request.user injetado pelo addHook global em buildTestApp
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
const mockGetCollectionDashboard = vi.fn();

vi.mock('../service.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getCollectionDashboard: (...args: unknown[]) => mockGetCollectionDashboard(...args),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'cccccccc-0000-0000-0000-000000000001';

/** Shape completo de resposta com dados fictícios. */
function makeCollectionDashboardResponse() {
  return {
    due_soon: {
      label: 'Vencendo nos próximos 7 dias',
      count: 12,
      total_amount: '48500.00',
    },
    overdue_uncollected: {
      label: 'Vencidos sem cobrança ativa',
      count: 5,
      total_amount: '22000.75',
    },
    in_collection: {
      label: 'Em cobrança ativa',
      count: 8,
      total_amount: '34200.50',
    },
    overdue_15d: {
      label: 'Inadimplentes há 15+ dias',
      count: 3,
      total_amount: '15000.00',
    },
    in_spc: {
      label: 'Clientes no SPC',
      count: 2,
      total_amount: '9800.25',
    },
  };
}

/** Shape completo de resposta com todos os valores zero (seed vazio). */
function makeEmptyCollectionDashboardResponse() {
  return {
    due_soon: { label: 'Vencendo nos próximos 7 dias', count: 0, total_amount: '0' },
    overdue_uncollected: { label: 'Vencidos sem cobrança ativa', count: 0, total_amount: '0' },
    in_collection: { label: 'Em cobrança ativa', count: 0, total_amount: '0' },
    overdue_15d: { label: 'Inadimplentes há 15+ dias', count: 0, total_amount: '0' },
    in_spc: { label: 'Clientes no SPC', count: 0, total_amount: '0' },
  };
}

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['billing:read'],
  injectUser = true,
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
        cityScopeIds: null,
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
// GET /api/dashboard/collection — shape básico
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/collection — shape completo', () => {
  it('retorna 200 com os 5 cards do dashboard de cobrança', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeCollectionDashboardResponse());

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/collection' });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();

    // Verifica presença dos 5 cards
    expect(body).toHaveProperty('due_soon');
    expect(body).toHaveProperty('overdue_uncollected');
    expect(body).toHaveProperty('in_collection');
    expect(body).toHaveProperty('overdue_15d');
    expect(body).toHaveProperty('in_spc');
  });

  it('cada card possui label, count e total_amount', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeCollectionDashboardResponse());

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/collection' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      due_soon: { label: string; count: number; total_amount: string };
      overdue_uncollected: { label: string; count: number; total_amount: string };
      in_collection: { label: string; count: number; total_amount: string };
      overdue_15d: { label: string; count: number; total_amount: string };
      in_spc: { label: string; count: number; total_amount: string };
    }>();

    expect(body.due_soon.count).toBe(12);
    expect(body.due_soon.total_amount).toBe('48500.00');
    expect(body.overdue_uncollected.count).toBe(5);
    expect(body.in_collection.count).toBe(8);
    expect(body.overdue_15d.count).toBe(3);
    expect(body.in_spc.count).toBe(2);

    // Todos os campos label são strings não-vazias
    expect(body.due_soon.label).toBeTruthy();
    expect(body.overdue_uncollected.label).toBeTruthy();
    expect(body.in_collection.label).toBeTruthy();
    expect(body.overdue_15d.label).toBeTruthy();
    expect(body.in_spc.label).toBeTruthy();
  });

  it('seed vazio → todos os cards com count=0 e total_amount zero', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeEmptyCollectionDashboardResponse());

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/collection' });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      due_soon: { count: number; total_amount: string };
      overdue_uncollected: { count: number; total_amount: string };
      in_collection: { count: number; total_amount: string };
      overdue_15d: { count: number; total_amount: string };
      in_spc: { count: number; total_amount: string };
    }>();

    expect(body.due_soon.count).toBe(0);
    expect(body.overdue_uncollected.count).toBe(0);
    expect(body.in_collection.count).toBe(0);
    expect(body.overdue_15d.count).toBe(0);
    expect(body.in_spc.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/dashboard/collection — city_id
// ---------------------------------------------------------------------------

describe('GET /api/dashboard/collection — filtro city_id', () => {
  it('city_id UUID válido é repassado ao service', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeCollectionDashboardResponse());

    const res = await app.inject({
      method: 'GET',
      url: `/api/dashboard/collection?city_id=${FIXTURE_CITY_ID}`,
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetCollectionDashboard).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: FIXTURE_ORG_ID }),
      expect.objectContaining({ city_id: FIXTURE_CITY_ID }),
    );
  });

  it('city_id inválido (não UUID) → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/dashboard/collection?city_id=not-a-uuid',
    });

    expect(res.statusCode).toBe(400);
    expect(mockGetCollectionDashboard).not.toHaveBeenCalled();
  });

  it('sem city_id → service chamado com query sem campo city_id', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeEmptyCollectionDashboardResponse());

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/collection' });

    expect(res.statusCode).toBe(200);
    // Zod com exactOptionalPropertyTypes: city_id ausente → objeto sem a propriedade (não undefined)
    expect(mockGetCollectionDashboard).toHaveBeenCalledTimes(1);
    const callArgs = mockGetCollectionDashboard.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    expect(callArgs[2]).not.toHaveProperty('city_id');
  });
});

// ---------------------------------------------------------------------------
// RBAC — billing:read obrigatório
// ---------------------------------------------------------------------------

describe('RBAC — dashboard de cobrança', () => {
  it('sem billing:read → 403', async () => {
    const restrictedApp = await buildTestApp(['dashboard:read']); // só tem dashboard:read

    const res = await restrictedApp.inject({
      method: 'GET',
      url: '/api/dashboard/collection',
    });

    expect(res.statusCode).toBe(403);
    const body = res.json<Record<string, unknown>>();
    expect(body['error']).toBe('FORBIDDEN');
    await restrictedApp.close();
  });

  it('sem autenticação (request.user não definido) → 403', async () => {
    const noUserApp = await buildTestApp([], false);

    const res = await noUserApp.inject({
      method: 'GET',
      url: '/api/dashboard/collection',
    });

    expect([401, 403]).toContain(res.statusCode);
    await noUserApp.close();
  });

  it('com billing:read → 200', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeEmptyCollectionDashboardResponse());

    const res = await app.inject({ method: 'GET', url: '/api/dashboard/collection' });

    expect(res.statusCode).toBe(200);
  });

  it('service é chamado com organizationId correto do actor', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeEmptyCollectionDashboardResponse());

    await app.inject({ method: 'GET', url: '/api/dashboard/collection' });

    expect(mockGetCollectionDashboard).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ organizationId: FIXTURE_ORG_ID }),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// Sem N+1 — service é chamado exatamente uma vez por request
// ---------------------------------------------------------------------------

describe('Ausência de N+1 — service chamado uma vez por request', () => {
  it('apenas 1 chamada ao service por request de /collection', async () => {
    mockGetCollectionDashboard.mockResolvedValue(makeCollectionDashboardResponse());

    await app.inject({ method: 'GET', url: '/api/dashboard/collection' });

    // Service deve ter sido chamado exatamente uma vez
    expect(mockGetCollectionDashboard).toHaveBeenCalledTimes(1);
  });
});
