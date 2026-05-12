// =============================================================================
// internal/featureFlags/routes.ts — Endpoint interno para Python/LangGraph.
//
// Rota:
//   POST /internal/feature-flags/check
//
// Autenticação: header X-Internal-Token (env.LANGGRAPH_INTERNAL_TOKEN).
// Não usa authenticate() — é um canal machine-to-machine.
//
// Contrato:
//   Request:  { key: string, roles?: string[] }
//   Response: { key: string, status: string, enabled: boolean }
//
// A tool Python faz:
//   result = await http.post('/internal/feature-flags/check',
//     json={'key': 'followup.enabled'},
//     headers={'X-Internal-Token': settings.INTERNAL_TOKEN}
//   )
//   if not result['enabled']:
//     return ToolResult(error='FEATURE_DISABLED')
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { ForbiddenError } from '../../../shared/errors.js';
import {
  internalCheckBodySchema,
  internalCheckResponseSchema,
} from '../../featureFlags/schemas.js';
import { isFlagEnabled } from '../../featureFlags/service.js';

export const internalFeatureFlagsRoutes: FastifyPluginAsyncZod = async (app) => {
  // ---------------------------------------------------------------------------
  // POST /internal/feature-flags/check
  // ---------------------------------------------------------------------------
  app.post(
    '/internal/feature-flags/check',
    {
      schema: {
        body: internalCheckBodySchema,
        response: {
          200: internalCheckResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Verificar X-Internal-Token
      const token = request.headers['x-internal-token'];
      if (token !== env.LANGGRAPH_INTERNAL_TOKEN) {
        throw new ForbiddenError('Token interno inválido');
      }

      const { key, roles = [] } = request.body;
      const { enabled, status } = await isFlagEnabled(db, key, roles);

      await reply.status(200).send({ key, status, enabled });
    },
  );
};
