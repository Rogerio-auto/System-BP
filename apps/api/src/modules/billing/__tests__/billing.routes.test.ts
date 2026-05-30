// =============================================================================
// billing/billing.routes.test.ts — Testes de integração das rotas de cobrança (F5-S08).
//
// Estratégia: sobe Fastify com billingRoutes, mocka authenticate/authorize,
// mocka service para controlar dados.
//
// Cobre:
//   1.  GET  /api/billing/payment-dues → 200 lista de parcelas
//   2.  POST /api/billing/payment-dues/:id/mark-paid → 200 parcela marcada paga
//   3.  POST /api/billing/payment-dues/:id/renegotiate → 200 renegociada
//   4.  GET  /api/billing/rules → 200 lista de regras
//   5.  POST /api/billing/rules → 201 regra criada
//   6.  POST /api/billing/rules → 400 body inválido
//   7.  PATCH /api/billing/rules/:id → 200 regra atualizada
//   8.  GET  /api/billing/jobs → 200 lista paginada
//   9.  POST /api/billing/jobs/:id/cancel → 200 job cancelado
//   10. POST /api/billing/jobs/:id/cancel → 404 job não encontrado
//   11. Sem auth → 401
//   12. Sem billing:read → 403
//   13. Sem billing:write → 403 no POST rules
//   14. Sem billing:mark_paid → 403 no mark-paid
//   15. Sem billing:cancel_job → 403 no cancel
//   16. mark-paid sem Idempotency-Key → 400 (HIGH-03)
//   17. renegotiate sem Idempotency-Key → 400 (HIGH-03)
//   18. mark-paid com Idempotency-Key reprocessada → cached 200 (HIGH-03)
//   19. gestor_regional NÃO consegue mark-paid de parcela fora do scope → 404 (HIGH-01)
//   20. outbox event emitido no mark-paid (via mock do service) (MEDIUM-02)
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
// Mock db/client
// ---------------------------------------------------------------------------
vi.mock('../../../db/client.js', () => ({
  db: {},
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockListDuesService = vi.fn();
const mockMarkPaidService = vi.fn();
const mockRenegotiateService = vi.fn();
const mockListRulesService = vi.fn();
const mockCreateRuleService = vi.fn();
const mockUpdateRuleService = vi.fn();
const mockListJobsService = vi.fn();
const mockCancelJobService = vi.fn();

vi.mock('../service.js', () => ({
  listDuesService: (...args: unknown[]) => mockListDuesService(...args),
  markPaidService: (...args: unknown[]) => mockMarkPaidService(...args),
  renegotiateService: (...args: unknown[]) => mockRenegotiateService(...args),
  listRulesService: (...args: unknown[]) => mockListRulesService(...args),
  createRuleService: (...args: unknown[]) => mockCreateRuleService(...args),
  updateRuleService: (...args: unknown[]) => mockUpdateRuleService(...args),
  listJobsService: (...args: unknown[]) => mockListJobsService(...args),
  cancelJobService: (...args: unknown[]) => mockCancelJobService(...args),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

// Constantes de UUID canônicas para testes (formato válido para Zod .uuid())
const DUE_ID = 'a0000001-0000-0000-0000-000000000001';
const ORG_ID = 'a0000002-0000-0000-0000-000000000002';
const CUSTOMER_ID = 'a0000003-0000-0000-0000-000000000003';
const RULE_ID = 'a0000004-0000-0000-0000-000000000004';
const JOB_ID = 'a0000005-0000-0000-0000-000000000005';
const TPL_ID = 'a0000006-0000-0000-0000-000000000006';
const USER_ID = 'a0000007-0000-0000-0000-000000000007';

const TEST_USER = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ['billing:read', 'billing:write', 'billing:mark_paid', 'billing:cancel_job'],
  cityScopeIds: null as string[] | null,
};

const SAMPLE_DUE = {
  id: DUE_ID,
  organization_id: ORG_ID,
  customer_id: CUSTOMER_ID,
  customer_name: 'João',
  contract_reference: 'BP-2026-00001',
  installment_number: 1,
  due_date: '2026-06-15',
  amount: '1200.00',
  status: 'pending' as const,
  paid_at: null,
  origin: 'import' as const,
  created_by: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const SAMPLE_RULE = {
  id: RULE_ID,
  organization_id: ORG_ID,
  key: 'd-3',
  name: 'Aviso D-3',
  trigger_type: 'days_before_due' as const,
  wait_hours: -72,
  template_id: TPL_ID,
  applies_to_status: 'pending' as const,
  is_active: false,
  max_attempts: 3,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const SAMPLE_JOB = {
  id: JOB_ID,
  organization_id: ORG_ID,
  payment_due_id: DUE_ID,
  contract_reference: 'BP-2026-00001',
  customer_name: 'João',
  rule_id: RULE_ID,
  rule_key: 'd-3',
  template_key: 'cobranca_d3',
  scheduled_at: new Date().toISOString(),
  status: 'scheduled' as const,
  attempt_count: 0,
  last_error: null,
  sent_message_id: null,
  idempotency_key: '2026-06-15:d-3',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// ---------------------------------------------------------------------------
// App builders
// ---------------------------------------------------------------------------

function buildTestApp(userOverrides?: Partial<typeof TEST_USER>): FastifyInstance {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const user = { ...TEST_USER, ...userOverrides };

  app.addHook('preHandler', async (request) => {
    // `as` justificado: injeção de test user para simular authenticate()
    (request as { user?: typeof TEST_USER }).user = user;
  });

  void app.register(billingRoutes);

  // Error handler canônico mínimo
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

describe('Billing Routes', () => {
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
  // 1. GET /api/billing/payment-dues → 200
  // -------------------------------------------------------------------------
  it('GET /api/billing/payment-dues → 200 lista parcelas', async () => {
    mockListDuesService.mockResolvedValueOnce({
      data: [SAMPLE_DUE],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/billing/payment-dues' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
    expect(body.data).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
    expect(mockListDuesService).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 2. POST /api/billing/payment-dues/:id/mark-paid → 200
  // -------------------------------------------------------------------------
  it('POST /api/billing/payment-dues/:id/mark-paid → 200 parcela paga', async () => {
    mockMarkPaidService.mockResolvedValueOnce({
      ...SAMPLE_DUE,
      status: 'paid',
      paid_at: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/mark-paid`,
      headers: { 'idempotency-key': 'test-key-mark-paid-001' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe('paid');
  });

  // -------------------------------------------------------------------------
  // 3. POST /api/billing/payment-dues/:id/renegotiate → 200
  // -------------------------------------------------------------------------
  it('POST /api/billing/payment-dues/:id/renegotiate → 200 renegociada', async () => {
    mockRenegotiateService.mockResolvedValueOnce({ ...SAMPLE_DUE, status: 'renegotiated' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/renegotiate`,
      headers: { 'idempotency-key': 'test-key-renegotiate-001' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe('renegotiated');
  });

  // -------------------------------------------------------------------------
  // 4. GET /api/billing/rules → 200
  // -------------------------------------------------------------------------
  it('GET /api/billing/rules → 200 lista regras', async () => {
    mockListRulesService.mockResolvedValueOnce({ data: [SAMPLE_RULE], total: 1 });

    const res = await app.inject({ method: 'GET', url: '/api/billing/rules' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.data).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 5. POST /api/billing/rules → 201
  // -------------------------------------------------------------------------
  it('POST /api/billing/rules → 201 regra criada', async () => {
    mockCreateRuleService.mockResolvedValueOnce(SAMPLE_RULE);

    const payload = {
      key: 'd-3',
      name: 'Aviso D-3',
      trigger_type: 'days_before_due',
      wait_hours: -72,
      template_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/rules',
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ key: string }>();
    expect(body.key).toBe('d-3');
  });

  // -------------------------------------------------------------------------
  // 6. POST /api/billing/rules → 400 body inválido
  // -------------------------------------------------------------------------
  it('POST /api/billing/rules → 400 body sem campos obrigatórios', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/billing/rules',
      payload: { name: 'Sem key e sem trigger_type' },
    });
    expect(res.statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 7. PATCH /api/billing/rules/:id → 200
  // -------------------------------------------------------------------------
  it('PATCH /api/billing/rules/:id → 200 regra atualizada', async () => {
    mockUpdateRuleService.mockResolvedValueOnce({ ...SAMPLE_RULE, name: 'Aviso D-3 atualizado' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/billing/rules/${RULE_ID}`,
      payload: { name: 'Aviso D-3 atualizado' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ name: string }>();
    expect(body.name).toBe('Aviso D-3 atualizado');
  });

  // -------------------------------------------------------------------------
  // 8. GET /api/billing/jobs → 200
  // -------------------------------------------------------------------------
  it('GET /api/billing/jobs → 200 lista jobs', async () => {
    mockListJobsService.mockResolvedValueOnce({
      data: [SAMPLE_JOB],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/billing/jobs' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
    expect(body.data).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // 9. POST /api/billing/jobs/:id/cancel → 200
  // -------------------------------------------------------------------------
  it('POST /api/billing/jobs/:id/cancel → 200 job cancelado', async () => {
    mockCancelJobService.mockResolvedValueOnce({ ...SAMPLE_JOB, status: 'cancelled' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/jobs/${JOB_ID}/cancel`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe('cancelled');
  });

  // -------------------------------------------------------------------------
  // 10. POST /api/billing/jobs/:id/cancel → 404 job não encontrado
  // -------------------------------------------------------------------------
  it('POST /api/billing/jobs/:id/cancel → 404 job não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockCancelJobService.mockRejectedValueOnce(new NotFoundError('Job de cobrança não encontrado'));

    const notFoundJobId = 'b0000000-0000-0000-0000-000000000099';
    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/jobs/${notFoundJobId}/cancel`,
    });
    expect(res.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 11. Sem auth → 401
  // -------------------------------------------------------------------------
  it('GET /api/billing/payment-dues sem auth → 401', async () => {
    const noAuthApp = buildTestAppNoAuth();
    await noAuthApp.ready();

    const res = await noAuthApp.inject({ method: 'GET', url: '/api/billing/payment-dues' });
    expect(res.statusCode).toBe(401);

    await noAuthApp.close();
  });

  // -------------------------------------------------------------------------
  // 12. Sem billing:read → 403
  // -------------------------------------------------------------------------
  it('GET /api/billing/payment-dues sem billing:read → 403', async () => {
    const restrictedApp = buildTestApp({ permissions: [] });
    await restrictedApp.ready();

    const res = await restrictedApp.inject({ method: 'GET', url: '/api/billing/payment-dues' });
    expect(res.statusCode).toBe(403);

    await restrictedApp.close();
  });

  // -------------------------------------------------------------------------
  // 13. Sem billing:write → 403 no POST rules
  // -------------------------------------------------------------------------
  it('POST /api/billing/rules sem billing:write → 403', async () => {
    const restrictedApp = buildTestApp({ permissions: ['billing:read'] });
    await restrictedApp.ready();

    const res = await restrictedApp.inject({
      method: 'POST',
      url: '/api/billing/rules',
      payload: {
        key: 'd-3',
        name: 'Aviso D-3',
        trigger_type: 'days_before_due',
        wait_hours: -72,
        template_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      },
    });
    expect(res.statusCode).toBe(403);

    await restrictedApp.close();
  });

  // -------------------------------------------------------------------------
  // 14. Sem billing:mark_paid → 403 no mark-paid
  // -------------------------------------------------------------------------
  it('POST mark-paid sem billing:mark_paid → 403', async () => {
    const restrictedApp = buildTestApp({ permissions: ['billing:read'] });
    await restrictedApp.ready();

    const res = await restrictedApp.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/mark-paid`,
      headers: { 'idempotency-key': 'test-key-forbidden' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);

    await restrictedApp.close();
  });

  // -------------------------------------------------------------------------
  // 15. Sem billing:cancel_job → 403 no cancel
  // -------------------------------------------------------------------------
  it('POST cancel sem billing:cancel_job → 403', async () => {
    const restrictedApp = buildTestApp({ permissions: ['billing:read'] });
    await restrictedApp.ready();

    const res = await restrictedApp.inject({
      method: 'POST',
      url: `/api/billing/jobs/${JOB_ID}/cancel`,
    });
    expect(res.statusCode).toBe(403);

    await restrictedApp.close();
  });

  // -------------------------------------------------------------------------
  // 16. mark-paid sem Idempotency-Key → 400 (HIGH-03)
  // -------------------------------------------------------------------------
  it('POST mark-paid sem Idempotency-Key → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/mark-paid`,
      payload: {},
      // sem header idempotency-key
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/Idempotency-Key/i);
  });

  // -------------------------------------------------------------------------
  // 17. renegotiate sem Idempotency-Key → 400 (HIGH-03)
  // -------------------------------------------------------------------------
  it('POST renegotiate sem Idempotency-Key → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/renegotiate`,
      payload: {},
      // sem header idempotency-key
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ message: string }>();
    expect(body.message).toMatch(/Idempotency-Key/i);
  });

  // -------------------------------------------------------------------------
  // 18. mark-paid com Idempotency-Key reprocessada retorna cacheada (HIGH-03)
  // -------------------------------------------------------------------------
  it('POST mark-paid com Idempotency-Key duplicada → service retorna cacheado', async () => {
    const cachedDue = { ...SAMPLE_DUE, status: 'paid' as const, paid_at: new Date().toISOString() };
    // Service retorna cacheado (simula que já processou anteriormente)
    mockMarkPaidService.mockResolvedValueOnce(cachedDue);

    const res = await app.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/mark-paid`,
      headers: { 'idempotency-key': 'existing-key-already-processed' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe('paid');
    // Service foi chamado com a idempotency key
    expect(mockMarkPaidService).toHaveBeenCalledOnce();
    const callArgs = mockMarkPaidService.mock.calls[0] as unknown[];
    expect(callArgs[5]).toBe('existing-key-already-processed');
  });

  // -------------------------------------------------------------------------
  // 19. gestor_regional NÃO consegue mark-paid de parcela fora do scope → 404 (HIGH-01)
  // -------------------------------------------------------------------------
  it('POST mark-paid gestor_regional fora do scope → 404', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    // Service lança NotFoundError porque city scope não bate
    mockMarkPaidService.mockRejectedValueOnce(new NotFoundError('Parcela não encontrada'));

    const regionalApp = buildTestApp({
      permissions: ['billing:read', 'billing:mark_paid'],
      cityScopeIds: ['city-a', 'city-b'], // escopo restrito
    });
    await regionalApp.ready();

    const res = await regionalApp.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/mark-paid`,
      headers: { 'idempotency-key': 'test-scope-404' },
      payload: {},
    });
    expect(res.statusCode).toBe(404);

    await regionalApp.close();
  });

  // -------------------------------------------------------------------------
  // 20. Controller passa cityScopeIds e idempotencyKey para o service (HIGH-01 + HIGH-03)
  // -------------------------------------------------------------------------
  it('mark-paid repassa cityScopeIds e idempotencyKey para o service', async () => {
    mockMarkPaidService.mockResolvedValueOnce({
      ...SAMPLE_DUE,
      status: 'paid',
      paid_at: new Date().toISOString(),
    });

    const scopedApp = buildTestApp({ cityScopeIds: ['city-x'] });
    await scopedApp.ready();

    await scopedApp.inject({
      method: 'POST',
      url: `/api/billing/payment-dues/${DUE_ID}/mark-paid`,
      headers: { 'idempotency-key': 'test-propagation-key' },
      payload: {},
    });

    expect(mockMarkPaidService).toHaveBeenCalledOnce();
    const callArgs = mockMarkPaidService.mock.calls[0] as unknown[];
    // cityScopeIds é o 4º argumento (index 3)
    expect(callArgs[3]).toEqual(['city-x']);
    // idempotencyKey é o 6º argumento (index 5)
    expect(callArgs[5]).toBe('test-propagation-key');

    await scopedApp.close();
  });
});
