// =============================================================================
// ai-console/decisions/routes.ts — Rotas do módulo ai_decision_logs (F9-S02).
//
// Prefixo registrado em app.ts: /api/ai-console/decisions
//
// Rotas:
//   GET /                — lista paginada (cursor-based) (ai_decisions:read)
//   GET /timeline        — timeline de uma conversa (ai_decisions:read)
//
// RBAC (doc 10 §3.2 + §74):
//   ai_decisions:read → admin, gestor_geral, gestor_regional
//   Escopo de cidade aplicado via JOIN leads.city_id no repository.
//   Decisões lead_id IS NULL visíveis APENAS a admin/gestor_geral.
//
// Sem write — tabela append-only, escrita é do LangGraph via /internal/*.
// Sem audit — alto volume, geraria ruído excessivo.
// Sem outbox — read-only, sem side effects.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate, authorize } from '../../auth/middlewares/index.js';

import { getTimelineController, listDecisionsController } from './controller.js';
import {
  listDecisionsQuerySchema,
  listDecisionsResponseSchema,
  timelineQuerySchema,
  timelineResponseSchema,
} from './schemas.js';

export const decisionsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET / — listagem paginada de decisões (cursor-based)
  // -------------------------------------------------------------------------
  app.get(
    '/',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_decisions:read'] })],
      schema: {
        querystring: listDecisionsQuerySchema,
        response: {
          200: listDecisionsResponseSchema,
        },
      },
    },
    listDecisionsController,
  );

  // -------------------------------------------------------------------------
  // GET /timeline — timeline cronológica de uma conversa
  // -------------------------------------------------------------------------
  app.get(
    '/timeline',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_decisions:read'] })],
      schema: {
        querystring: timelineQuerySchema,
        response: {
          200: timelineResponseSchema,
        },
      },
    },
    getTimelineController,
  );
};
