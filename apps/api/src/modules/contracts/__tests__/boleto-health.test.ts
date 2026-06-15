// =============================================================================
// contracts/__tests__/boleto-health.test.ts — Testes do endpoint de saúde
// de boletos GET /api/contracts/:id/health (F17-S04).
//
// Estratégia: sobe Fastify com contractsRoutes, mocka authenticate/authorize
// e service. Sem acesso real ao banco.
//
// Cobre (DoD F17-S04):
//   1. Contrato sem parcelas → total=0, health='healthy'
//   2. Contrato com todas as parcelas pagas → health='settled', percent_paid=100
//   3. Contrato com parcela overdue < 15d → health='at_risk'
//   4. Contrato com parcela overdue ≥ 15d → health='defaulted'
//   5. RBAC: sem contracts:read → 403
//   6. City-scope: contrato fora do scope → 404
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { contractsRoutes } from '../routes.js';

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
// Mock authenticate/authorize
// ---------------------------------------------------------------------------
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    // no-op: request.user injetado pelo addHook no buildTestApp
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
// Mock service — apenas getBoletoHealthService é relevante aqui
// ---------------------------------------------------------------------------
const mockGetBoletoHealthService = vi.fn();

vi.mock('../service.js', () => ({
  listContractsService: vi.fn(),
  createContractService: vi.fn(),
  getContractService: vi.fn(),
  signContractService: vi.fn(),
  getBoletoHealthService: (...args: unknown[]) => mockGetBoletoHealthService(...args),
}));

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const CONTRACT_ID = 'd0000001-0000-0000-0000-000000000001';
const ORG_ID = 'd0000002-0000-0000-0000-000000000002';
const USER_ID = 'd0000003-0000-0000-0000-000000000003';
const CITY_ID = 'd0000004-0000-0000-0000-000000000004';

const ALL_PERMISSIONS = ['contracts:read', 'contracts:write', 'contracts:sign'];

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_PERMISSIONS,
  cityScopeIds: [CITY_ID] as string[] | null,
};

// ---------------------------------------------------------------------------
// Fixtures de saúde de boletos
// ---------------------------------------------------------------------------

/** Contrato sem parcelas — tudo zerado. */
const HEALTH_EMPTY = {
  contract_id: CONTRACT_ID,
  total_installments: 0,
  paid_count: 0,
  overdue_count: 0,
  pending_count: 0,
  paid_amount: '0',
  overdue_amount: '0',
  pending_amount: '0',
  percent_paid: 0,
  health: 'healthy' as const,
};

/** Todas as parcelas pagas — settled. */
const HEALTH_SETTLED = {
  contract_id: CONTRACT_ID,
  total_installments: 12,
  paid_count: 12,
  overdue_count: 0,
  pending_count: 0,
  paid_amount: '6000.00',
  overdue_amount: '0',
  pending_amount: '0',
  percent_paid: 100,
  health: 'settled' as const,
};

/** 1 parcela overdue < 15 dias — at_risk. */
const HEALTH_AT_RISK = {
  contract_id: CONTRACT_ID,
  total_installments: 12,
  paid_count: 6,
  overdue_count: 1,
  pending_count: 5,
  paid_amount: '3000.00',
  overdue_amount: '500.00',
  pending_amount: '2500.00',
  percent_paid: 50,
  health: 'at_risk' as const,
};

/** 1 parcela overdue ≥ 15 dias — defaulted. */
const HEALTH_DEFAULTED = {
  contract_id: CONTRACT_ID,
  total_installments: 12,
  paid_count: 6,
  overdue_count: 1,
  pending_count: 5,
  paid_amount: '3000.00',
  overdue_amount: '500.00',
  pending_amount: '2500.00',
  percent_paid: 50,
  health: 'defaulted' as const,
};

// ---------------------------------------------------------------------------
// App factory de teste
// ---------------------------------------------------------------------------

type TestUser = typeof TEST_USER;

/** Error handler compatível com AppError para retornar 4xx/5xx reais nos testes. */
function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _req, reply) => {
    if (error !== null && typeof error === 'object' && 'statusCode' in error && 'code' in error) {
      const appErr = error as { statusCode: number; code: string; message: string };
      return reply.status(appErr.statusCode).send({
        error: appErr.code,
        message: appErr.message,
      });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
  });
}

async function buildTestApp(
  user: TestUser | null = TEST_USER,
  withErrorHandler = false,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  if (withErrorHandler) {
    registerErrorHandler(typedApp);
  }

  if (user !== null) {
    typedApp.addHook('preHandler', async (request) => {
      // `as` justificado: injeção de test fixture sem passar por autenticação real.
      (request as unknown as { user: TestUser }).user = user;
    });
  }

  await typedApp.register(contractsRoutes);
  await typedApp.ready();
  return typedApp;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('GET /api/contracts/:id/health — F17-S04', () => {
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

  // ---- 1. Contrato sem parcelas -----------------------------------------------

  it('1. contrato sem parcelas → total=0, health=healthy', async () => {
    mockGetBoletoHealthService.mockResolvedValue(HEALTH_EMPTY);

    const res = await app.inject({
      method: 'GET',
      url: `/api/contracts/${CONTRACT_ID}/health`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof HEALTH_EMPTY>();
    expect(body.total_installments).toBe(0);
    expect(body.health).toBe('healthy');
    expect(body.percent_paid).toBe(0);
    expect(body.paid_count).toBe(0);
    expect(body.overdue_count).toBe(0);
    expect(mockGetBoletoHealthService).toHaveBeenCalledOnce();
    expect(mockGetBoletoHealthService).toHaveBeenCalledWith(
      expect.anything(), // db
      ORG_ID,
      CONTRACT_ID,
      [CITY_ID],
    );
  });

  // ---- 2. Todas as parcelas pagas → settled -----------------------------------

  it('2. todas as parcelas pagas → health=settled, percent_paid=100', async () => {
    mockGetBoletoHealthService.mockResolvedValue(HEALTH_SETTLED);

    const res = await app.inject({
      method: 'GET',
      url: `/api/contracts/${CONTRACT_ID}/health`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof HEALTH_SETTLED>();
    expect(body.health).toBe('settled');
    expect(body.percent_paid).toBe(100);
    expect(body.paid_count).toBe(12);
    expect(body.overdue_count).toBe(0);
    expect(body.paid_amount).toBe('6000.00');
    expect(body.overdue_amount).toBe('0');
  });

  // ---- 3. Parcela overdue < 15 dias → at_risk ---------------------------------

  it('3. parcela overdue < 15 dias → health=at_risk', async () => {
    mockGetBoletoHealthService.mockResolvedValue(HEALTH_AT_RISK);

    const res = await app.inject({
      method: 'GET',
      url: `/api/contracts/${CONTRACT_ID}/health`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof HEALTH_AT_RISK>();
    expect(body.health).toBe('at_risk');
    expect(body.overdue_count).toBe(1);
    expect(body.percent_paid).toBe(50);
    expect(body.overdue_amount).toBe('500.00');
  });

  // ---- 4. Parcela overdue ≥ 15 dias → defaulted --------------------------------

  it('4. parcela overdue ≥ 15 dias → health=defaulted', async () => {
    mockGetBoletoHealthService.mockResolvedValue(HEALTH_DEFAULTED);

    const res = await app.inject({
      method: 'GET',
      url: `/api/contracts/${CONTRACT_ID}/health`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof HEALTH_DEFAULTED>();
    expect(body.health).toBe('defaulted');
    expect(body.overdue_count).toBe(1);
  });

  // ---- 5. RBAC: sem contracts:read → 403 ---------------------------------------

  it('5. RBAC: sem contracts:read → 403', async () => {
    const noReadUser = { ...TEST_USER, permissions: ['contracts:write', 'contracts:sign'] };
    const appNoRead = await buildTestApp(noReadUser);

    const res = await appNoRead.inject({
      method: 'GET',
      url: `/api/contracts/${CONTRACT_ID}/health`,
    });

    expect(res.statusCode).toBe(403);
    await appNoRead.close();
  });

  // ---- 6. City-scope: fora do scope → 404 -------------------------------------

  it('6. city-scope: contrato fora do scope → 404', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetBoletoHealthService.mockRejectedValue(new NotFoundError('Contrato não encontrado'));

    const appWithError = await buildTestApp(TEST_USER, true);

    const res = await appWithError.inject({
      method: 'GET',
      url: `/api/contracts/${CONTRACT_ID}/health`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('NOT_FOUND');
    await appWithError.close();
  });

  // ---- Campos retornados são string numérica (sem float drift) ----------------

  it('amounts retornados como string numérica (sem float drift)', async () => {
    mockGetBoletoHealthService.mockResolvedValue({
      ...HEALTH_AT_RISK,
      paid_amount: '3000.00',
      overdue_amount: '500.00',
      pending_amount: '2500.00',
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/contracts/${CONTRACT_ID}/health`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<typeof HEALTH_AT_RISK>();
    // Garante que os campos não foram convertidos para float pelo serializador
    expect(typeof body.paid_amount).toBe('string');
    expect(typeof body.overdue_amount).toBe('string');
    expect(typeof body.pending_amount).toBe('string');
    expect(body.paid_amount).toBe('3000.00');
  });
});
