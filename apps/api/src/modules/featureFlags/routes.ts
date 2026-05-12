// =============================================================================
// featureFlags/routes.ts — Rotas do módulo feature flags (F1-S23).
//
// Rotas:
//   GET  /api/admin/feature-flags        — lista todas (admin/superadmin)
//   PATCH /api/admin/feature-flags/:key  — toggle/update (admin/superadmin)
//   GET  /api/feature-flags/me           — flags do usuário autenticado
//
// RBAC:
//   admin endpoints exigem permissão 'flags:manage' (ou role admin/superadmin).
//   /api/feature-flags/me exige apenas autenticação.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/index.js';
import { authorize } from '../auth/middlewares/index.js';

import { listFlagsController, patchFlagController, getMyFlagsController } from './controller.js';
import { featureFlagSchema, patchFeatureFlagBodySchema, myFlagsResponseSchema } from './schemas.js';

export const featureFlagsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------------------
  // GET /api/admin/feature-flags — lista todas as flags (admin)
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/feature-flags',
    {
      preHandler: [authenticate(), authorize({ permissions: ['flags:manage'] })],
      schema: {
        response: {
          200: z.array(featureFlagSchema),
        },
      },
    },
    listFlagsController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/feature-flags/:key — atualiza uma flag (admin)
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/admin/feature-flags/:key',
    {
      preHandler: [authenticate(), authorize({ permissions: ['flags:manage'] })],
      schema: {
        params: z.object({ key: z.string().min(1) }),
        body: patchFeatureFlagBodySchema,
        response: {
          200: featureFlagSchema,
        },
      },
    },
    patchFlagController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/feature-flags/me — flags filtradas por audience para o usuário
  // ---------------------------------------------------------------------------
  app.get(
    '/api/feature-flags/me',
    {
      preHandler: [authenticate()],
      schema: {
        response: {
          200: myFlagsResponseSchema,
        },
      },
    },
    getMyFlagsController,
  );
};
