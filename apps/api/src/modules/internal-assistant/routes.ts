// =============================================================================
// modules/internal-assistant/routes.ts -- Rotas do copiloto interno (F6-S08).
//
// Endpoint: POST /api/internal-assistant/query
// Permissao: ai_assistant:use (doc 22 sec12.1)
// Flag: ai.internal_assistant.enabled
//
// Rate-limit por usuario: 20 req/min (protecao contra scraping de dados via LLM).
// Timeout: alinhado ao LANGGRAPH_AI_TIMEOUT_MS (25s default).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { featureGate } from '../../plugins/featureGate.js';
import { authenticate } from '../auth/middlewares/authenticate.js';
import { authorize } from '../auth/middlewares/index.js';

import { postAssistantQueryController } from './controller.js';
import { AssistantQueryBodySchema, AssistantQueryResponseSchema } from './schemas.js';

const AI_ASSISTANT_USE: [string, ...string[]] = ['ai_assistant:use'];

export const internalAssistantRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', authenticate());

  // POST /api/internal-assistant/query
  app.post(
    '/api/internal-assistant/query',
    {
      schema: {
        tags: ['Copiloto Interno'],
        summary: 'Consulta ao copiloto interno (F6-S08)',
        description:
          'Recebe a pergunta do usuario autenticado, aplica DLP, encaminha ao grafo ' +
          'internal_assistant e registra em assistant_queries. ' +
          'Requer ai_assistant:use + flag ai.internal_assistant.enabled.',
        security: [{ bearerAuth: [] }],
        body: AssistantQueryBodySchema,
        response: { 200: AssistantQueryResponseSchema },
      },
      preHandler: [
        authorize({ permissions: AI_ASSISTANT_USE }),
        featureGate('ai.internal_assistant.enabled'),
      ],
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
          keyGenerator: (req) => req.user?.id ?? req.ip,
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(
              new Error(
                'Limite de consultas excedido. Aguarde 1 minuto antes de tentar novamente.',
              ),
              { statusCode: context.statusCode, code: 'RATE_LIMITED' },
            );
            return err;
          },
        },
      },
    },
    postAssistantQueryController,
  );
};
