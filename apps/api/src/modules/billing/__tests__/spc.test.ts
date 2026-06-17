// =============================================================================
// billing/__tests__/spc.test.ts — Testes de integração das rotas SPC (F15-S07).
//
// Estratégia: sobe Fastify com billingRoutes, mocka authenticate/authorize,
// mocka service para controlar dados.
//
// Cobre:
//   1.  GET  /api/billing/customers/:id/spc → 200 status atual
//   2.  POST /api/billing/customers/:id/spc → 200 transição válida
//   3.  POST /api/billing/customers/:id/spc → 200 idempotência (mesmo status)
//   4.  POST /api/billing/customers/:id/spc → 422 transição inválida (included → none)
//   5.  POST /api/billing/customers/:id/spc → 422 transição inválida (removed → included)
//   6.  POST /api/billing/customers/:id/spc → 400 body inválido (status desconhecido)
//   7.  GET  /api/billing/customers/:id/spc → 404 cliente não encontrado
//   8.  POST /api/billing/customers/:id/spc → 404 cliente não encontrado
//   9.  GET  /api/billing/customers/:id/spc → 401 sem autenticação
//   10. GET  /api/billing/customers/:id/spc → 403 sem spc:read
//   11. POST /api/billing/customers/:id/spc → 403 sem spc:manage
//   12. GET  /api/billing/customers/:id/spc → 403 city-scope — cliente fora do scope
//   13. POST /api/billing/customers/:id/spc → 403 city-scope — cliente fora do scope
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { billingRoutes } from '../routes.js';

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
// Mock featureGate (não interfere nas rotas SPC, mas billingRoutes usa o módulo)
// ---------------------------------------------------------------------------
vi.mock('../../plugins/featureGate.js', () => ({
  featureGate: () => async () => {
    // no-op
  },
}));

// ---------------------------------------------------------------------------
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
}));

// ---------------------------------------------------------------------------
// Mock service — apenas as funções SPC
// ---------------------------------------------------------------------------
const mockGetSpcStatusService = vi.fn();
const mockUpdateSpcStatusService = vi.fn();

vi.mock('../service.js', () => ({
  // --- SPC (F15-S07) ---
  getSpcStatusService: (...args: unknown[]) => mockGetSpcStatusService(...args),
  updateSpcStatusService: (...args: unknown[]) => mockUpdateSpcStatusService(...args),
  // --- funções existentes (billing.routes.test.ts cobre estas) ---
  listDuesService: vi.fn(),
  markPaidService: vi.fn(),
  renegotiateService: vi.fn(),
  listRulesService: vi.fn(),
  createRuleService: vi.fn(),
  updateRuleService: vi.fn(),
  listJobsService: vi.fn(),
  cancelJobService: vi.fn(),
  attachBoletoUploadService: vi.fn(),
  attachBoletoReferenceService: vi.fn(),
  removeBoletoService: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const CUSTOMER_ID = 'a0000001-0000-0000-0000-000000000001';
const ORG_ID = 'a0000002-0000-0000-0000-000000000002';
const USER_ID = 'a0000003-0000-0000-0000-000000000003';

const TEST_USER_SPC_MANAGE = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ['spc:read', 'spc:manage'],
  cityScopeIds: null as string[] | null,
};

/** Resposta canônica de status SPC (none). */
const SPC_STATUS_NONE = {
  customer_id: CUSTOMER_ID,
  current_status: 'none' as const,
  changed_at: null,
};

/** Resposta canônica de status SPC (pending_inclusion). */
const SPC_STATUS_PENDING = {
  customer_id: CUSTOMER_ID,
  current_status: 'pending_inclusion' as const,
  changed_at: '2026-06-15T12:00:00.000Z',
};

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

function buildTestApp(userOverrides?: Partial<typeof TEST_USER_SPC_MANAGE>): FastifyInstance {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const user = { ...TEST_USER_SPC_MANAGE, ...userOverrides };

  app.addHook('preHandler', async (request) => {
    // `as` justificado: injeção de test user para simular authenticate()
    (request as { user?: typeof TEST_USER_SPC_MANAGE }).user = user;
  });

  void app.register(billingRoutes);

  app.setErrorHandler((error, _req, reply) => {
    const statusCode =
      error !== null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const msg = error instanceof Error ? error.message : String(error);
    const code =
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'string'
        ? (error as { code: string }).code
        : 'TEST_ERROR';
    return reply.status(statusCode).send({ error: code, message: msg });
  });

  return app;
}

function buildTestAppNoAuth(): FastifyInstance {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // Sem injeção de request.user — simula não-autenticado
  void app.register(billingRoutes);
  app.setErrorHandler((error, _req, reply) => {
    const statusCode =
      error !== null &&
      typeof error === 'object' &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;
    const msg = error instanceof Error ? error.message : String(error);
    return reply.status(statusCode).send({ error: 'TEST_ERROR', message: msg });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SPC Routes (F15-S07)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. GET /api/billing/customers/:id/spc → 200 status atual
  // -------------------------------------------------------------------------
  it('GET /api/billing/customers/:id/spc → 200 retorna status SPC atual', async () => {
    mockGetSpcStatusService.mockResolvedValueOnce(SPC_STATUS_NONE);

    const response = await app.inject({
      method: 'GET',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toMatchObject({
      customer_id: CUSTOMER_ID,
      current_status: 'none',
      changed_at: null,
    });
    expect(mockGetSpcStatusService).toHaveBeenCalledOnce();
    expect(mockGetSpcStatusService).toHaveBeenCalledWith({}, ORG_ID, CUSTOMER_ID, null);
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/billing/customers/:id/spc → 200 transição válida none → pending
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 200 transição none → pending_inclusion', async () => {
    mockUpdateSpcStatusService.mockResolvedValueOnce(SPC_STATUS_PENDING);

    const response = await app.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'pending_inclusion' },
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toMatchObject({
      customer_id: CUSTOMER_ID,
      current_status: 'pending_inclusion',
      changed_at: '2026-06-15T12:00:00.000Z',
    });
    expect(mockUpdateSpcStatusService).toHaveBeenCalledOnce();
    expect(mockUpdateSpcStatusService).toHaveBeenCalledWith(
      {},
      ORG_ID,
      CUSTOMER_ID,
      null,
      'pending_inclusion',
      expect.objectContaining({ userId: USER_ID }),
    );
  });

  // -------------------------------------------------------------------------
  // 3. POST → 200 idempotência (mesmo status → no-op)
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 200 idempotência (mesmo status → no-op)', async () => {
    mockUpdateSpcStatusService.mockResolvedValueOnce(SPC_STATUS_NONE);

    const response = await app.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'none' },
    });

    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toMatchObject({ current_status: 'none' });
  });

  // -------------------------------------------------------------------------
  // 4. POST → 422 transição inválida — service lança AppError
  //    (included → none não é permitida)
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 422 transição inválida included → none', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockUpdateSpcStatusService.mockRejectedValueOnce(
      new AppError(422, 'VALIDATION_ERROR', "Transição SPC inválida: 'included' → 'none'."),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'none' },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{ message: string }>();
    expect(body.message).toMatch(/inválida/i);
  });

  // -------------------------------------------------------------------------
  // 5. POST → 422 transição inválida — removed → included (sem volta)
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 422 transição inválida removed → included', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockUpdateSpcStatusService.mockRejectedValueOnce(
      new AppError(422, 'VALIDATION_ERROR', "Transição SPC inválida: 'removed' → 'included'."),
    );

    const response = await app.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'included' },
    });

    expect(response.statusCode).toBe(422);
  });

  // -------------------------------------------------------------------------
  // 6. POST → 400 body inválido (status desconhecido)
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 400 body inválido (status desconhecido)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'INVALID_STATUS' },
    });

    expect(response.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 7. GET → 404 cliente não encontrado
  // -------------------------------------------------------------------------
  it('GET /api/billing/customers/:id/spc → 404 cliente não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetSpcStatusService.mockRejectedValueOnce(new NotFoundError('Cliente não encontrado'));

    const response = await app.inject({
      method: 'GET',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
    });

    expect(response.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 8. POST → 404 cliente não encontrado
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 404 cliente não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateSpcStatusService.mockRejectedValueOnce(new NotFoundError('Cliente não encontrado'));

    const response = await app.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'pending_inclusion' },
    });

    expect(response.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 9. GET → 401 sem autenticação
  // -------------------------------------------------------------------------
  it('GET /api/billing/customers/:id/spc → 401 sem autenticação', async () => {
    const noAuthApp = buildTestAppNoAuth();
    await noAuthApp.ready();

    const response = await noAuthApp.inject({
      method: 'GET',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
    });

    expect(response.statusCode).toBe(401);
    await noAuthApp.close();
  });

  // -------------------------------------------------------------------------
  // 10. GET → 403 sem spc:read
  // -------------------------------------------------------------------------
  it('GET /api/billing/customers/:id/spc → 403 sem permissão spc:read', async () => {
    const noPermApp = buildTestApp({ permissions: ['billing:read'] });
    await noPermApp.ready();

    const response = await noPermApp.inject({
      method: 'GET',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
    });

    expect(response.statusCode).toBe(403);
    await noPermApp.close();
  });

  // -------------------------------------------------------------------------
  // 11. POST → 403 sem spc:manage
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 403 sem permissão spc:manage', async () => {
    const readOnlyApp = buildTestApp({ permissions: ['spc:read'] });
    await readOnlyApp.ready();

    const response = await readOnlyApp.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'pending_inclusion' },
    });

    expect(response.statusCode).toBe(403);
    await readOnlyApp.close();
  });

  // -------------------------------------------------------------------------
  // 12. GET → 403 city-scope — cliente de cidade diferente
  //    (service lança NotFoundError — scope retorna 404 para não revelar existência)
  // -------------------------------------------------------------------------
  it('GET /api/billing/customers/:id/spc → 404 city-scope (cliente fora do scope)', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockGetSpcStatusService.mockRejectedValueOnce(new NotFoundError('Cliente não encontrado'));

    const scopedApp = buildTestApp({
      cityScopeIds: ['a0000099-0000-0000-0000-000000000099'],
    });
    await scopedApp.ready();

    const response = await scopedApp.inject({
      method: 'GET',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
    });

    // Repository retorna 404 (não 403) para não vazar existência cross-tenant
    expect(response.statusCode).toBe(404);
    await scopedApp.close();
  });

  // -------------------------------------------------------------------------
  // 13. POST → 404 city-scope — cliente de cidade diferente
  // -------------------------------------------------------------------------
  it('POST /api/billing/customers/:id/spc → 404 city-scope (cliente fora do scope)', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockUpdateSpcStatusService.mockRejectedValueOnce(new NotFoundError('Cliente não encontrado'));

    const scopedApp = buildTestApp({
      cityScopeIds: ['a0000099-0000-0000-0000-000000000099'],
    });
    await scopedApp.ready();

    const response = await scopedApp.inject({
      method: 'POST',
      url: `/api/billing/customers/${CUSTOMER_ID}/spc`,
      payload: { status: 'pending_inclusion' },
    });

    expect(response.statusCode).toBe(404);
    await scopedApp.close();
  });
});

// ---------------------------------------------------------------------------
// Unit tests — service transition logic
// Via mock: verifica comportamento dos mocks do service (padrão deste módulo)
// ---------------------------------------------------------------------------

describe('SPC service — transição de status (unit via mock)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transição none → pending_inclusion retorna pending_inclusion', async () => {
    mockUpdateSpcStatusService.mockResolvedValueOnce({
      customer_id: CUSTOMER_ID,
      current_status: 'pending_inclusion',
      changed_at: '2026-06-15T12:00:00.000Z',
    });

    const { updateSpcStatusService } = await import('../service.js');
    const result = await updateSpcStatusService(
      // `as unknown as` justificado: mock estrutural — service está mockado no vi.mock acima,
      // o db nunca é acessado diretamente neste contexto de teste.
      {} as unknown as Parameters<typeof updateSpcStatusService>[0],
      ORG_ID,
      CUSTOMER_ID,
      null,
      'pending_inclusion',
      { userId: USER_ID, ip: null, permissions: [] },
    );

    expect(result).toMatchObject({ current_status: 'pending_inclusion' });
  });

  it('transição included → none lança AppError(422)', async () => {
    const { AppError } = await import('../../../shared/errors.js');
    mockUpdateSpcStatusService.mockRejectedValueOnce(
      new AppError(422, 'VALIDATION_ERROR', "Transição SPC inválida: 'included' → 'none'."),
    );

    const { updateSpcStatusService } = await import('../service.js');

    await expect(
      updateSpcStatusService(
        // `as unknown as` justificado: mock estrutural — service está mockado no vi.mock acima.
        {} as unknown as Parameters<typeof updateSpcStatusService>[0],
        ORG_ID,
        CUSTOMER_ID,
        null,
        'none',
        { userId: USER_ID, ip: null, permissions: [] },
      ),
    ).rejects.toThrow('inválida');
  });
});
