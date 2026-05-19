// =============================================================================
// account/routes.ts — Rotas self-service de conta (F8-S09 / F8-S11).
//
// Todos os endpoints:
//   - authenticate(): valida JWT e popula request.user.
//   - SEM authorize(): o recurso é o próprio usuário — sem privilégio adicional.
//   - Operam sempre sobre request.user.id. NUNCA sobre userId de body/params.
//
// Rotas:
//   GET   /api/account/profile        — perfil do próprio usuário
//   PATCH /api/account/profile        — edita full_name (email é imutável via self-service)
//   POST  /api/account/password       — troca de senha + revogação de outras sessões
//   GET   /api/account/2fa/status     — status do 2FA (enabled: boolean)
//   POST  /api/account/2fa/enroll     — gera secret pendente + URI otpauth (QR)
//   POST  /api/account/2fa/activate   — confirma código TOTP, ativa 2FA, retorna recovery codes
//   POST  /api/account/2fa/disable    — desativa 2FA (exige código TOTP ou recovery code)
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate } from '../auth/middlewares/authenticate.js';

import {
  activate2faController,
  changePasswordController,
  disable2faController,
  enroll2faController,
  get2faStatusController,
  getProfileController,
  updateProfileController,
} from './controller.js';
import {
  changePasswordBodySchema,
  profileResponseSchema,
  twoFactorActivateBodySchema,
  twoFactorActivateResponseSchema,
  twoFactorDisableBodySchema,
  twoFactorEnrollResponseSchema,
  twoFactorStatusResponseSchema,
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

  // ---------------------------------------------------------------------------
  // GET /api/account/2fa/status — verifica se o 2FA está ativo
  // ---------------------------------------------------------------------------
  app.get(
    '/api/account/2fa/status',
    {
      schema: {
        response: {
          200: twoFactorStatusResponseSchema,
        },
      },
    },
    get2faStatusController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/account/2fa/enroll — inicia o processo de ativação
  //
  // Gera um secret TOTP pendente (não ativa o 2FA), retorna o URI otpauth
  // para o frontend renderizar QR e o secret base32 para entrada manual.
  //
  // Rate limit: 5 req / 15 min por IP (herda o global de app.ts = 100/min;
  //   o enforcement de negócio é via estado pendente no DB).
  // ---------------------------------------------------------------------------
  app.post(
    '/api/account/2fa/enroll',
    {
      schema: {
        response: {
          200: twoFactorEnrollResponseSchema,
        },
      },
    },
    enroll2faController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/account/2fa/activate — confirma código e ativa o 2FA
  //
  // Recebe o código TOTP de 6 dígitos gerado pelo app autenticador.
  // Se válido: ativa o 2FA e retorna os recovery codes (UMA ÚNICA VEZ).
  // Se inválido: 401 genérico (não revelar se o secret existe ou expirou).
  // ---------------------------------------------------------------------------
  app.post(
    '/api/account/2fa/activate',
    {
      schema: {
        body: twoFactorActivateBodySchema,
        response: {
          200: twoFactorActivateResponseSchema,
        },
      },
    },
    activate2faController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/account/2fa/disable — desativa o 2FA
  //
  // Exige um código TOTP válido OU um recovery code.
  // Desativa o 2FA, limpa o secret e os recovery codes.
  // Audit log account.2fa_disabled.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/account/2fa/disable',
    {
      schema: {
        body: twoFactorDisableBodySchema,
        response: {
          204: z.void(),
        },
      },
    },
    disable2faController,
  );
};
