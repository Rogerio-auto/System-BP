// =============================================================================
// kanban/routes.ts — Rotas do módulo kanban (F1-S13).
//
// Rotas:
//   GET  /api/kanban/stages            — lista stages do board (RBAC: leads:read)
//   GET  /api/kanban/cards             — lista cards com city-scope (RBAC: leads:read)
//   POST /api/kanban/cards/:id/move    — move um card para outro stage (RBAC: kanban:move)
//
// RBAC:
//   GET routes: leads:read — já concedida a admin, gestor_geral, gestor_regional,
//               agente e operador. Pragmático: ver o board é parte de gerenciar leads.
//   POST move:  kanban:move — permissão específica de movimentação.
//
//   City-scope nas GET routes: aplicado no service/repository via leads.cityId.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate, authorize } from '../auth/middlewares/index.js';

import { listCardsController, listStagesController, moveCardController } from './controller.js';
import {
  kanbanCardResponseSchema,
  kanbanCardsListResponseSchema,
  kanbanStagesListResponseSchema,
  listCardsQuerySchema,
  moveCardBodySchema,
} from './schemas.js';

export const kanbanRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------------------
  // GET /api/kanban/stages
  // ---------------------------------------------------------------------------
  app.get(
    '/api/kanban/stages',
    {
      preHandler: [authenticate(), authorize({ permissions: ['leads:read'] })],
      schema: {
        // Nota: fastify-type-provider-zod 4.x não suporta z.array() como
        // schema de resposta de top-level — apenas z.object(). Usamos
        // kanbanStagesListResponseSchema (wrapper de objeto) para serialização
        // e o controller envia { stages: [...] }.
        // O frontend (useKanbanStages) precisará ser ajustado de KanbanStage[]
        // para KanbanStagesListResponse (TODO no hook).
        response: {
          200: kanbanStagesListResponseSchema,
        },
      },
    },
    listStagesController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/kanban/cards
  // ---------------------------------------------------------------------------
  app.get(
    '/api/kanban/cards',
    {
      preHandler: [authenticate(), authorize({ permissions: ['leads:read'] })],
      schema: {
        querystring: listCardsQuerySchema,
        response: {
          200: kanbanCardsListResponseSchema,
        },
      },
    },
    listCardsController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/kanban/cards/:id/move
  // ---------------------------------------------------------------------------
  app.post(
    '/api/kanban/cards/:id/move',
    {
      preHandler: [authenticate(), authorize({ permissions: ['kanban:move'] })],
      schema: {
        params: z.object({
          id: z.string().uuid({ message: 'Card ID deve ser um UUID válido' }),
        }),
        body: moveCardBodySchema,
        response: {
          200: kanbanCardResponseSchema,
        },
      },
    },
    moveCardController,
  );
};
