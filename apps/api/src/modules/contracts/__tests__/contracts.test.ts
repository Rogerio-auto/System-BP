// =============================================================================
// contracts/__tests__/contracts.test.ts — Testes de integração (F17-S03).
//
// Estratégia: sobe Fastify com contractsRoutes, mocka authenticate/authorize
// e service. Sem acesso real ao banco.
//
// Cobre (DoD F17-S03):
//   1.  GET /api/contracts → 200 lista de contratos
//   2.  POST /api/contracts → 201 contrato criado
//   3.  GET /api/contracts/:id → 200 detalhe
//   4.  POST /api/contracts/:id/sign → 200 transição draft→signed (+ signed_at)
//   5.  POST /api/contracts/:id/sign → 422 transição inválida
//   6.  RBAC negativo: sem contracts:read → 403
//   7.  City-scope: contrato de cliente de outra cidade → 404
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
const mockListContractsService = vi.fn();
const mockCreateContractService = vi.fn();
const mockGetContractService = vi.fn();
const mockSignContractService = vi.fn();

vi.mock('../service.js', () => ({
  listContractsService: (...args: unknown[]) => mockListContractsService(...args),
  createContractService: (...args: unknown[]) => mockCreateContractService(...args),
  getContractService: (...args: unknown[]) => mockGetContractService(...args),
  signContractService: (...args: unknown[]) => mockSignContractService(...args),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CONTRACT_ID = 'c0000001-0000-0000-0000-000000000001';
const ORG_ID = 'c0000002-0000-0000-0000-000000000002';
const CUSTOMER_ID = 'c0000003-0000-0000-0000-000000000003';
const USER_ID = 'c0000004-0000-0000-0000-000000000004';
const CITY_ID = 'c0000005-0000-0000-0000-000000000005';

const ALL_PERMISSIONS = ['contracts:read', 'contracts:write', 'contracts:sign'];

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_PERMISSIONS,
  cityScopeIds: [CITY_ID] as string[] | null,
};

const NOW = '2026-06-15T10:00:00.000Z';

const SAMPLE_CONTRACT_DRAFT = {
  id: CONTRACT_ID,
  organization_id: ORG_ID,
  customer_id: CUSTOMER_ID,
  contract_reference: 'BP-2026-00123',
  product_id: null,
  rule_version_id: null,
  principal_amount: '15000.00',
  term_months: 24,
  monthly_rate_snapshot: '0.024500',
  status: 'draft' as const,
  signed_at: null,
  first_due_date: null,
  last_due_date: null,
  created_at: NOW,
  updated_at: NOW,
};

const SAMPLE_CONTRACT_SIGNED = {
  ...SAMPLE_CONTRACT_DRAFT,
  status: 'signed' as const,
  signed_at: NOW,
};

const VALID_CREATE_BODY = {
  customer_id: CUSTOMER_ID,
  contract_reference: 'BP-2026-00123',
  principal_amount: '15000.00',
  term_months: 24,
  monthly_rate_snapshot: '0.024500',
};

// ---------------------------------------------------------------------------
// App factory de teste
// ---------------------------------------------------------------------------

type TestUser = typeof TEST_USER;

/**
 * AppError-compatible error handler para testes que precisam de 4xx/5xx reais.
 * Deve ser registrado ANTES de ready() para que Fastify aceite.
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

  await typedApp.register(contractsRoutes);
  await typedApp.ready();
  return typedApp;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('Contracts Module — F17-S03', () => {
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

  // ---- GET /api/contracts -------------------------------------------------------

  describe('GET /api/contracts', () => {
    it('1. retorna lista de contratos (200)', async () => {
      mockListContractsService.mockResolvedValue({
        data: [SAMPLE_CONTRACT_DRAFT],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      const res = await app.inject({ method: 'GET', url: '/api/contracts' });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: (typeof SAMPLE_CONTRACT_DRAFT)[]; pagination: unknown }>();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]?.id).toBe(CONTRACT_ID);
      expect(body.data[0]?.status).toBe('draft');
      expect(mockListContractsService).toHaveBeenCalledOnce();
    });

    it('6. RBAC negativo: sem contracts:read → 403', async () => {
      const noReadUser = { ...TEST_USER, permissions: ['contracts:write'] };
      const appNoRead = await buildTestApp(noReadUser);

      const res = await appNoRead.inject({ method: 'GET', url: '/api/contracts' });

      expect(res.statusCode).toBe(403);
      await appNoRead.close();
    });

    it('filtra por status via query param', async () => {
      mockListContractsService.mockResolvedValue({
        data: [SAMPLE_CONTRACT_SIGNED],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

      const res = await app.inject({ method: 'GET', url: '/api/contracts?status=signed' });

      expect(res.statusCode).toBe(200);
      expect(mockListContractsService).toHaveBeenCalledWith(
        expect.anything(), // db
        ORG_ID,
        [CITY_ID],
        expect.objectContaining({ status: 'signed' }),
      );
    });
  });

  // ---- POST /api/contracts -------------------------------------------------------

  describe('POST /api/contracts', () => {
    it('2. cria contrato draft (201)', async () => {
      mockCreateContractService.mockResolvedValue(SAMPLE_CONTRACT_DRAFT);

      const res = await app.inject({
        method: 'POST',
        url: '/api/contracts',
        payload: VALID_CREATE_BODY,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<typeof SAMPLE_CONTRACT_DRAFT>();
      expect(body.id).toBe(CONTRACT_ID);
      expect(body.status).toBe('draft');
      expect(body.signed_at).toBeNull();
      expect(mockCreateContractService).toHaveBeenCalledOnce();
    });

    it('retorna 400 para body inválido (sem customer_id)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contracts',
        payload: { contract_reference: 'BP-001', principal_amount: '1000.00', term_months: 12 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('retorna 400 para principal_amount inválido', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/contracts',
        payload: { ...VALID_CREATE_BODY, principal_amount: 'abc' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('RBAC negativo: sem contracts:write → 403', async () => {
      const noWriteUser = { ...TEST_USER, permissions: ['contracts:read'] };
      const appNoWrite = await buildTestApp(noWriteUser);

      const res = await appNoWrite.inject({
        method: 'POST',
        url: '/api/contracts',
        payload: VALID_CREATE_BODY,
      });

      expect(res.statusCode).toBe(403);
      await appNoWrite.close();
    });
  });

  // ---- GET /api/contracts/:id -------------------------------------------------------

  describe('GET /api/contracts/:id', () => {
    it('3. retorna detalhe do contrato (200)', async () => {
      mockGetContractService.mockResolvedValue(SAMPLE_CONTRACT_DRAFT);

      const res = await app.inject({ method: 'GET', url: `/api/contracts/${CONTRACT_ID}` });

      expect(res.statusCode).toBe(200);
      const body = res.json<typeof SAMPLE_CONTRACT_DRAFT>();
      expect(body.id).toBe(CONTRACT_ID);
      expect(body.contract_reference).toBe('BP-2026-00123');
    });

    it('7. city-scope: contrato de cliente de outra cidade → 404', async () => {
      const { NotFoundError } = await import('../../../shared/errors.js');
      mockGetContractService.mockRejectedValue(new NotFoundError('Contrato não encontrado'));

      // Usuário sem escopo de cidade alguma — error handler registrado antes de ready()
      const userNoCity = { ...TEST_USER, cityScopeIds: [] as string[] | null };
      const appNoCity = await buildTestApp(userNoCity, true);

      const res = await appNoCity.inject({
        method: 'GET',
        url: `/api/contracts/${CONTRACT_ID}`,
      });

      expect(res.statusCode).toBe(404);
      await appNoCity.close();
    });

    it('RBAC negativo: sem contracts:read → 403', async () => {
      const noReadUser = { ...TEST_USER, permissions: ['contracts:sign'] };
      const appNoRead = await buildTestApp(noReadUser);

      const res = await appNoRead.inject({
        method: 'GET',
        url: `/api/contracts/${CONTRACT_ID}`,
      });

      expect(res.statusCode).toBe(403);
      await appNoRead.close();
    });
  });

  // ---- POST /api/contracts/:id/sign -------------------------------------------------------

  describe('POST /api/contracts/:id/sign', () => {
    it('4. sign: transição draft→signed, signed_at preenchido (200)', async () => {
      mockSignContractService.mockResolvedValue(SAMPLE_CONTRACT_SIGNED);

      const res = await app.inject({
        method: 'POST',
        url: `/api/contracts/${CONTRACT_ID}/sign`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<typeof SAMPLE_CONTRACT_SIGNED>();
      expect(body.status).toBe('signed');
      expect(body.signed_at).toBe(NOW);
      expect(mockSignContractService).toHaveBeenCalledWith(
        expect.anything(), // db
        ORG_ID,
        CONTRACT_ID,
        [CITY_ID],
        expect.objectContaining({ userId: USER_ID }),
      );
    });

    it('5. sign: transição inválida → 422', async () => {
      const { AppError } = await import('../../../shared/errors.js');
      mockSignContractService.mockRejectedValue(
        new AppError(
          422,
          'VALIDATION_ERROR',
          "Transição de status inválida: 'active' → Não permitido",
        ),
      );

      // Error handler registrado antes de ready() via withErrorHandler = true
      const appWithErrorHandler = await buildTestApp(TEST_USER, true);

      const res = await appWithErrorHandler.inject({
        method: 'POST',
        url: `/api/contracts/${CONTRACT_ID}/sign`,
      });

      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: string; message: string }>();
      expect(body.error).toBe('VALIDATION_ERROR');
      await appWithErrorHandler.close();
    });

    it('RBAC negativo: sem contracts:sign → 403', async () => {
      const noSignUser = { ...TEST_USER, permissions: ['contracts:read', 'contracts:write'] };
      const appNoSign = await buildTestApp(noSignUser);

      const res = await appNoSign.inject({
        method: 'POST',
        url: `/api/contracts/${CONTRACT_ID}/sign`,
      });

      expect(res.statusCode).toBe(403);
      await appNoSign.close();
    });
  });
});
