// =============================================================================
// customers/__tests__/overview.test.ts — Testes de integração (F17-S07).
//
// Estratégia: sobe Fastify com customersRoutes, mocka authenticate/authorize
// e service. Sem acesso real ao banco.
//
// Cobre (DoD F17-S07):
//   1. GET /api/customers/:id/overview → 200 com customer + contratos + recent_dues
//   2. Contrato sem parcelas → boleto_health = null
//   3. City-scope: customer de outra cidade → 404
//   4. RBAC: sem contracts:read → 403
//   5. Customer não encontrado → 404
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { customersRoutes } from '../routes.js';

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
    // no-op: request.user injetado pelo addHook global no buildTestApp
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
// Mock service
// ---------------------------------------------------------------------------
const mockGetCustomerOverviewService = vi.fn();

vi.mock('../service.js', () => ({
  getCustomerOverviewService: (...args: unknown[]) => mockGetCustomerOverviewService(...args),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CUSTOMER_ID = 'a0000001-0000-0000-0000-000000000001';
const ORG_ID = 'a0000002-0000-0000-0000-000000000002';
const CONTRACT_ID = 'a0000003-0000-0000-0000-000000000003';
const USER_ID = 'a0000004-0000-0000-0000-000000000004';
const CITY_ID = 'a0000005-0000-0000-0000-000000000005';
const DUE_ID = 'a0000006-0000-0000-0000-000000000006';

const ALL_PERMISSIONS = ['contracts:read'];

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_PERMISSIONS,
  cityScopeIds: [CITY_ID] as string[] | null,
};

const NOW = '2026-06-15T10:00:00.000Z';

const SAMPLE_BOLETO_HEALTH = {
  contract_id: CONTRACT_ID,
  total_installments: 12,
  paid_count: 3,
  overdue_count: 1,
  pending_count: 8,
  paid_amount: '3000.00',
  overdue_amount: '1000.00',
  pending_amount: '8000.00',
  percent_paid: 25,
  health: 'defaulted' as const,
};

const SAMPLE_CONTRACT_WITH_HEALTH = {
  id: CONTRACT_ID,
  organization_id: ORG_ID,
  customer_id: CUSTOMER_ID,
  contract_reference: 'BP-2026-00123',
  product_id: null,
  rule_version_id: null,
  principal_amount: '12000.00',
  term_months: 12,
  monthly_rate_snapshot: '0.024500',
  status: 'active' as const,
  signed_at: NOW,
  first_due_date: '2026-01-15',
  last_due_date: '2026-12-15',
  created_at: NOW,
  updated_at: NOW,
  boleto_health: SAMPLE_BOLETO_HEALTH,
};

const SAMPLE_CONTRACT_NO_DUES = {
  ...SAMPLE_CONTRACT_WITH_HEALTH,
  boleto_health: null,
};

const SAMPLE_DUE = {
  id: DUE_ID,
  contract_reference: 'BP-2026-00123',
  installment_number: 4,
  due_date: '2026-04-15',
  amount: '1000.00',
  status: 'overdue' as const,
  paid_at: null,
};

const SAMPLE_OVERVIEW = {
  customer: {
    id: CUSTOMER_ID,
    organization_id: ORG_ID,
    name: 'João da Silva',
    spc_status: 'included' as const,
    spc_changed_at: NOW,
  },
  contracts: [SAMPLE_CONTRACT_WITH_HEALTH],
  recent_dues: [SAMPLE_DUE],
};

// ---------------------------------------------------------------------------
// App factory de teste
// ---------------------------------------------------------------------------

type TestUser = typeof TEST_USER;

/**
 * AppError-compatible error handler para testes que precisam de 4xx/5xx reais.
 */
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

  await typedApp.register(customersRoutes);
  await typedApp.ready();
  return typedApp;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('Customers Module — F17-S07', () => {
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

  // ---- GET /api/customers/:id/overview ----------------------------------------

  describe('GET /api/customers/:id/overview', () => {
    it('1. retorna customer + contratos + recent_dues para customer válido (200)', async () => {
      mockGetCustomerOverviewService.mockResolvedValue(SAMPLE_OVERVIEW);

      const res = await app.inject({
        method: 'GET',
        url: `/api/customers/${CUSTOMER_ID}/overview`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<typeof SAMPLE_OVERVIEW>();
      expect(body.customer.id).toBe(CUSTOMER_ID);
      expect(body.customer.name).toBe('João da Silva');
      expect(body.customer.spc_status).toBe('included');
      expect(body.contracts).toHaveLength(1);
      expect(body.contracts[0]?.boleto_health).not.toBeNull();
      expect(body.contracts[0]?.boleto_health?.health).toBe('defaulted');
      expect(body.recent_dues).toHaveLength(1);
      expect(body.recent_dues[0]?.status).toBe('overdue');
      expect(mockGetCustomerOverviewService).toHaveBeenCalledOnce();
      expect(mockGetCustomerOverviewService).toHaveBeenCalledWith(
        expect.anything(), // db
        ORG_ID,
        CUSTOMER_ID,
        [CITY_ID],
      );
    });

    it('2. contrato sem parcelas → boleto_health = null', async () => {
      mockGetCustomerOverviewService.mockResolvedValue({
        ...SAMPLE_OVERVIEW,
        contracts: [SAMPLE_CONTRACT_NO_DUES],
        recent_dues: [],
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/customers/${CUSTOMER_ID}/overview`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<typeof SAMPLE_OVERVIEW>();
      expect(body.contracts[0]?.boleto_health).toBeNull();
      expect(body.recent_dues).toHaveLength(0);
    });

    it('3. city-scope: customer de outra cidade → 404', async () => {
      const { NotFoundError } = await import('../../../shared/errors.js');
      mockGetCustomerOverviewService.mockRejectedValue(new NotFoundError('Cliente não encontrado'));
      const appWithErrorHandler = await buildTestApp(TEST_USER, true);

      const res = await appWithErrorHandler.inject({
        method: 'GET',
        url: `/api/customers/${CUSTOMER_ID}/overview`,
      });

      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('NOT_FOUND');
      await appWithErrorHandler.close();
    });

    it('4. RBAC: sem contracts:read → 403', async () => {
      const noReadUser = { ...TEST_USER, permissions: ['billing:read'] };
      const appNoRead = await buildTestApp(noReadUser);

      const res = await appNoRead.inject({
        method: 'GET',
        url: `/api/customers/${CUSTOMER_ID}/overview`,
      });

      expect(res.statusCode).toBe(403);
      await appNoRead.close();
    });

    it('5. customer não encontrado → 404', async () => {
      const { NotFoundError } = await import('../../../shared/errors.js');
      const unknownId = 'b0000000-0000-0000-0000-000000000000';
      mockGetCustomerOverviewService.mockRejectedValue(new NotFoundError('Cliente não encontrado'));
      const appWithErrorHandler = await buildTestApp(TEST_USER, true);

      const res = await appWithErrorHandler.inject({
        method: 'GET',
        url: `/api/customers/${unknownId}/overview`,
      });

      expect(res.statusCode).toBe(404);
      await appWithErrorHandler.close();
    });

    it('UUID inválido no param → 400', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/customers/nao-um-uuid/overview',
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
