// =============================================================================
// roles/routes.ts — Rotas admin de papéis & permissões.
//
// GET  /api/admin/permissions              → catálogo de permissões por módulo
//   Requer: authenticate() + authorize({ permissions: ['users:manage'] })
//
// GET  /api/admin/roles                    → lista roles com permissões atribuídas
//   Requer: authenticate() + authorize({ permissions: ['users:manage'] })
//
// PUT  /api/admin/roles/:id/permissions    → substituição total de permissões do role
//   Requer: authenticate() + authorize({ permissions: ['users:assign_privileged_roles'] })
//
// Sem paginação em GET /roles: poucas roles por instalação.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  listPermissionsController,
  listRolesController,
  updateRolePermissionsController,
} from './controller.js';
import {
  listPermissionsResponseSchema,
  listRolesResponseSchema,
  roleIdParamSchema,
  roleResponseSchema,
  updateRolePermissionsBodySchema,
} from './schemas.js';

export const rolesRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------------------
  // GET /api/admin/permissions — catálogo de permissões agrupado por módulo
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/permissions',
    {
      schema: {
        tags: ['Roles & Users'],
        summary: 'Listar permissões',
        description:
          'Retorna o catálogo completo de permissões granulares disponíveis no sistema, ' +
          'agrupadas por módulo funcional e ordenadas por módulo depois por chave. ' +
          'Usado pela tela de matriz role×permissão para montar as colunas disponíveis. ' +
          'Requer permissão users:manage.',
        security: [{ bearerAuth: [] }],
        response: {
          200: listPermissionsResponseSchema,
        },
      },
      preHandler: [authenticate(), authorize({ permissions: ['users:manage'] })],
    },
    listPermissionsController,
  );

  // ---------------------------------------------------------------------------
  // GET /api/admin/roles — lista roles com permissões atribuídas
  // ---------------------------------------------------------------------------
  app.get(
    '/api/admin/roles',
    {
      schema: {
        tags: ['Roles & Users'],
        summary: 'Listar papeis',
        description:
          'Lista todos os papeis (roles) disponíveis na instalação com as permissões ' +
          'atribuídas a cada um. Uma única query batch (LEFT JOIN) sem N+1. ' +
          'Requer permissão users:manage.',
        security: [{ bearerAuth: [] }],
        response: {
          200: listRolesResponseSchema,
        },
      },
      preHandler: [authenticate(), authorize({ permissions: ['users:manage'] })],
    },
    listRolesController,
  );

  // ---------------------------------------------------------------------------
  // PUT /api/admin/roles/:id/permissions — substituição total de permissões
  // ---------------------------------------------------------------------------
  app.put(
    '/api/admin/roles/:id/permissions',
    {
      schema: {
        tags: ['Roles & Users'],
        summary: 'Atualizar permissões de um papel',
        description:
          'Substitui a lista completa de permissões de um papel (role). ' +
          'Operação de substituição total: permissões não listadas no body são removidas. ' +
          'Guardas: role não encontrado → 404; role admin → 422 (imutável); ' +
          'chave de permissão inválida → 422 listando as chaves rejeitadas. ' +
          'Requer permissão users:assign_privileged_roles.',
        security: [{ bearerAuth: [] }],
        params: roleIdParamSchema,
        body: updateRolePermissionsBodySchema,
        response: {
          200: roleResponseSchema,
        },
      },
      preHandler: [authenticate(), authorize({ permissions: ['users:assign_privileged_roles'] })],
    },
    updateRolePermissionsController,
  );
};
