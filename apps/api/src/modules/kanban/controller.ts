// =============================================================================
// kanban/controller.ts — Handler da rota POST /api/kanban/cards/:id/move.
// =============================================================================
import type { FastifyRequest, FastifyReply } from 'fastify';

import { NotFoundError } from '../../shared/errors.js';

import type { MoveCardBody } from './schemas.js';
import { moveCard } from './service.js';

// ---------------------------------------------------------------------------
// POST /api/kanban/cards/:id/move
// ---------------------------------------------------------------------------

export async function moveCardController(
  request: FastifyRequest<{
    Params: { id: string };
    Body: MoveCardBody;
  }>,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    throw new NotFoundError('Usuário não encontrado no contexto');
  }

  const { id: cardId } = request.params;
  const { toStageId } = request.body;
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
