// =============================================================================
// roles/routes.ts — Rotas admin de roles (F8-S06).
//
// GET /api/admin/roles — lista roles disponíveis da organização.
//   Requer: authenticate() + authorize({ permissions: ['users:admin'] })
//   (mesma permissão da gestão de usuários — roles é suporte a essa tela)
//
// Sem paginação: poucas roles por org.
// Sem mutation: somente leitura — sem audit log.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import { listRolesController } from './controller.js';
import { listRolesResponseSchema } from './schemas.js';

export const rolesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------------------
  // GET /api/admin/roles
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/roles',
    {
      schema: {
        response: {
          200: listRolesResponseSchema,
        },
      },
      preHandler: [authenticate(), authorize({ permissions: ['users:admin'] })],
    },
    listRolesController,
  );
};
