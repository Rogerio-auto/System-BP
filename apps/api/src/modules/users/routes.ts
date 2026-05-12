// =============================================================================
// users/routes.ts — Rotas admin para gestão de usuários (F1-S07).
//
// Todas as rotas sob /api/admin/users exigem:
//   - authenticate(): valida JWT e popula request.user
//   - authorize({ permissions: ['users:admin'] }): verifica permissão
//
// Sem física delete — apenas deactivate (soft-delete via deletedAt).
//
// LGPD: respostas nunca incluem password_hash, refresh_token_hash, totp_secret.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createUserController,
  deactivateUserController,
  listUsersController,
  reactivateUserController,
  setUserCityScopesController,
  setUserRolesController,
  updateUserController,
} from './controller.js';
import {
  createUserBodySchema,
  createUserResponseSchema,
  listUsersQuerySchema,
  listUsersResponseSchema,
  setCityScopesBodySchema,
  setRolesBodySchema,
  updateUserBodySchema,
  userIdParamSchema,
  userResponseSchema,
} from './schemas.js';

const REQUIRED_PERMISSION = 'users:admin' as const;

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  // Aplicar authenticate + authorize em todas as rotas deste plugin
  app.addHook('preHandler', authenticate());
  app.addHook('preHandler', authorize({ permissions: [REQUIRED_PERMISSION] }));

  // ---------------------------------------------------------------------------
  // GET /api/admin/users — listar usuários com paginação
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/users',
    {
      schema: {
        querystring: listUsersQuerySchema,
        response: {
          200: listUsersResponseSchema,
        },
      },
    },
    listUsersController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/admin/users — criar usuário
  // ---------------------------------------------------------------------------
  app.post(
    '/api/admin/users',
    {
      schema: {
        body: createUserBodySchema,
        response: {
          201: createUserResponseSchema,
        },
      },
    },
    createUserController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/admin/users/:id — atualizar usuário
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/admin/users/:id',
    {
      schema: {
        params: userIdParamSchema,
        body: updateUserBodySchema,
        response: {
          200: userResponseSchema,
        },
      },
    },
    updateUserController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/admin/users/:id/deactivate — desativar usuário (soft-delete)
  // ---------------------------------------------------------------------------
  app.post(
    '/api/admin/users/:id/deactivate',
    {
      schema: {
        params: userIdParamSchema,
        response: {
          204: z.void(),
        },
      },
    },
    deactivateUserController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/admin/users/:id/reactivate — reativar usuário
  // ---------------------------------------------------------------------------
  app.post(
    '/api/admin/users/:id/reactivate',
    {
      schema: {
        params: userIdParamSchema,
        response: {
          204: z.void(),
        },
      },
    },
    reactivateUserController,
  );

  // ---------------------------------------------------------------------------
  // PUT /api/admin/users/:id/roles — substituir roles do usuário
  // ---------------------------------------------------------------------------
  app.put(
    '/api/admin/users/:id/roles',
    {
      schema: {
        params: userIdParamSchema,
        body: setRolesBodySchema,
        response: {
          204: z.void(),
        },
      },
    },
    setUserRolesController,
  );

  // ---------------------------------------------------------------------------
  // PUT /api/admin/users/:id/city-scopes — substituir city scopes do usuário
  // ---------------------------------------------------------------------------
  app.put(
    '/api/admin/users/:id/city-scopes',
    {
      schema: {
        params: userIdParamSchema,
        body: setCityScopesBodySchema,
        response: {
          204: z.void(),
        },
      },
    },
    setUserCityScopesController,
  );
};
