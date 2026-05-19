// =============================================================================
// ai-console/prompts/routes.ts — Rotas do módulo prompt_versions (F9-S01).
//
// Prefixo registrado em app.ts: /api/ai-console/prompts
//
// Rotas:
//   GET  /                           — lista keys com versão ativa (ai_prompts:read)
//   GET  /:key/versions              — histórico de versões (ai_prompts:read)
//   GET  /:key/versions/:version     — detalhe da versão (ai_prompts:read)
//   POST /:key/versions              — cria nova versão (ai_prompts:write)
//   POST /:key/versions/:version/activate — ativa versão (ai_prompts:activate)
//
// RBAC (doc 10 §3.2):
//   GET (todas)       → ai_prompts:read     (admin + gestor_geral)
//   POST nova versão  → ai_prompts:write    (admin)
//   POST activate     → ai_prompts:activate (admin)
//
// Sem escopo de cidade — prompts são globais de plataforma.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { authenticate, authorize } from '../../auth/middlewares/index.js';

import {
  activateVersionController,
  createVersionController,
  getVersionController,
  listPromptKeysController,
  listVersionsController,
} from './controller.js';
import {
  activatePromptVersionResponseSchema,
  createPromptVersionBodySchema,
  promptKeyListResponseSchema,
  promptKeyParamSchema,
  promptVersionListResponseSchema,
  promptVersionParamsSchema,
  promptVersionResponseSchema,
} from './schemas.js';

export const promptsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // GET / — lista keys com versão ativa
  // -------------------------------------------------------------------------
  app.get(
    '/',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_prompts:read'] })],
      schema: {
        response: {
          200: promptKeyListResponseSchema,
        },
      },
    },
    listPromptKeysController,
  );

  // -------------------------------------------------------------------------
  // GET /:key/versions — histórico de versões de um key
  // -------------------------------------------------------------------------
  app.get(
    '/:key/versions',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_prompts:read'] })],
      schema: {
        params: promptKeyParamSchema,
        response: {
          200: promptVersionListResponseSchema,
        },
      },
    },
    listVersionsController,
  );

  // -------------------------------------------------------------------------
  // GET /:key/versions/:version — detalhe de versão específica
  // -------------------------------------------------------------------------
  app.get(
    '/:key/versions/:version',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_prompts:read'] })],
      schema: {
        params: promptVersionParamsSchema,
        response: {
          200: promptVersionResponseSchema,
        },
      },
    },
    getVersionController,
  );

  // -------------------------------------------------------------------------
  // POST /:key/versions — cria nova versão (ai_prompts:write)
  // -------------------------------------------------------------------------
  app.post(
    '/:key/versions',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_prompts:write'] })],
      schema: {
        params: promptKeyParamSchema,
        body: createPromptVersionBodySchema,
        response: {
          201: promptVersionResponseSchema,
        },
        headers: z
          .object({
            // Idempotency-Key é opcional — passa para o service controlar deduplicação
            'idempotency-key': z.string().uuid().optional(),
          })
          .passthrough(),
      },
    },
    createVersionController,
  );

  // -------------------------------------------------------------------------
  // POST /:key/versions/:version/activate — ativa versão (ai_prompts:activate)
  // -------------------------------------------------------------------------
  app.post(
    '/:key/versions/:version/activate',
    {
      preHandler: [authenticate(), authorize({ permissions: ['ai_prompts:activate'] })],
      schema: {
        params: promptVersionParamsSchema,
        response: {
          200: activatePromptVersionResponseSchema,
        },
      },
    },
    activateVersionController,
  );
};
