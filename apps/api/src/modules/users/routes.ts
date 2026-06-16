// =============================================================================
// users/routes.ts — Rotas admin para gestão de usuários (F1-S07).
//
// Todas as rotas sob /api/admin/users exigem:
//   - authenticate(): valida JWT e popula request.user
//   - authorize({ permissions: ['users:manage'] }): verifica permissão
//
// Sem física delete — apenas deactivate (soft-delete via deletedAt).
//
// LGPD: respostas nunca incluem password_hash, refresh_token_hash, totp_secret.
//
// F18-S09: adicionado PATCH /api/users/me/personal-email — self-service (sem authorize).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/authorize.js';

import {
  createUserController,
  deactivateUserController,
  listUsersController,
  patchPersonalEmailController,
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
  patchPersonalEmailBodySchema,
  patchPersonalEmailResponseSchema,
  setCityScopesBodySchema,
  setRolesBodySchema,
  updateUserBodySchema,
  userIdParamSchema,
  userResponseSchema,
} from './schemas.js';

const REQUIRED_PERMISSION = 'users:manage' as const;

// ---------------------------------------------------------------------------
// PATCH /api/users/me/personal-email — self-service (sem authorize) (F18-S09)
//
// Qualquer agente autenticado pode atualizar o próprio personal_email.
// Sem authorize(): o recurso é o próprio usuário (request.user.id).
//
// LGPD (doc 17 §8.1): personal_email é PII — coberto por pino.redact.
// O audit log não persiste o valor do email (apenas '[redacted]').
//
// Registrado como plugin filho dentro de usersRoutes (antes dos hooks admin)
// para herdar o prefix mas não o authorize() hook do pai.
// ---------------------------------------------------------------------------

const usersMeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  app.patch(
    '/api/users/me/personal-email',
    {
      schema: {
        tags: ['Account'],
        summary: 'Atualizar email pessoal',
        description:
          'Atualiza o email pessoal do agente autenticado. O email pessoal é adicionado à ' +
          'lista de bloqueio no cadastro de leads — impede que o agente use o próprio email ' +
          'no lugar do email do cliente. null = remover email pessoal existente. ' +
          'LGPD: campo PII, nunca logado em texto plano.',
        security: [{ bearerAuth: [] }],
        body: patchPersonalEmailBodySchema,
        response: {
          200: patchPersonalEmailResponseSchema,
        },
      },
    },
    patchPersonalEmailController,
  );
};

export const usersRoutes: FastifyPluginAsyncZod = async (app) => {
  // Registrar rotas self-service ANTES dos hooks admin — cada plugin filho tem scope próprio.
  // O hook authenticate() do plugin filho não herda o authorize() do pai (Fastify scoping).
  await app.register(usersMeRoutes);

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
        tags: ['Roles & Users'],
        summary: 'Listar usuarios',
        description: 'Lista usuarios da organizacao com paginacao. Requer permissao users:manage.',
        security: [{ bearerAuth: [] }],
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
        tags: ['Roles & Users'],
        summary: 'Criar usuario',
        description: 'Cria um novo usuario. Requer permissao users:manage.',
        security: [{ bearerAuth: [] }],
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
        tags: ['Roles & Users'],
        summary: 'Atualizar usuario',
        description: 'Atualiza dados de um usuario. Requer permissao users:manage.',
        security: [{ bearerAuth: [] }],
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
        tags: ['Roles & Users'],
        summary: 'Desativar usuario',
        description: 'Desativa (soft-delete) um usuario. Requer permissao users:manage.',
        security: [{ bearerAuth: [] }],
        params: userIdParamSchema,
        response: { 204: { description: 'Sem conteúdo.' } },
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
        tags: ['Roles & Users'],
        summary: 'Reativar usuario',
        description: 'Reativa um usuario desativado. Requer permissao users:manage.',
        security: [{ bearerAuth: [] }],
        params: userIdParamSchema,
        response: { 204: { description: 'Sem conteúdo.' } },
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
        tags: ['Roles & Users'],
        summary: 'Definir papeis',
        description: 'Substitui os papeis de um usuario. Requer permissao users:manage.',
        security: [{ bearerAuth: [] }],
        params: userIdParamSchema,
        body: setRolesBodySchema,
        response: { 204: { description: 'Sem conteúdo.' } },
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
        tags: ['Roles & Users'],
        summary: 'Definir escopos de cidade',
        description: 'Substitui os escopos de cidade de um usuario. Requer permissao users:manage.',
        security: [{ bearerAuth: [] }],
        params: userIdParamSchema,
        body: setCityScopesBodySchema,
        response: { 204: { description: 'Sem conteúdo.' } },
      },
    },
    setUserCityScopesController,
  );
};
