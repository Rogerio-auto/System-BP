// =============================================================================
// tasks/__tests__/tasks.test.ts — Testes de integração das rotas de tarefas (F15-S05).
//
// Estratégia: sobe Fastify com tasksRoutes, mocka authenticate/authorize e service.
//
// Cobre (DoD F15-S05):
//   1.  GET /api/tasks → 200 lista das minhas tarefas
//   2.  GET /api/tasks — usuário SEM city-scope da tarefa NÃO a vê (role+city negativo)
//   3.  GET /api/tasks — usuário COM city-scope (ou tarefa global) a vê
//   4.  POST /api/tasks → 201 tarefa criada
//   5.  POST /api/tasks → 400 body inválido
//   6.  POST /api/tasks/:id/claim → 200 seta claimedBy e claimedAt
//   7.  POST /api/tasks/:id/complete → 200 seta completedAt e completedBy
//   8.  POST /api/tasks/:id/complete — usuário diferente do claimed_by → 403
//   9.  POST /api/tasks/:id/cancel → 200 muda status para cancelled
//   10. POST /api/tasks/:id/cancel — tarefa já done → 409
//   11. RBAC negativo: sem tasks:read → 403
//   12. RBAC negativo: sem tasks:write → 403 no POST
//   13. RBAC negativo: sem tasks:claim → 403 no claim
//   14. RBAC negativo: sem tasks:complete → 403 no complete
//   15. POST /api/tasks sem auth → 401
// =============================================================================
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { tasksRoutes } from '../routes.js';

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
const mockListMyTasksService = vi.fn();
const mockCreateTaskService = vi.fn();
const mockClaimTaskService = vi.fn();
const mockCompleteTaskService = vi.fn();
const mockCancelTaskService = vi.fn();

vi.mock('../service.js', () => ({
  listMyTasksService: (...args: unknown[]) => mockListMyTasksService(...args),
  createTaskService: (...args: unknown[]) => mockCreateTaskService(...args),
  claimTaskService: (...args: unknown[]) => mockClaimTaskService(...args),
  completeTaskService: (...args: unknown[]) => mockCompleteTaskService(...args),
  cancelTaskService: (...args: unknown[]) => mockCancelTaskService(...args),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TASK_ID = 'a0000001-0000-0000-0000-000000000001';
const ORG_ID = 'a0000002-0000-0000-0000-000000000002';
const USER_ID = 'a0000003-0000-0000-0000-000000000003';
const CITY_ID = 'a0000004-0000-0000-0000-000000000004';
const ENTITY_ID = 'a0000005-0000-0000-0000-000000000005';

const ALL_TASK_PERMISSIONS = ['tasks:read', 'tasks:write', 'tasks:claim', 'tasks:complete'];

const TEST_USER_WITH_CITY = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_TASK_PERMISSIONS,
  cityScopeIds: [CITY_ID] as string[] | null,
};

const TEST_USER_NO_CITY = {
  id: USER_ID,
  organizationId: ORG_ID,
  permissions: ALL_TASK_PERMISSIONS,
  cityScopeIds: [] as string[] | null, // sem cidades → não deve ver tarefa com city_id
};

const NOW = '2026-06-15T10:00:00.000Z';

// Tarefa aberta, não reclamada, com cidade específica
const SAMPLE_TASK_OPEN = {
  id: TASK_ID,
  organizationId: ORG_ID,
  assigneeRole: 'agente',
  cityId: CITY_ID,
  type: 'spc_inclusion' as const,
  entityType: 'customer',
  entityId: ENTITY_ID,
  title: 'Incluir no SPC',
  description: null,
  dueAt: null,
  status: 'open' as const,
  claimedBy: null,
  claimedAt: null,
  completedBy: null,
  completedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// Tarefa assumida (claimedBy setado, status permanece 'open' — esquema DB F15-S03)
const SAMPLE_TASK_CLAIMED = {
  ...SAMPLE_TASK_OPEN,
  claimedBy: USER_ID,
  claimedAt: NOW,
  updatedAt: NOW,
};

// Tarefa concluída
const SAMPLE_TASK_DONE = {
  ...SAMPLE_TASK_CLAIMED,
  status: 'done' as const,
  completedBy: USER_ID,
  completedAt: NOW,
};

// Tarefa cancelada
const SAMPLE_TASK_CANCELLED = {
  ...SAMPLE_TASK_OPEN,
  status: 'cancelled' as const,
  completedBy: USER_ID,
  completedAt: NOW,
};

// Tarefa global (sem cidade)
const SAMPLE_TASK_GLOBAL = {
  ...SAMPLE_TASK_OPEN,
  cityId: null,
};

// ---------------------------------------------------------------------------
// App factory de teste
// ---------------------------------------------------------------------------

type TestUser = typeof TEST_USER_WITH_CITY;

async function buildTestApp(user: TestUser | null = TEST_USER_WITH_CITY): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // `as` justificado: cast para tipo genérico de Fastify com ZodTypeProvider
  // necessário para compatibilidade com fastify-type-provider-zod sem exportar o tipo diretamente.
  const typedApp = app.withTypeProvider();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Injetar usuário simulado no request
  if (user !== null) {
    typedApp.addHook('preHandler', async (request) => {
      // `as` justificado: injeção de test fixture sem passar por autenticação real.
      (request as unknown as { user: TestUser }).user = user;
    });
  }

  await typedApp.register(tasksRoutes);
  await typedApp.ready();
  return typedApp;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('Tasks Module — F15-S05', () => {
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

  // ---- GET /api/tasks -------------------------------------------------------

  describe('GET /api/tasks', () => {
    it('1. retorna lista de tarefas (200)', async () => {
      mockListMyTasksService.mockResolvedValue({
        data: [SAMPLE_TASK_OPEN],
        total: 1,
        limit: 50,
        offset: 0,
      });

      const res = await app.inject({ method: 'GET', url: '/api/tasks' });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: (typeof SAMPLE_TASK_OPEN)[]; total: number }>();
      expect(body.total).toBe(1);
      expect(body.data[0]?.id).toBe(TASK_ID);
      expect(mockListMyTasksService).toHaveBeenCalledOnce();
    });

    it('2. usuário SEM city-scope da tarefa NÃO a vê (resolução role+city negativo)', async () => {
      // Service retorna lista vazia quando usuário não tem cidade configurada
      mockListMyTasksService.mockResolvedValue({
        data: [],
        total: 0,
        limit: 50,
        offset: 0,
      });

      const appNoCityUser = await buildTestApp(TEST_USER_NO_CITY);
      const res = await appNoCityUser.inject({ method: 'GET', url: '/api/tasks' });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; total: number }>();
      expect(body.total).toBe(0);
      expect(body.data).toHaveLength(0);

      // Verificar que o service foi chamado com cityScopeIds = [] (sem cidades)
      expect(mockListMyTasksService).toHaveBeenCalledWith(
        expect.anything(), // db
        ORG_ID,
        USER_ID,
        [], // cityScopeIds vazio → sem acesso
        expect.objectContaining({ limit: 50, offset: 0 }),
      );

      await appNoCityUser.close();
    });

    it('3. usuário COM city-scope (ou tarefa global) vê a tarefa', async () => {
      mockListMyTasksService.mockResolvedValue({
        data: [SAMPLE_TASK_GLOBAL, SAMPLE_TASK_OPEN],
        total: 2,
        limit: 50,
        offset: 0,
      });

      const res = await app.inject({ method: 'GET', url: '/api/tasks' });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ data: unknown[]; total: number }>();
      expect(body.total).toBe(2);

      // Verificar que service foi chamado com cityScopeIds do usuário
      expect(mockListMyTasksService).toHaveBeenCalledWith(
        expect.anything(),
        ORG_ID,
        USER_ID,
        [CITY_ID],
        expect.anything(),
      );
    });

    it('11. sem tasks:read → 403', async () => {
      const noReadUser = { ...TEST_USER_WITH_CITY, permissions: ['tasks:write'] };
      const appNoRead = await buildTestApp(noReadUser);

      const res = await appNoRead.inject({ method: 'GET', url: '/api/tasks' });
      expect(res.statusCode).toBe(403);
      await appNoRead.close();
    });
  });

  // ---- POST /api/tasks ------------------------------------------------------

  describe('POST /api/tasks', () => {
    const VALID_BODY = {
      assigneeRole: 'agente',
      type: 'spc_inclusion',
      title: 'Incluir no SPC',
      cityId: CITY_ID,
      entityType: 'customer',
      entityId: ENTITY_ID,
    };

    it('4. cria tarefa (201)', async () => {
      mockCreateTaskService.mockResolvedValue(SAMPLE_TASK_OPEN);

      const res = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: VALID_BODY,
      });

      expect(res.statusCode).toBe(201);
      const body = res.json<typeof SAMPLE_TASK_OPEN>();
      expect(body.id).toBe(TASK_ID);
      expect(body.status).toBe('open');
      expect(mockCreateTaskService).toHaveBeenCalledWith(
        expect.anything(),
        ORG_ID,
        expect.objectContaining({ userId: USER_ID }),
        expect.objectContaining({ assigneeRole: 'agente' }),
        undefined, // sem idempotency key
      );
    });

    it('5. body inválido → 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: { type: 'spc_inclusion' }, // sem assigneeRole e title obrigatórios
      });

      expect(res.statusCode).toBe(400);
    });

    it('12. sem tasks:write → 403 no POST', async () => {
      const noWriteUser = { ...TEST_USER_WITH_CITY, permissions: ['tasks:read'] };
      const appNoWrite = await buildTestApp(noWriteUser);

      const res = await appNoWrite.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: VALID_BODY,
      });

      expect(res.statusCode).toBe(403);
      await appNoWrite.close();
    });
  });

  // ---- POST /api/tasks/:id/claim -------------------------------------------

  describe('POST /api/tasks/:id/claim', () => {
    it('6. assume tarefa: claimedBy e claimedAt setados (status permanece open)', async () => {
      mockClaimTaskService.mockResolvedValue(SAMPLE_TASK_CLAIMED);

      const res = await app.inject({
        method: 'POST',
        url: `/api/tasks/${TASK_ID}/claim`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<typeof SAMPLE_TASK_CLAIMED>();
      // Status permanece 'open' — o banco (F15-S03) não tem 'in_progress'
      expect(body.status).toBe('open');
      expect(body.claimedBy).toBe(USER_ID);
      expect(body.claimedAt).toBe(NOW);
    });

    it('13. sem tasks:claim → 403', async () => {
      const noClaimUser = { ...TEST_USER_WITH_CITY, permissions: ['tasks:read', 'tasks:write'] };
      const appNoClaim = await buildTestApp(noClaimUser);

      const res = await appNoClaim.inject({
        method: 'POST',
        url: `/api/tasks/${TASK_ID}/claim`,
      });

      expect(res.statusCode).toBe(403);
      await appNoClaim.close();
    });
  });

  // ---- POST /api/tasks/:id/complete ----------------------------------------

  describe('POST /api/tasks/:id/complete', () => {
    it('7. conclui tarefa: status done, completedAt e completedBy setados', async () => {
      mockCompleteTaskService.mockResolvedValue(SAMPLE_TASK_DONE);

      const res = await app.inject({
        method: 'POST',
        url: `/api/tasks/${TASK_ID}/complete`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<typeof SAMPLE_TASK_DONE>();
      expect(body.status).toBe('done');
      expect(body.completedBy).toBe(USER_ID);
      expect(body.completedAt).toBe(NOW);
    });

    it('8. usuário diferente do claimed_by → service lança ForbiddenError → 403', async () => {
      const { ForbiddenError } = await import('../../../shared/errors.js');
      mockCompleteTaskService.mockRejectedValue(
        new ForbiddenError('Apenas o usuário que assumiu a tarefa pode concluí-la'),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/tasks/${TASK_ID}/complete`,
      });

      expect(res.statusCode).toBe(403);
    });

    it('14. sem tasks:complete → 403', async () => {
      const noCompleteUser = {
        ...TEST_USER_WITH_CITY,
        permissions: ['tasks:read', 'tasks:write', 'tasks:claim'],
      };
      const appNoComplete = await buildTestApp(noCompleteUser);

      const res = await appNoComplete.inject({
        method: 'POST',
        url: `/api/tasks/${TASK_ID}/complete`,
      });

      expect(res.statusCode).toBe(403);
      await appNoComplete.close();
    });
  });

  // ---- POST /api/tasks/:id/cancel ------------------------------------------

  describe('POST /api/tasks/:id/cancel', () => {
    it('9. cancela tarefa (200)', async () => {
      mockCancelTaskService.mockResolvedValue(SAMPLE_TASK_CANCELLED);

      const res = await app.inject({
        method: 'POST',
        url: `/api/tasks/${TASK_ID}/cancel`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<typeof SAMPLE_TASK_CANCELLED>();
      expect(body.status).toBe('cancelled');
    });

    it('10. tarefa já done → service lança ConflictError → 409', async () => {
      const { ConflictError } = await import('../../../shared/errors.js');
      mockCancelTaskService.mockRejectedValue(
        new ConflictError("Tarefa não pode ser cancelada: status atual é 'done'"),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/api/tasks/${TASK_ID}/cancel`,
      });

      expect(res.statusCode).toBe(409);
    });
  });

  // ---- Sem autenticação -------------------------------------------------------

  describe('Autenticação', () => {
    it('15. POST /api/tasks sem auth → 401', async () => {
      const appNoAuth = await buildTestApp(null);

      const res = await appNoAuth.inject({
        method: 'POST',
        url: '/api/tasks',
        payload: {
          assigneeRole: 'agente',
          type: 'spc_inclusion',
          title: 'Test',
        },
      });

      // Authorize mock lança UnauthorizedError quando request.user é null
      expect(res.statusCode).toBe(401);
      await appNoAuth.close();
    });
  });
});
