// =============================================================================
// internal/handoffs/routes.ts — Endpoint POST /internal/handoffs (F3-S07).
//
// Canal M2M: consumido pela tool `request_handoff` (F3-S17, LangGraph) e pelo
// fallback de falha da IA (F3-S34) via POST /internal/handoffs.
//
// Registrado automaticamente pelo plugin agregador internal/index.ts via
// @fastify/autoload. O prefixo /internal/handoffs é injetado pelo autoload com
// base na estrutura de diretórios (modules/internal/handoffs/routes.ts → /handoffs).
//
// Endpoints registrados neste plugin (prefixo /handoffs via autoload):
//   POST / → POST /internal/handoffs (path final)
//
// Autenticação:
//   Header X-Internal-Token = env.LANGGRAPH_INTERNAL_TOKEN. Senão 401.
//
// Idempotência:
//   Header Idempotency-Key obrigatório — a IA pode reenviar em retry.
//   Reenvio com mesma chave retorna o mesmo handoff (sem duplicar).
//
// Pipeline (doc 06 §7.4):
//   1. X-Internal-Token → 401 se ausente/inválido.
//   2. Idempotency-Key → 400 se ausente.
//   3. Validar body via Zod (Fastify aplica automaticamente).
//   4. Chamar requestHandoff() no service.
//   5. Retornar 200 com { handoff_id, chatwoot_conversation_id, assigned_agent_id, status }.
//
// LGPD (doc 17 §8.3):
//   - summary pode conter PII (dado de atendimento interno).
//   - summary é coberto por pino.redact em app.ts.
//   - Resposta retorna apenas IDs opacos — sem PII.
// =============================================================================
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { env } from '../../../config/env.js';
import { db } from '../../../db/client.js';
import { verifyInternalToken } from '../../../lib/auth/internal-token.js';
import { UnauthorizedError, AppError } from '../../../shared/errors.js';

import { InternalHandoffBodySchema, InternalHandoffResponseSchema } from './schemas.js';
import { requestHandoff } from './service.js';

// ---------------------------------------------------------------------------
// Plugin — registrado via autoload em internal/index.ts
// ---------------------------------------------------------------------------
// Exportação DEFAULT obrigatória para @fastify/autoload v6 (ESM).
// ---------------------------------------------------------------------------

const internalHandoffsRoutes: FastifyPluginAsyncZod = async (app) => {
  // -------------------------------------------------------------------------
  // POST /
  //
  // Path final (com prefixo do autoload): POST /internal/handoffs
  //
  // Pipeline:
  //   1. Verificar X-Internal-Token → 401 se ausente/inválido.
  //   2. Verificar Idempotency-Key → 400 se ausente.
  //   3. Validar body via Zod (Fastify aplica automaticamente).
  //   4. Chamar requestHandoff() no service.
  //   5. Retornar 200.
  // -------------------------------------------------------------------------
  app.post(
    '/',
    {
      schema: {
        hide: true,
        body: InternalHandoffBodySchema,
        response: {
          200: InternalHandoffResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // 1. Verificar X-Internal-Token (timing-safe — previne timing oracle, doc 10 §2.3).
      //    Lançamos UnauthorizedError (tratado pelo error handler central) em vez de
      //    reply.status(401).send() para evitar conflito com o tipo de resposta Zod (200 only).
      if (!verifyInternalToken(request.headers['x-internal-token'], env.LANGGRAPH_INTERNAL_TOKEN)) {
        throw new UnauthorizedError('Token interno inválido ou ausente');
      }

      // 2. Verificar Idempotency-Key (obrigatório — a IA pode reenviar)
      const idempotencyKey = request.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        // AppError com 400 — Idempotency-Key ausente não é erro de autenticação,
        // é erro de protocolo (caller deve sempre enviar a chave).
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Header Idempotency-Key é obrigatório para este endpoint',
        );
      }

      const body = request.body;

      // 3. Delegar ao service
      //    LGPD: request.log tem redact de 'summary' configurado em app.ts.
      const result = await requestHandoff(db, body, idempotencyKey, request.log);

      return reply.status(200).send(result);
    },
  );
};

export default internalHandoffsRoutes;
