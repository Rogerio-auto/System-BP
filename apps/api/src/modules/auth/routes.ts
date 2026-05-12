// =============================================================================
// auth/routes.ts — Rotas de autenticação.
//
// Registra @fastify/cookie neste escopo (encapsulamento Fastify).
// Rate-limit por IP para /login: 5 req / 15min (doc 10 §2.1, §6.6).
//
// Rotas:
//   POST /api/auth/login   — emite access+refresh+csrf
//   POST /api/auth/refresh — rotaciona sessão (cookie + header X-CSRF-Token)
//   POST /api/auth/logout  — revoga sessão (204)
//
// Nota: /logout não requer middleware authenticate() (F1-S04) por ora — o
//   refresh token no cookie identifica a sessão. Quando F1-S04 existir,
//   adicionar preHandler: [authenticate()] no logout.
// =============================================================================
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import {
  loginBodySchema,
  loginResponseSchema,
  refreshBodySchema,
  refreshResponseSchema,
  logoutBodySchema,
} from './schemas.js';
import { loginController, refreshController, logoutController } from './controller.js';

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
  // ---------------------------------------------------------------------------
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
          // errorResponseBuilder deve retornar um Error com statusCode para que
          // o Fastify defina corretamente o status HTTP 429.
          // O objeto simples não funciona — o plugin faz `throw` do retorno deste builder.
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(new Error('Muitas tentativas de login. Aguarde 15 minutos.'), {
              statusCode: context.statusCode,
              code: 'RATE_LIMITED',
            });
            return err;
          },
        },
      },
      schema: {
        body: loginBodySchema,
        response: {
          200: loginResponseSchema,
        },
      },
    },
    loginController,
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
