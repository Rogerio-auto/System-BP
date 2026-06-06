// =============================================================================
// ai-console/playground/routes.ts — Rotas do módulo playground (F9-S04).
//
// Prefixo registrado em app.ts: /api/ai-console/playground
//
// Rotas:
//   POST /  — executa dry-run do grafo LangGraph com DLP na mensagem do operador
//
// RBAC (doc 10 §3.2 + matriz de papéis):
//   ai_playground:run → admin only
//   Gestor_geral e abaixo → 403.
//
// LGPD (doc 17 §8.4):
//   - Header Idempotency-Key optional — propaga idempotência ao outbox.
//   - Body.message não aparece em logs (pino.redact cobre '*.message').
//   - dlp_tokens não aparece em logs (pino.redact cobre '*.dlp_tokens').
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate, authorize } from '../../auth/middlewares/index.js';

import { runPlaygroundController } from './controller.js';
import { playgroundBodySchema, playgroundResponseSchema } from './schemas.js';

export const playgroundRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST / — executa o playground dry-run (admin only)
  // -------------------------------------------------------------------------
  app.post(
    '/',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_playground:run'] })],
      schema: {
        tags: ['AI Console'],
        summary: 'Playground dry-run',
        description: 'Executa um dry-run no playground de IA com DLP aplicado na entrada.',
        security: [{ bearerAuth: [] }],
        body: playgroundBodySchema,
        response: {
          200: playgroundResponseSchema,
        },
        headers: z
          .object({
            // Idempotency-Key é opcional — garante deduplicação no outbox
            'idempotency-key': z.string().uuid().optional(),
          })
          .passthrough(),
      },
    },
    runPlaygroundController,
  );
};
