// =============================================================================
// internal/leads/routes.ts — Endpoint POST /internal/leads/get-or-create (F3-S04).
//
// Canal M2M: consumido pela tool `get_or_create_lead` (F3-S13, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload. O prefixo /internal/leads é injetado pelo autoload com
// base na estrutura de diretórios (modules/internal/leads/routes.ts → /leads).
//
// Endpoints registrados neste plugin (prefixo /leads via autoload):
//   POST /get-or-create → POST /internal/leads/get-or-create (path final)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. Senão 401.
//
// Dedupe:
//   Por phone_normalized + organization_id. Unique constraint na DB garante
//   atomicidade; race condition mapeada para LEAD_MERGE_REQUIRED.
//
// LGPD (doc 17 §8.1, §3.4):
//   - phone e name no body são PII — cobertos por pino.redact em app.ts.
//   - Resposta retorna apenas IDs opacos (lead_id, city_id, assigned_agent_id).
//   - city_id: lead_id é sempre UUID; city_id e assigned_agent_id podem ser null.
//   - leads.created emitido via outbox APENAS quando created=true.
//   - Rate limit 60 req/min por IP (proteção contra loop de IA).
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { UnauthorizedError } from '../../../shared/errors.js';
import { getOrCreateLead } from '../../leads/service.js';

import {
  InternalGetOrCreateLeadBodySchema,
  InternalGetOrCreateLeadResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// O autoload descobre o plugin pela presença do export default neste arquivo.
// ---------------------------------------------------------------------------

const internalLeadsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /get-or-create
  //
  // Path final (com prefixo do autoload): POST /internal/leads/get-or-create
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Validar body via Zod (Fastify aplica automaticamente).
  //   3. Chamar getOrCreateLead() no leads/service.ts.
  //   4. Retornar 200 com resultado (created: true|false).
  //
  // Erros mapeados:
  //   - INVALID_PHONE → 422.
  //   - LEAD_MERGE_REQUIRED → 409.
  //   - Zod validation → 400 VALIDATION_ERROR (pelo error handler central).
  // -------------------------------------------------------------------------
  app.post(
    '/get-or-create',
    {
      schema: {
        body: InternalGetOrCreateLeadBodySchema,
        response: {
          200: InternalGetOrCreateLeadResponseSchema,
        },
      },
      config: {
        // Rate limit específico desta rota: 60 req/min por IP.
        // Protege contra loop de IA ou chamadas paralelas excessivas do LangGraph.
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: (_req: unknown, context: { statusCode: number }) => {
            const err = Object.assign(
              new Error('Rate limit excedido: máximo 60 requisições por minuto.'),
              {
                statusCode: context.statusCode,
                code: 'RATE_LIMITED',
              },
            );
            return err;
          },
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token
      //    Lançamos UnauthorizedError (tratado pelo error handler central) em vez de
      //    reply.status(401).send() para evitar conflito com o tipo de resposta Zod (200 only).
      const token = request.headers['x-internal-token'];
      if (token !== env.LANGGRAPH_INTERNAL_TOKEN) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      const body = request.body;

      // 2. Mapear body para input do service.
      //    LGPD: phone e name são PII — não logar, cobertos pelo pino.redact.
      const result = await getOrCreateLead(
        db,
        // organizationId vem do body — consistente com /internal/simulations.
        // O LangGraph passa organization_id em cada chamada (token não carrega contexto de org).
        body.organization_id,
        {
          phone: body.phone,
          name: body.name,
          source: body.source,
          chatwootConversationId: body.chatwoot_conversation_id,
          correlationId: body.correlation_id,
          cityId: body.city_id,
        },
        request.ip,
      );

      return reply.status(200).send(result);
    },
  );
};

export default internalLeadsRoutes;
