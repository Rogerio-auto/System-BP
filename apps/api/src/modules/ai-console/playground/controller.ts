// =============================================================================
// ai-console/playground/controller.ts — Handler da rota POST /api/ai-console/playground.
//
// Responsabilidades:
//   - Extrair body validado (message, lead_id, city_id, use_real_context).
//   - Extrair Idempotency-Key do header (opcional).
//   - Instanciar LangGraphPlaygroundClient e delegar ao service.
//   - Retornar 200 com PlaygroundResponse.
//
// LGPD (doc 17 §8.4):
//   - Não logar body.message — coberto por pino.redact em app.ts.
//   - Não logar dlp_tokens — coberto por pino.redact em app.ts.
//   - Log estruturado: apenas user_id, org_id, use_real_context, has_lead_id.
//
// Sem cache — o playground é interativo e cada execução deve ser independente.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../../db/client.js';
import { LangGraphPlaygroundClient } from '../../../integrations/langgraph/playground-client.js';
import { NotFoundError } from '../../../shared/errors.js';
import { typedBody } from '../../../shared/fastify-types.js';

import type { PlaygroundBody } from './schemas.js';
import { runPlaygroundSvc } from './service.js';

// ---------------------------------------------------------------------------
// POST /api/ai-console/playground
// ---------------------------------------------------------------------------

/**
 * Handler do endpoint POST /api/ai-console/playground.
 *
 * RBAC: ai_playground:run (admin-only) — verificado pelo preHandler authorize().
 * DLP: aplicado no service antes de qualquer repasse ao LangGraph.
 * Audit + Outbox: emitidos no service dentro da mesma transação.
 */
export async function runPlaygroundController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // request.user é garantido por authenticate() + authorize() no preHandler.
  // Verificação defensiva para evitar runtime null (TypeScript strict).
  if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
  const user = request.user;

  const body = typedBody<PlaygroundBody>(request);

  // Idempotency-Key do header (case-insensitive por RFC 9110)
  // Justificativa do cast: Fastify devolve headers como string | string[] | undefined.
  // Aqui só precisamos da primeira ocorrência como string.
  const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

  // Log estruturado — sem body.message (PII potencial) e sem dlp_tokens.
  // pino.redact em app.ts cobre '*.message' e '*.dlp_tokens' como camada extra.
  request.log.info(
    {
      event: 'ai_playground.run_requested',
      request_id: request.id,
      org_id: user.organizationId,
      user_id: user.id,
      has_lead_id: body.lead_id !== null && body.lead_id !== undefined,
      has_city_id: body.city_id !== null && body.city_id !== undefined,
      use_real_context: body.use_real_context,
      has_idempotency_key: idempotencyKey !== undefined,
    },
    'playground run requested',
  );

  // Instanciar cliente (injetável em testes via override de options)
  const client = new LangGraphPlaygroundClient();

  const result = await runPlaygroundSvc(
    db,
    client,
    {
      userId: user.id,
      organizationId: user.organizationId,
      // 'admin' é o único role com ai_playground:run (authorize() já garantiu isso).
      // request.user não carrega role — passamos o literal que corresponde à permissão.
      role: 'admin',
      ip: request.ip,
      // exactOptionalPropertyTypes: header pode ser undefined — converter para null
      userAgent: request.headers['user-agent'] ?? null,
    },
    body,
    idempotencyKey,
  );

  // Log de conclusão — sem dados de PII
  request.log.info(
    {
      event: 'ai_playground.run_completed',
      request_id: request.id,
      trace_id: result.trace_id,
      tokens_total: result.tokens_total,
      latency_ms: result.latency_ms,
      dlp_applied: result.dlp_applied,
      handoff_required: result.handoff_required,
      trace_entries: result.trace.length,
    },
    'playground run completed',
  );

  await reply.status(200).send(result);
}
