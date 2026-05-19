// =============================================================================
// ai-console/decisions/controller.ts — Handlers das rotas de ai_decision_logs (F9-S02).
//
// Rotas:
//   GET /api/ai-console/decisions          — lista paginada (cursor)
//   GET /api/ai-console/decisions/timeline — timeline de uma conversa
//
// LGPD: logs nunca expõem campos de `decision` — apenas correlation_id e request_id.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../../db/client.js';
import { NotFoundError } from '../../../shared/errors.js';
import { typedQuery } from '../../../shared/fastify-types.js';

import type { ListDecisionsQuery, TimelineQuery } from './schemas.js';
import { getTimelineSvc, listDecisionsSvc } from './service.js';

// ---------------------------------------------------------------------------
// GET /api/ai-console/decisions — lista paginada
// ---------------------------------------------------------------------------

export async function listDecisionsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // request.user é garantido por authenticate() + authorize() no preHandler.
  // Verificação defensiva para evitar runtime null (TypeScript strict).
  if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
  const user = request.user;

  const query = typedQuery<ListDecisionsQuery>(request);

  // Log estruturado — sem campos de PII (LGPD doc 17 §8.4)
  request.log.info(
    {
      event: 'ai_decisions.list',
      request_id: request.id,
      org_id: user.organizationId,
      user_id: user.id,
      has_conversation_filter: query.conversation_id !== undefined,
      has_lead_filter: query.lead_id !== undefined,
      limit: query.limit,
    },
    'listing ai decisions',
  );

  const result = await listDecisionsSvc(
    db,
    {
      organizationId: user.organizationId,
      cityScopeIds: user.cityScopeIds,
    },
    query,
  );

  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/ai-console/decisions/timeline — timeline de uma conversa
// ---------------------------------------------------------------------------

export async function getTimelineController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) throw new NotFoundError('Usuário não encontrado no contexto');
  const user = request.user;

  const { conversation_id } = typedQuery<TimelineQuery>(request);

  // Log estruturado — sem campos de PII
  request.log.info(
    {
      event: 'ai_decisions.timeline',
      request_id: request.id,
      org_id: user.organizationId,
      user_id: user.id,
      conversation_id,
    },
    'fetching ai decision timeline',
  );

  const result = await getTimelineSvc(
    db,
    {
      organizationId: user.organizationId,
      cityScopeIds: user.cityScopeIds,
    },
    conversation_id,
  );

  await reply.status(200).send(result);
}
