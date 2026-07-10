// =============================================================================
// ai-actions/controller.ts — Handlers HTTP do painel "IA nas últimas 24h" (F25-S06).
//
// request.user é garantidamente definido (authenticate() nos preHandlers).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { AiActionIdParam, AiActionsListQuery } from './schemas.js';
import type { AiActionsActorContext } from './service.js';
import { getAiActionsList, revertAiAction } from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): AiActionsActorContext {
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
// GET /api/ai-actions
// ---------------------------------------------------------------------------

export async function listAiActionsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await getAiActionsList(db, actor, typedQuery<AiActionsListQuery>(request));
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/ai-actions/:id/revert
// ---------------------------------------------------------------------------

export async function revertAiActionController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const params = typedParams<AiActionIdParam>(request);
  const result = await revertAiAction(db, actor, params.id);
  return reply.status(200).send(result);
}
