// =============================================================================
// kanban/routes.ts — Rotas do módulo kanban (F1-S13).
//
// Rotas:
//   POST /api/kanban/cards/:id/move — move um card para outro stage
//
// RBAC:
//   Requer autenticação + permissão 'kanban:move'.
//   RBAC city-scope é aplicado no service via organization_id do actor.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate, authorize } from '../auth/middlewares/index.js';

import { moveCardController } from './controller.js';
import { moveCardBodySchema, kanbanCardResponseSchema } from './schemas.js';

export const kanbanRoutes: FastifyPluginAsyncZod = async (app) => {
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
