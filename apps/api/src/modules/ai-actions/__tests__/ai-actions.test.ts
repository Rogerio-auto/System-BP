// =============================================================================
// ai-actions/__tests__/ai-actions.test.ts — Testes de integração (F25-S06).
//
// Estratégia: sobe Fastify com aiActionsRoutes reais (routes + controller +
// service), mocka authenticate/authorize (injeta request.user), mocka
// repository.js (sem DB real), mocka emit.js/audit.js e db/client.js
// (transaction stub — o service escreve diretamente na tx em revertAiAction).
//
// Cobre (DoD F25-S06):
//   GET  /api/ai-actions
//     1. 200 lista paginada com nome de lead mascarado + revertible/reverted
//     2. 200 lista vazia (sem consulta) quando cityScopeIds=[]
//     3. 401 sem autenticação
//     4. 403 sem permissão ai_actions:read
//   POST /api/ai-actions/:id/revert
//     5.  200 reverte leads.qualified — audit com actor humano + evento idempotente
//     6.  200 idempotente — segunda chamada não toca a transação
//     7.  404 ação não encontrada (sem vazar motivo)
//     8.  404 lead fora do escopo de cidade (mesmo status de "não encontrada")
//     9.  409 ação não revertível (leads.stagnant)
//     10. 409 lead já avançou no funil (status não bate mais)
//     11. 200 reverte leads.abandoned — deriva status via stage do kanban
//     12. 403 sem permissão ai_actions:revert
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pg (evita conexão real ao banco)
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
// Mock repository
// ---------------------------------------------------------------------------
const mockListAiActionsRaw = vi.fn();
const mockFindAiActionById = vi.fn();
const mockFindLeadForRevert = vi.fn();
const mockFindKanbanCardForLead = vi.fn();
const mockFindExistingRevert = vi.fn();

vi.mock('../repository.js', () => ({
  listAiActionsRaw: (...args: unknown[]) => mockListAiActionsRaw(...args),
  findAiActionById: (...args: unknown[]) => mockFindAiActionById(...args),
  findLeadForRevert: (...args: unknown[]) => mockFindLeadForRevert(...args),
  findKanbanCardForLead: (...args: unknown[]) => mockFindKanbanCardForLead(...args),
  findExistingRevert: (...args: unknown[]) => mockFindExistingRevert(...args),
  REVERTIBLE_AI_ACTION_NAMES: ['leads.qualified', 'leads.abandoned'],
}));

// ---------------------------------------------------------------------------
// Mock emit / auditLog
// ---------------------------------------------------------------------------
const mockEmit = vi.fn().mockResolvedValue('event-uuid');
vi.mock('../../../events/emit.js', () => ({
  emit: (...args: unknown[]) => mockEmit(...args),
}));

const mockAuditLog = vi.fn().mockResolvedValue('audit-uuid');
vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));

// ---------------------------------------------------------------------------
// Mock db/client — provê db.transaction() controlável (revertAiAction escreve
// diretamente na tx para leads/lead_history — audit/emit são mockados acima).
// ---------------------------------------------------------------------------
function makeTxStub() {
  return {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(undefined),
  };
}

const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTxStub()));

vi.mock('../../../db/client.js', () => ({
  db: { transaction: (...args: [(tx: unknown) => Promise<unknown>]) => mockTransaction(...args) },
  pool: { end: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const FIXTURE_USER_ID = 'bbbbbbbb-0000-0000-0000-000000000001';
const FIXTURE_LEAD_ID = 'cccccccc-0000-0000-0000-000000000001';
const FIXTURE_CITY_ID = 'dddddddd-0000-0000-0000-000000000001';
const FIXTURE_ACTION_ID = 'eeeeeeee-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Build test app
// ---------------------------------------------------------------------------

async function buildTestApp(
  permissions = ['ai_actions:read', 'ai_actions:revert'],
  cityScopeIds: string[] | null = null,
): Promise<FastifyInstance> {
  const [{ aiActionsRoutes }, { isAppError }] = await Promise.all([
    import('../routes.js'),
    import('../../../shared/errors.js'),
  ]);

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('preHandler', async (request) => {
    request.user = {
      id: FIXTURE_USER_ID,
      organizationId: FIXTURE_ORG_ID,
      permissions,
      cityScopeIds,
    };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      const body: Record<string, unknown> = { error: error.code, message: error.message };
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

  await app.register(aiActionsRoutes);
  return app;
}

/** Variante sem request.user — simula ausência de authenticate(). */
async function buildUnauthenticatedApp(): Promise<FastifyInstance> {
  const { aiActionsRoutes } = await import('../routes.js');
  const { isAppError } = await import('../../../shared/errors.js');

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({ error: error.code, message: error.message });
    }
    return reply.status(500).send({ error: 'INTERNAL_ERROR' });
  });
  await app.register(aiActionsRoutes);
  return app;
}

function makeActionRow(overrides: Record<string, unknown> = {}) {
  return {
    actionId: FIXTURE_ACTION_ID,
    action: 'leads.qualified',
    leadId: FIXTURE_LEAD_ID,
    leadName: 'João da Silva Santos',
    cityId: FIXTURE_CITY_ID,
    occurredAt: new Date('2026-07-10T12:00:00.000Z'),
    reverted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GET /api/ai-actions
// ---------------------------------------------------------------------------

describe('GET /api/ai-actions', () => {
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

  it('retorna 200 com lista paginada e nome mascarado', async () => {
    mockListAiActionsRaw.mockResolvedValue({ rows: [makeActionRow()], total: 1 });

    const res = await app.inject({ method: 'GET', url: '/api/ai-actions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{
      data: Array<Record<string, unknown>>;
      pagination: Record<string, number>;
    }>();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      action_id: FIXTURE_ACTION_ID,
      action: 'leads.qualified',
      lead_id: FIXTURE_LEAD_ID,
      lead_name_masked: 'J. Santos',
      city_id: FIXTURE_CITY_ID,
      revertible: true,
      reverted: false,
    });
    // LGPD §8.5: nome completo NUNCA sai na resposta
    expect(JSON.stringify(body.data)).not.toContain('João da Silva Santos');
    expect(body.pagination).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });

    // Janela default '24h' repassada ao repository
    const [, params] = mockListAiActionsRaw.mock.calls[0] as [unknown, { sinceDate: Date }];
    expect(params.sinceDate.getTime()).toBeLessThan(Date.now());
  });

  it('leads.stagnant não é revertível na resposta', async () => {
    mockListAiActionsRaw.mockResolvedValue({
      rows: [makeActionRow({ action: 'leads.stagnant', leadName: null })],
      total: 1,
    });

    const res = await app.inject({ method: 'GET', url: '/api/ai-actions' });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<Record<string, unknown>> }>();
    expect(body.data[0]).toMatchObject({
      action: 'leads.stagnant',
      revertible: false,
      lead_name_masked: null,
    });
  });

  it('retorna lista vazia sem consultar o repository quando cityScopeIds=[]', async () => {
    const scopedApp = await buildTestApp(['ai_actions:read'], []);
    try {
      const res = await scopedApp.inject({ method: 'GET', url: '/api/ai-actions' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; pagination: Record<string, number> }>();
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
      expect(mockListAiActionsRaw).not.toHaveBeenCalled();
    } finally {
      await scopedApp.close();
    }
  });

  it('retorna 403 sem permissão ai_actions:read', async () => {
    const restrictedApp = await buildTestApp([]);
    try {
      const res = await restrictedApp.inject({ method: 'GET', url: '/api/ai-actions' });
      expect(res.statusCode).toBe(403);
    } finally {
      await restrictedApp.close();
    }
  });

  it('retorna 401 sem autenticação', async () => {
    const unauthApp = await buildUnauthenticatedApp();
    try {
      const res = await unauthApp.inject({ method: 'GET', url: '/api/ai-actions' });
      expect(res.statusCode).toBe(401);
    } finally {
      await unauthApp.close();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai-actions/:id/revert
// ---------------------------------------------------------------------------

describe('POST /api/ai-actions/:id/revert', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindExistingRevert.mockResolvedValue(null);
  });

  it('reverte leads.qualified: 200 + audit com ator humano + evento idempotente', async () => {
    mockFindAiActionById.mockResolvedValue({
      id: FIXTURE_ACTION_ID,
      action: 'leads.qualified',
      leadId: FIXTURE_LEAD_ID,
      beforeStatus: 'new',
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
    });
    mockFindLeadForRevert.mockResolvedValue({
      id: FIXTURE_LEAD_ID,
      cityId: FIXTURE_CITY_ID,
      status: 'qualifying',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      action_id: FIXTURE_ACTION_ID,
      lead_id: FIXTURE_LEAD_ID,
      action: 'leads.qualified',
      reverted: true,
      previous_status: 'qualifying',
      current_status: 'new',
    });

    // Ator de sistema/IA no audit é null; ator HUMANO revertendo é o oposto —
    // aqui o userId tem que ser o usuário, nunca null (feedback_system_actor_audit_uuid).
    expect(mockAuditLog).toHaveBeenCalledOnce();
    const [, auditParams] = mockAuditLog.mock.calls[0] as [
      unknown,
      { actor: { userId: string | null } },
    ];
    expect(auditParams.actor.userId).toBe(FIXTURE_USER_ID);

    // Idempotência: idempotencyKey determinística + onConflictDoNothing
    expect(mockEmit).toHaveBeenCalledOnce();
    const [, event, opts] = mockEmit.mock.calls[0] as [
      unknown,
      { idempotencyKey: string; eventName: string },
      { onConflictDoNothing: boolean },
    ];
    expect(event.eventName).toBe('leads.updated');
    expect(event.idempotencyKey).toBe(`ai_actions.revert:${FIXTURE_ACTION_ID}`);
    expect(opts.onConflictDoNothing).toBe(true);
  });

  it('idempotente: segunda chamada não toca a transação', async () => {
    mockFindAiActionById.mockResolvedValue({
      id: FIXTURE_ACTION_ID,
      action: 'leads.qualified',
      leadId: FIXTURE_LEAD_ID,
      beforeStatus: 'new',
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
    });
    mockFindLeadForRevert.mockResolvedValue({
      id: FIXTURE_LEAD_ID,
      cityId: FIXTURE_CITY_ID,
      status: 'new',
    });
    mockFindExistingRevert.mockResolvedValue({
      leadId: FIXTURE_LEAD_ID,
      previousStatus: 'qualifying',
      currentStatus: 'new',
      createdAt: new Date('2026-07-10T11:00:00.000Z'),
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      reverted: true,
      previous_status: 'qualifying',
      current_status: 'new',
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('retorna 404 quando a ação não existe', async () => {
    mockFindAiActionById.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(404);
    expect(mockFindLeadForRevert).not.toHaveBeenCalled();
  });

  it('retorna 404 (não 403) quando o lead está fora do escopo de cidade', async () => {
    mockFindAiActionById.mockResolvedValue({
      id: FIXTURE_ACTION_ID,
      action: 'leads.qualified',
      leadId: FIXTURE_LEAD_ID,
      beforeStatus: 'new',
      createdAt: new Date(),
    });
    // Fora do escopo -> repository retorna null (doc 10 §3.5)
    mockFindLeadForRevert.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NOT_FOUND');
  });

  it('retorna 409 quando a ação não é revertível (leads.stagnant)', async () => {
    mockFindAiActionById.mockResolvedValue({
      id: FIXTURE_ACTION_ID,
      action: 'leads.stagnant',
      leadId: FIXTURE_LEAD_ID,
      beforeStatus: null,
      createdAt: new Date(),
    });
    mockFindLeadForRevert.mockResolvedValue({
      id: FIXTURE_LEAD_ID,
      cityId: FIXTURE_CITY_ID,
      status: 'new',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(409);
  });

  it('retorna 409 quando o lead já avançou no funil (status não bate mais)', async () => {
    mockFindAiActionById.mockResolvedValue({
      id: FIXTURE_ACTION_ID,
      action: 'leads.qualified',
      leadId: FIXTURE_LEAD_ID,
      beforeStatus: 'new',
      createdAt: new Date(),
    });
    mockFindLeadForRevert.mockResolvedValue({
      id: FIXTURE_LEAD_ID,
      cityId: FIXTURE_CITY_ID,
      status: 'simulation',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(409);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('reverte leads.abandoned: deriva status via stage do kanban', async () => {
    mockFindAiActionById.mockResolvedValue({
      id: FIXTURE_ACTION_ID,
      action: 'leads.abandoned',
      leadId: FIXTURE_LEAD_ID,
      beforeStatus: null,
      createdAt: new Date(),
    });
    mockFindLeadForRevert.mockResolvedValue({
      id: FIXTURE_LEAD_ID,
      cityId: FIXTURE_CITY_ID,
      status: 'closed_lost',
    });
    mockFindKanbanCardForLead.mockResolvedValue({ priority: 0, canonicalRole: 'simulacao' });

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({
      action: 'leads.abandoned',
      previous_status: 'closed_lost',
      current_status: 'simulation',
    });
  });

  it('reverte leads.abandoned sem card reconhecido: fallback para new', async () => {
    mockFindAiActionById.mockResolvedValue({
      id: FIXTURE_ACTION_ID,
      action: 'leads.abandoned',
      leadId: FIXTURE_LEAD_ID,
      beforeStatus: null,
      createdAt: new Date(),
    });
    mockFindLeadForRevert.mockResolvedValue({
      id: FIXTURE_LEAD_ID,
      cityId: FIXTURE_CITY_ID,
      status: 'closed_lost',
    });
    mockFindKanbanCardForLead.mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ current_status: 'new' });
  });

  it('retorna 403 sem permissão ai_actions:revert', async () => {
    const restrictedApp = await buildTestApp(['ai_actions:read']);
    try {
      const res = await restrictedApp.inject({
        method: 'POST',
        url: `/api/ai-actions/${FIXTURE_ACTION_ID}/revert`,
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await restrictedApp.close();
    }
  });

  it('retorna 400 quando :id não é um UUID válido', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/ai-actions/not-a-uuid/revert' });
    expect(res.statusCode).toBe(400);
  });
});
