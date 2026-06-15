// =============================================================================
// tasks/routes.ts — Rotas do módulo de tarefas (F15-S05).
//
// Rotas:
//   GET    /api/tasks              — minhas tarefas (role + cidade do usuário autenticado)
//   POST   /api/tasks              — criar tarefa (tasks:write)
//   POST   /api/tasks/:id/claim    — assumir tarefa (tasks:claim)
//   POST   /api/tasks/:id/complete — concluir tarefa assumida (tasks:complete)
//   POST   /api/tasks/:id/cancel   — cancelar tarefa (tasks:write)
//
// RBAC:
//   - tasks:read     → GET /api/tasks (visualizar fila pessoal)
//   - tasks:write    → POST (criar + cancelar)
//   - tasks:claim    → POST /:id/claim
//   - tasks:complete → POST /:id/complete
//
// Idempotência via header Idempotency-Key (opcional em create e complete).
// Autenticação obrigatória em todas as rotas via addHook preHandler.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  cancelTaskController,
  claimTaskController,
  completeTaskController,
  createTaskController,
  listTasksController,
} from './controller.js';
import {
  TaskCreateBodySchema,
  TaskResponseSchema,
  TasksListQuerySchema,
  TasksListResponseSchema,
  taskIdParamSchema,
} from './schemas.js';

export const tasksRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/tasks
  //
  // Retorna as tarefas visíveis para o usuário autenticado:
  //   - tasks cujo assignee_role corresponde a um role do usuário
  //   - E cujo city_id está no scope do usuário (ou é NULL = tarefa global)
  // ---------------------------------------------------------------------------
  app.get(
    '/api/tasks',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Listar minhas tarefas',
        description:
          'Retorna as tarefas pendentes para o usuário autenticado, ' +
          'resolvidas por role e escopo de cidade. ' +
          'Um usuário vê uma tarefa quando possui o `assignee_role` da tarefa ' +
          'e a tarefa pertence a uma de suas cidades ou é global (`city_id` nulo).',
        security: [{ bearerAuth: [] }],
        querystring: TasksListQuerySchema,
        response: {
          200: TasksListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['tasks:read'] })],
    },
    listTasksController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/tasks
  //
  // Cria uma nova tarefa atribuída a um role de cidade.
  // Suporta Idempotency-Key header para evitar duplicatas em retry.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/tasks',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Criar tarefa',
        description:
          'Cria uma nova tarefa atribuída a um role canônico (doc 10 §3.1). ' +
          'Tarefas com `cityId` são visíveis apenas para usuários com escopo naquela cidade. ' +
          'Tarefas sem `cityId` são globais (visíveis para qualquer cidade da organização). ' +
          'Suporta header `Idempotency-Key` (UUID) para evitar criação duplicada em retry.',
        security: [{ bearerAuth: [] }],
        body: TaskCreateBodySchema,
        response: {
          201: TaskResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['tasks:write'] })],
    },
    createTaskController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/tasks/:id/claim
  //
  // Assume uma tarefa: open → in_progress.
  // Apenas usuários com o assignee_role da tarefa e no scope de cidade podem assumir.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/tasks/:id/claim',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Assumir tarefa',
        description:
          'Marca uma tarefa como assumida pelo usuário autenticado, ' +
          'alterando o status de `open` para `in_progress`. ' +
          'O usuário deve possuir o `assignee_role` da tarefa e estar no escopo de cidade correto. ' +
          'Em caso de race condition (dois usuários tentam assumir simultaneamente), ' +
          'apenas um terá sucesso — o outro receberá 409.',
        security: [{ bearerAuth: [] }],
        params: taskIdParamSchema,
        response: {
          200: TaskResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['tasks:claim'] })],
    },
    claimTaskController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/tasks/:id/complete
  //
  // Conclui uma tarefa: in_progress → done.
  // Apenas quem fez o claim pode concluir.
  // Suporta Idempotency-Key para retry seguro.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/tasks/:id/complete',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Concluir tarefa',
        description:
          'Marca uma tarefa como concluída, alterando o status de `in_progress` para `done`. ' +
          'Apenas o usuário que assumiu a tarefa (`claimed_by`) pode concluí-la. ' +
          'Suporta header `Idempotency-Key` (UUID) para retry seguro em caso de falha de rede.',
        security: [{ bearerAuth: [] }],
        params: taskIdParamSchema,
        response: {
          200: TaskResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['tasks:complete'] })],
    },
    completeTaskController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/tasks/:id/cancel
  //
  // Cancela uma tarefa: open|in_progress → cancelled.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/tasks/:id/cancel',
    {
      schema: {
        tags: ['Tasks'],
        summary: 'Cancelar tarefa',
        description:
          'Cancela uma tarefa que ainda não foi concluída, ' +
          'alterando o status para `cancelled`. ' +
          'Tarefas já `done` ou `cancelled` não podem ser canceladas (409).',
        security: [{ bearerAuth: [] }],
        params: taskIdParamSchema,
        response: {
          200: TaskResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['tasks:write'] })],
    },
    cancelTaskController,
  );
};
