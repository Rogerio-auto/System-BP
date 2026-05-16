// =============================================================================
// kanban/controller.ts — Handlers das rotas do módulo kanban (F1-S13).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { NotFoundError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { MoveCardBody, ListCardsQuery } from './schemas.js';
import { listKanbanCards, listKanbanStages, moveCard } from './service.js';

// ---------------------------------------------------------------------------
// POST /api/kanban/cards/:id/move
// ---------------------------------------------------------------------------

export async function moveCardController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    throw new NotFoundError('Usuário não encontrado no contexto');
  }

  const { id: cardId } = typedParams<{ id: string }>(request);
  const { toStageId } = typedBody<MoveCardBody>(request);
  const user = request.user;

  const updatedCard = await moveCard(cardId, toStageId, {
    userId: user.id,
    orgId: user.organizationId,
    // role: use primeiro elemento de roles se disponível, fallback para string vazia
    // request.user.permissions contém a lista de permissões; role é snapshot para audit
    role: user.permissions[0] ?? 'unknown',
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  });

  await reply.status(200).send({
    id: updatedCard.id,
    organizationId: updatedCard.organizationId,
    leadId: updatedCard.leadId,
    stageId: updatedCard.stageId,
    assigneeUserId: updatedCard.assigneeUserId ?? null,
    priority: updatedCard.priority,
    notes: updatedCard.notes ?? null,
    enteredStageAt: updatedCard.enteredStageAt.toISOString(),
    createdAt: updatedCard.createdAt.toISOString(),
    updatedAt: updatedCard.updatedAt.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// GET /api/kanban/stages
// ---------------------------------------------------------------------------

export async function listStagesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    throw new NotFoundError('Usuário não encontrado no contexto');
  }

  const stages = await listKanbanStages({
    orgId: request.user.organizationId,
    cityScopeIds: request.user.cityScopeIds,
  });

  await reply.status(200).send({ stages });
}

// ---------------------------------------------------------------------------
// GET /api/kanban/cards
// ---------------------------------------------------------------------------

export async function listCardsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    throw new NotFoundError('Usuário não encontrado no contexto');
  }

  const { stage_id, city_id, agent_id, page, limit } = typedQuery<ListCardsQuery>(request);

  const result = await listKanbanCards(
    {
      stageId: stage_id,
      cityId: city_id,
      agentId: agent_id,
      page,
      limit,
    },
    {
      orgId: request.user.organizationId,
      cityScopeIds: request.user.cityScopeIds,
    },
  );

  await reply.status(200).send(result);
}
