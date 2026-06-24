// collection-scope.test.ts -- F23-S02
// Isolamento: gestor_regional com billing:read so ve cobranca da propria cidade.

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ForbiddenError, isAppError } from '../../../shared/errors.js';
import { dashboardRoutes } from '../routes.js';

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
vi.mock('../../auth/middlewares/authenticate.js', () => ({ authenticate: () => async () => {} }));
vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize:
    (opts: { permissions: string[] }) =>
    async (req: { user?: { permissions: string[] } }, _r: unknown) => {
      const { ForbiddenError: E } = await import('../../../shared/errors.js');
      if (!req.user) throw new E('Nao autenticado');
      if (opts.permissions.some((p) => !req.user!.permissions.includes(p))) throw new E('Negado');
    },
}));
vi.mock('../../../db/client.js', () => ({ db: {}, pool: { end: vi.fn() } }));
const mockGetCollectionDashboard = vi.fn();
vi.mock('../service.js', async (orig) => {
  const a = (await orig()) as Record<string, unknown>;
  return {
    ...a,
    getCollectionDashboard: (...args: unknown[]) => mockGetCollectionDashboard(...args),
  };
});
const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const FIXTURE_CITY_PROPRIA = 'cccccccc-0000-0000-0000-000000000010';
const FIXTURE_CITY_ALHEIA = 'cccccccc-0000-0000-0000-000000000099';
const EC = () => ({
  due_soon: { label: 'v7d', count: 0, total_amount: '0' },
  overdue_uncollected: { label: 'vnc', count: 0, total_amount: '0' },
  in_collection: { label: 'atv', count: 0, total_amount: '0' },
  overdue_15d: { label: '15d', count: 0, total_amount: '0' },
  in_spc: { label: 'spc', count: 0, total_amount: '0' },
});
function chk(s: string[] | null, c: string | undefined): void {
  if (c === undefined || s === null) return;
  if (!s.includes(c)) throw new ForbiddenError('Cidade fora do escopo');
}
async function bld(o: {
  permissions?: string[];
  cityScopeIds?: string[] | null;
  injectUser?: boolean;
}): Promise<FastifyInstance> {
  const {
    permissions = ['billing:read'],
    cityScopeIds = [FIXTURE_CITY_PROPRIA],
    injectUser = true,
  } = o;
  const app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  if (injectUser)
    app.addHook('preHandler', async (r) => {
      r.user = { id: FIXTURE_USER_ID, organizationId: FIXTURE_ORG_ID, permissions, cityScopeIds };
    });
  app.setErrorHandler((e, _, reply) => {
    if (isAppError(e)) {
      const b: Record<string, unknown> = { error: e.code, message: e.message };
      if (e.details !== undefined) b['details'] = e.details;
      return reply.status(e.statusCode).send(b);
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'err' });
  });
  await app.register(dashboardRoutes);
  return app;
}
let app: FastifyInstance;
beforeAll(async () => {
  app = await bld({ permissions: ['billing:read'], cityScopeIds: [FIXTURE_CITY_PROPRIA] });
}, 30000);
afterAll(async () => {
  await app.close();
});
describe('gestor_regional com billing:read - acesso a propria cidade', () => {
  it('retorna 200 ao acessar propria cidade', async () => {
    mockGetCollectionDashboard.mockResolvedValue(EC());
    const r = await app.inject({
      method: 'GET',
      url: '/api/dashboard/collection?city_id=' + FIXTURE_CITY_PROPRIA,
    });
    expect(r.statusCode).toBe(200);
    expect(mockGetCollectionDashboard).toHaveBeenCalledTimes(1);
    const c = mockGetCollectionDashboard.mock.calls[0] as [
      unknown,
      { cityScopeIds: string[] | null },
      { city_id?: string },
    ];
    expect(c[1].cityScopeIds).toEqual([FIXTURE_CITY_PROPRIA]);
    expect(c[2]).toMatchObject({ city_id: FIXTURE_CITY_PROPRIA });
    vi.clearAllMocks();
  });
  it('sem city_id: cityScopeIds escopado chega ao service', async () => {
    mockGetCollectionDashboard.mockResolvedValue(EC());
    const r = await app.inject({ method: 'GET', url: '/api/dashboard/collection' });
    expect(r.statusCode).toBe(200);
    const c = mockGetCollectionDashboard.mock.calls[0] as [
      unknown,
      { cityScopeIds: string[] | null },
      Record<string, unknown>,
    ];
    expect(c[1].cityScopeIds).toEqual([FIXTURE_CITY_PROPRIA]);
    vi.clearAllMocks();
  });
});

describe('gestor_regional com billing:read - city_id fora do escopo', () => {
  it('city_id de cidade alheia retorna 403', async () => {
    mockGetCollectionDashboard.mockImplementation(
      (_d: unknown, a: { cityScopeIds: string[] | null }, q: { city_id?: string }) => {
        chk(a.cityScopeIds, q.city_id);
        return Promise.resolve(EC());
      },
    );
    const r = await app.inject({
      method: 'GET',
      url: '/api/dashboard/collection?city_id=' + FIXTURE_CITY_ALHEIA,
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('FORBIDDEN');
    vi.clearAllMocks();
  });
  it('cityScopeIds=[] nao acessa nenhuma cidade', async () => {
    const es = await bld({ permissions: ['billing:read'], cityScopeIds: [] });
    mockGetCollectionDashboard.mockImplementation(
      (_d: unknown, a: { cityScopeIds: string[] | null }, q: { city_id?: string }) => {
        chk(a.cityScopeIds, q.city_id);
        return Promise.resolve(EC());
      },
    );
    const r = await es.inject({
      method: 'GET',
      url: '/api/dashboard/collection?city_id=' + FIXTURE_CITY_PROPRIA,
    });
    expect(r.statusCode).toBe(403);
    await es.close();
    vi.clearAllMocks();
  });
});

describe('gestor_regional SEM billing:read', () => {
  it('permissao ausente bloqueia acesso ao dashboard de cobranca', async () => {
    const n = await bld({ permissions: ['dashboard:read'], cityScopeIds: [FIXTURE_CITY_PROPRIA] });
    const r = await n.inject({ method: 'GET', url: '/api/dashboard/collection' });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('FORBIDDEN');
    await n.close();
  });
});

describe('admin com cityScopeIds=null - sem restricao', () => {
  it('admin acessa qualquer cidade: service recebe cityScopeIds=null', async () => {
    const adm = await bld({ permissions: ['billing:read'], cityScopeIds: null });
    mockGetCollectionDashboard.mockResolvedValue(EC());
    const r = await adm.inject({
      method: 'GET',
      url: '/api/dashboard/collection?city_id=' + FIXTURE_CITY_ALHEIA,
    });
    expect(r.statusCode).toBe(200);
    const c = mockGetCollectionDashboard.mock.calls[0] as [
      unknown,
      { cityScopeIds: string[] | null },
      unknown,
    ];
    expect(c[1].cityScopeIds).toBeNull();
    await adm.close();
    vi.clearAllMocks();
  });
});
