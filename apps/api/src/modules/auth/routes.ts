// =============================================================================
// auth/routes.ts — Rotas de autenticação (F1-S02 / F8-S11).
//
// Registra @fastify/cookie neste escopo (encapsulamento Fastify).
// Rate-limit por IP para /login e /verify-2fa: 5 req / 15min (doc 10 §2.1).
//
// Rotas:
//   POST /api/auth/login      — credenciais válidas → sessão ou challenge 2FA
//   POST /api/auth/verify-2fa — troca challenge + código TOTP/recovery → sessão
//   POST /api/auth/refresh    — rotaciona sessão (cookie + X-CSRF-Token)
//   POST /api/auth/logout     — revoga sessão (204)
//
// Fluxo com 2FA:
//   POST /api/auth/login → { status: '2fa_required', challenge_token }
//   POST /api/auth/verify-2fa → { status: 'ok', access_token, ... }
// =============================================================================
import cookie from '@fastify/cookie';
// NOTA: @fastify/rate-limit precisa ser registrado em app.ts (follow-up). A config
// `rateLimit:` por rota abaixo só ativa quando o plugin estiver registrado globalmente.
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  loginController,
  refreshController,
  logoutController,
  verify2faController,
} from './controller.js';
import {
  loginBodySchema,
  loginResponseSchema,
  refreshBodySchema,
  refreshResponseSchema,
  logoutBodySchema,
  loginChallenge2faResponseSchema,
  verify2faBodySchema,
} from './schemas.js';

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // Registrar @fastify/cookie neste escopo.
  // Plugin encapsulado: request.cookies disponível apenas dentro de authRoutes
  // e seus filhos. Quando outros módulos precisarem de cookies, registrar no root (app.ts).
  await app.register(cookie, {
    // Sem secret global (cookies de refresh são JWTs auto-assinados).
    // Signed cookies não são usados aqui — autenticidade vem da assinatura JWT.
  });

  // ---------------------------------------------------------------------------
  // POST /api/auth/login
  // Rate-limit específico: 5 tentativas / 15min / IP (brute-force protection)
  //
  // Resposta possível:
  //   - { status: 'ok', access_token, ... }         → login sem 2FA
  //   - { status: '2fa_required', challenge_token }  → login com 2FA ativo
  // ---------------------------------------------------------------------------
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(
              new Error('Muitas tentativas de login. Aguarde 15 minutos.'),
              {
                statusCode: context.statusCode,
                code: 'RATE_LIMITED',
              },
            );
            return err;
          },
        },
      },
      schema: {
        body: loginBodySchema,
        // União de schemas: login normal OR challenge 2FA.
        // Fastify serializa conforme o discriminador status.
        response: {
          200: loginResponseSchema.or(loginChallenge2faResponseSchema),
        },
      },
    },
    loginController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/auth/verify-2fa
  // Troca challenge_token + código TOTP/recovery por sessão completa.
  // Rate-limit idêntico ao login (proteção contra brute force no 2FA).
  // ---------------------------------------------------------------------------
  app.post(
    '/api/auth/verify-2fa',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(new Error('Muitas tentativas. Aguarde 15 minutos.'), {
              statusCode: context.statusCode,
              code: 'RATE_LIMITED',
            });
            return err;
          },
        },
      },
      schema: {
        body: verify2faBodySchema,
        response: {
          200: loginResponseSchema,
        },
      },
    },
    verify2faController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/auth/refresh
  // Sem rate-limit restritivo (token inválido já falha rápido no service).
  // ---------------------------------------------------------------------------
  app.post(
    '/api/auth/refresh',
    {
      schema: {
        body: refreshBodySchema,
        response: {
          200: refreshResponseSchema,
        },
      },
    },
    refreshController,
  );

  // ---------------------------------------------------------------------------
  // POST /api/auth/logout
  // Retorna 204 No Content.
  // ---------------------------------------------------------------------------
  app.post(
    '/api/auth/logout',
    {
      schema: {
        body: logoutBodySchema,
        response: {
          204: z.void(),
        },
      },
    },
    logoutController,
  );
};
