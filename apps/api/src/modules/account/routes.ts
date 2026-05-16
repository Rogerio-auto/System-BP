// =============================================================================
// account/routes.ts — Rotas self-service de conta (F8-S09).
//
// Todos os endpoints:
//   - authenticate(): valida JWT e popula request.user.
//   - SEM authorize(): o recurso é o próprio usuário — sem privilégio adicional.
//   - Operam sempre sobre request.user.id. NUNCA sobre userId de body/params.
//
// Rotas:
//   GET   /api/account/profile  — perfil do próprio usuário
//   PATCH /api/account/profile  — edita full_name (email é imutável via self-service)
//   POST  /api/account/password — troca de senha + revogação de outras sessões
//
// 2FA / TOTP: FORA DE ESCOPO deste slot. A coluna users.totp_secret existe, mas
//   o fluxo TOTP (enroll, verify, recovery) merece um slot dedicado (slot futuro).
//   A seção Segurança do frontend exibe "2FA — Em breve".
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';

import {
  changePasswordController,
  getProfileController,
  updateProfileController,
} from './controller.js';
import {
  changePasswordBodySchema,
  profileResponseSchema,
  updateProfileBodySchema,
} from './schemas.js';

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  // Autenticação obrigatória em todas as rotas deste plugin.
  // SEM authorize — o recurso é o próprio usuário autenticado.
  app.addHook('preHandler', authenticate());

  // ---------------------------------------------------------------------------
  // GET /api/account/profile
  // ---------------------------------------------------------------------------
  app.get(
    '/api/account/profile',
    {
      schema: {
        response: {
          200: profileResponseSchema,
        },
      },
    },
    getProfileController,
  );

  // ---------------------------------------------------------------------------
  // PATCH /api/account/profile — edita full_name (email imutável via self-service)
  // ---------------------------------------------------------------------------
  app.patch(
    '/api/account/profile',
    {
      schema: {
        body: updateProfileBodySchema,
        response: {
          200: profileResponseSchema,
        },
      },
    },
    updateProfileController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/account/password — troca de senha
  //
  // Segurança:
  //   - currentPassword verificado via bcrypt (tempo constante).
  //   - newPassword re-hashed com bcrypt cost 12.
  //   - Outras sessões do usuário revogadas na mesma transação.
  //   - Audit log account.password_changed (sem senhas no log).
  // ---------------------------------------------------------------------------
  app.post(
    '/api/account/password',
    {
      schema: {
        body: changePasswordBodySchema,
        response: {
          204: z.void(),
        },
      },
    },
    changePasswordController,
  );
};
