// =============================================================================
// followup/routes.ts — Rotas do módulo de follow-up (F5-S05).
//
// Rotas:
//   GET    /api/followup/rules          — lista réguas (followup:read)
//   POST   /api/followup/rules          — criar régua (followup:write)
//   PATCH  /api/followup/rules/:id      — atualizar régua (followup:write)
//   GET    /api/followup/jobs           — lista jobs com filtros (followup:read)
//   POST   /api/followup/jobs/:id/cancel — cancela job (followup:cancel_job)
//
// RBAC:
//   - Todas exigem authenticate().
//   - followup:read     → listagem de rules + jobs.
//   - followup:write    → criação e edição de rules.
//   - followup:cancel_job → cancelamento manual de job agendado.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  cancelJobController,
  createRuleController,
  listJobsController,
  listRulesController,
  updateRuleController,
} from './controller.js';
import {
  FollowupJobResponseSchema,
  FollowupJobsListQuerySchema,
  FollowupJobsListResponseSchema,
  FollowupRuleCreateSchema,
  FollowupRuleResponseSchema,
  FollowupRulesListResponseSchema,
  FollowupRuleUpdateSchema,
  jobIdParamSchema,
  ruleIdParamSchema,
} from './schemas.js';

export const followupRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/followup/rules
  // ---------------------------------------------------------------------------
  app.get(
    '/api/followup/rules',
    {
      schema: {
        tags: ['Follow-up'],
        summary: 'Listar regras de follow-up',
        description: 'Lista as regras de follow-up automatizado.',
        security: [{ bearerAuth: [] }],
        response: {
          200: FollowupRulesListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['followup:read'] })],
    },
    listRulesController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/followup/rules
  // ---------------------------------------------------------------------------
  app.post(
    '/api/followup/rules',
    {
      schema: {
        tags: ['Follow-up'],
        summary: 'Criar regra de follow-up',
        description: 'Cria uma nova regra de follow-up.',
        security: [{ bearerAuth: [] }],
        body: FollowupRuleCreateSchema,
        response: {
          201: FollowupRuleResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['followup:write'] })],
    },
    createRuleController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/followup/rules/:id
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/followup/rules/:id',
    {
      schema: {
        tags: ['Follow-up'],
        summary: 'Atualizar regra de follow-up',
        description: 'Atualiza uma regra de follow-up.',
        security: [{ bearerAuth: [] }],
        params: ruleIdParamSchema,
        body: FollowupRuleUpdateSchema,
        response: {
          200: FollowupRuleResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['followup:write'] })],
    },
    updateRuleController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/followup/jobs
  // ---------------------------------------------------------------------------
  app.get(
    '/api/followup/jobs',
    {
      schema: {
        tags: ['Follow-up'],
        summary: 'Listar jobs de follow-up',
        description: 'Lista jobs de follow-up com seu status.',
        security: [{ bearerAuth: [] }],
        querystring: FollowupJobsListQuerySchema,
        response: {
          200: FollowupJobsListResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['followup:read'] })],
    },
    listJobsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/followup/jobs/:id/cancel
  // ---------------------------------------------------------------------------
  app.post(
    '/api/followup/jobs/:id/cancel',
    {
      schema: {
        tags: ['Follow-up'],
        summary: 'Cancelar job de follow-up',
        description: 'Cancela um job de follow-up pendente.',
        security: [{ bearerAuth: [] }],
        params: jobIdParamSchema,
        response: {
          200: FollowupJobResponseSchema,
        },
      },
      preHandler: [authorize({ permissions: ['followup:cancel_job'] })],
    },
    cancelJobController,
  );
};
