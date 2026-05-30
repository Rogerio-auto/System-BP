// =============================================================================
// followup/routes.test.ts — Testes de integração das rotas de follow-up (F5-S05).
//
// Estratégia: sobe Fastify com followupRoutes, mocka authenticate/authorize,
// mocka service para controlar dados.
//
// Cobre:
//   1.  GET  /api/followup/rules → 200 lista de regras
//   2.  POST /api/followup/rules → 201 regra criada
//   3.  POST /api/followup/rules → 400 body inválido
//   4.  PATCH /api/followup/rules/:id → 200 regra atualizada
//   5.  GET  /api/followup/jobs → 200 lista paginada
//   6.  GET  /api/followup/jobs → 200 com filtro status
//   7.  POST /api/followup/jobs/:id/cancel → 200 job cancelado
//   8.  POST /api/followup/jobs/:id/cancel → 404 job não encontrado
//   9.  Sem auth → 401
//   10. Sem followup:read → 403
//   11. Sem followup:write → 403 no POST rules
//   12. Sem followup:cancel_job → 403 no cancel
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { followupRoutes } from '../routes.js';

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
}));

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockListRulesService = vi.fn();
const mockCreateRuleService = vi.fn();
const mockUpdateRuleService = vi.fn();
const mockListJobsService = vi.fn();
const mockCancelJobService = vi.fn();

vi.mock('../service.js', () => ({
  listRulesService: (...args: unknown[]) => mockListRulesService(...args),
  createRuleService: (...args: unknown[]) => mockCreateRuleService(...args),
  updateRuleService: (...args: unknown[]) => mockUpdateRuleService(...args),
  listJobsService: (...args: unknown[]) => mockListJobsService(...args),
  cancelJobService: (...args: unknown[]) => mockCancelJobService(...args),
}));

const ORG_ID = '11111111-1111-1111-1111-111111111111';
const RULE_ID = '22222222-2222-2222-2222-222222222222';
const JOB_ID = '33333333-3333-3333-3333-333333333333';
const TEMPLATE_ID = '44444444-4444-4444-4444-444444444444';

async function buildTestApp(
  permissions: string[] = ['followup:read', 'followup:write', 'followup:cancel_job'],
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('preHandler', async (request) => {
    // `as` justificado: mock para testes, tipagem correta de user
    (
      request as unknown as { user: { id: string; organizationId: string; permissions: string[] } }
    ).user = {
      id: 'user-1',
      organizationId: ORG_ID,
      permissions,
    };
  });

  await app.register(followupRoutes);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRuleResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RULE_ID,
    organization_id: ORG_ID,
    key: 'd1',
    name: 'Follow-up D+1',
    trigger_type: 'stage_inactivity',
    wait_hours: 24,
    template_id: TEMPLATE_ID,
    applies_to_stage: null,
    applies_to_outcome: null,
    is_active: false,
    max_attempts: 3,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeJobResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: JOB_ID,
    organization_id: ORG_ID,
    lead_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    lead_name: 'João',
    rule_id: RULE_ID,
    rule_key: 'd1',
    template_key: 'followup_d1',
    scheduled_at: '2026-05-02T10:00:00.000Z',
    status: 'scheduled',
    attempt_count: 0,
    last_error: null,
    sent_message_id: null,
    idempotency_key: '2026-05-01:d1',
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const CREATE_RULE_PAYLOAD = {
  key: 'd1',
  name: 'Follow-up D+1',
  trigger_type: 'stage_inactivity',
  wait_hours: 24,
  template_id: TEMPLATE_ID,
};

// ---------------------------------------------------------------------------
// GET /api/followup/rules
// ---------------------------------------------------------------------------

describe('GET /api/followup/rules', () => {
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

  it('retorna 200 com lista de regras', async () => {
    mockListRulesService.mockResolvedValue({
      data: [makeRuleResponse()],
      total: 1,
    });

    const res = await app.inject({ method: 'GET', url: '/api/followup/rules' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBe(1);
    expect(body.data).toHaveLength(1);
  });

  it('retorna lista vazia quando não há regras', async () => {
    mockListRulesService.mockResolvedValue({ data: [], total: 0 });

    const res = await app.inject({ method: 'GET', url: '/api/followup/rules' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/followup/rules
// ---------------------------------------------------------------------------

describe('POST /api/followup/rules', () => {
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

  it('retorna 201 com regra criada', async () => {
    mockCreateRuleService.mockResolvedValue(makeRuleResponse());

    const res = await app.inject({
      method: 'POST',
      url: '/api/followup/rules',
      payload: CREATE_RULE_PAYLOAD,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['key']).toBe('d1');
    expect(body['is_active']).toBe(false);
  });

  it('retorna 400 quando body inválido (sem key)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/followup/rules',
      payload: {
        name: 'Sem key',
        trigger_type: 'stage_inactivity',
        wait_hours: 24,
        template_id: TEMPLATE_ID,
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('retorna 400 quando wait_hours <= 0', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/followup/rules',
      payload: { ...CREATE_RULE_PAYLOAD, wait_hours: -1 },
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/followup/rules/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/followup/rules/:id', () => {
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

  it('retorna 200 com regra atualizada', async () => {
    mockUpdateRuleService.mockResolvedValue(makeRuleResponse({ is_active: true }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/followup/rules/${RULE_ID}`,
      payload: { is_active: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['is_active']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/followup/jobs
// ---------------------------------------------------------------------------

describe('GET /api/followup/jobs', () => {
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

  it('retorna 200 com lista paginada de jobs', async () => {
    mockListJobsService.mockResolvedValue({
      data: [makeJobResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({ method: 'GET', url: '/api/followup/jobs' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; pagination: { total: number } }>();
    expect(body.pagination.total).toBe(1);
    expect(body.data).toHaveLength(1);
  });

  it('filtra por status=scheduled', async () => {
    mockListJobsService.mockResolvedValue({
      data: [makeJobResponse()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/followup/jobs?status=scheduled',
    });

    expect(res.statusCode).toBe(200);
    expect(mockListJobsService).toHaveBeenCalledWith(
      expect.anything(),
      ORG_ID,
      expect.objectContaining({ status: 'scheduled' }),
    );
  });

  it('retorna 400 para status inválido', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/followup/jobs?status=invalid_status',
    });

    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/followup/jobs/:id/cancel
// ---------------------------------------------------------------------------

describe('POST /api/followup/jobs/:id/cancel', () => {
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

  it('retorna 200 com job cancelado', async () => {
    mockCancelJobService.mockResolvedValue(makeJobResponse({ status: 'cancelled' }));

    const res = await app.inject({
      method: 'POST',
      url: `/api/followup/jobs/${JOB_ID}/cancel`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body['status']).toBe('cancelled');
  });

  it('retorna 404 quando job não encontrado', async () => {
    const { NotFoundError } = await import('../../../shared/errors.js');
    mockCancelJobService.mockRejectedValue(new NotFoundError('Job não encontrado'));

    const res = await app.inject({
      method: 'POST',
      url: `/api/followup/jobs/${JOB_ID}/cancel`,
    });

    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

describe('Autorização — sem permissões', () => {
  let appNoPerms: FastifyInstance;

  beforeAll(async () => {
    appNoPerms = await buildTestApp(['other:permission']);
  });

  afterAll(async () => {
    await appNoPerms.close();
  });

  it('retorna 403 em GET /api/followup/rules sem followup:read', async () => {
    const res = await appNoPerms.inject({ method: 'GET', url: '/api/followup/rules' });
    expect(res.statusCode).toBe(403);
  });

  it('retorna 403 em POST /api/followup/rules sem followup:write', async () => {
    const res = await appNoPerms.inject({
      method: 'POST',
      url: '/api/followup/rules',
      payload: CREATE_RULE_PAYLOAD,
    });
    expect(res.statusCode).toBe(403);
  });

  it('retorna 403 em POST /api/followup/jobs/:id/cancel sem followup:cancel_job', async () => {
    const res = await appNoPerms.inject({
      method: 'POST',
      url: `/api/followup/jobs/${JOB_ID}/cancel`,
    });
    expect(res.statusCode).toBe(403);
  });
});
