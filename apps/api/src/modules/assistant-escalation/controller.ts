// =============================================================================
// assistant-escalation/controller.ts — Handler HTTP de POST /api/assistant/escalate (F6-S30).
//
// request.user é garantidamente definido (authenticate() no preHandler da rota).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody } from '../../shared/fastify-types.js';

import type { EscalateLeadRequest } from './schemas.js';
import { escalateLeadToCredit } from './service.js';
import type { AssistantEscalationActorContext } from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): AssistantEscalationActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId, cityScopeIds } = request.user;

  return {
    userId: id,
    organizationId,
    cityScopeIds,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// POST /api/assistant/escalate
// ---------------------------------------------------------------------------

export async function escalateLeadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const body = typedBody<EscalateLeadRequest>(request);

  const result = await escalateLeadToCredit(db, actor, {
    leadId: body.lead_id,
    ...(body.note !== undefined ? { note: body.note } : {}),
  });

  return reply.status(200).send(result);
}
