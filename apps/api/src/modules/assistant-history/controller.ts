// =============================================================================
// modules/assistant-history/controller.ts — Handlers HTTP do histórico do
// copiloto interno (F6-S25).
//
// request.user é garantidamente definido (authenticate() no preHandler de
// cada rota — ver routes.ts). Sem lógica de negócio aqui — delega ao service.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams } from '../../shared/fastify-types.js';

import type {
  ConversationIdParams,
  CreateConversationBody,
  RenameConversationBody,
} from './schemas.js';
import {
  createConversationForUser,
  deleteConversationForUser,
  getConversationDetail,
  listConversationsForUser,
  renameConversationForUser,
} from './service.js';
import type { AssistantHistoryActorContext } from './service.js';

function getActorContext(request: FastifyRequest): AssistantHistoryActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  // permissions/cityScopeIds são usados só por getConversationDetail, para
  // re-hidratar blocos com o RBAC ATUAL do usuário (F6-S27) — ver
  // AssistantHistoryActorContext em service.ts.
  return {
    userId: request.user.id,
    organizationId: request.user.organizationId,
    permissions: request.user.permissions,
    cityScopeIds: request.user.cityScopeIds,
  };
}

// ---------------------------------------------------------------------------
// GET /api/assistant/conversations
// ---------------------------------------------------------------------------

export async function listConversationsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await listConversationsForUser(db, actor);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/assistant/conversations/:id
// ---------------------------------------------------------------------------

export async function getConversationController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<ConversationIdParams>(request);
  const result = await getConversationDetail(db, actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/assistant/conversations
// ---------------------------------------------------------------------------

export async function createConversationController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const body = typedBody<CreateConversationBody>(request);
  const result = await createConversationForUser(db, actor, body.title);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/assistant/conversations/:id
// ---------------------------------------------------------------------------

export async function renameConversationController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<ConversationIdParams>(request);
  const body = typedBody<RenameConversationBody>(request);
  const result = await renameConversationForUser(db, actor, id, body.title);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/assistant/conversations/:id
// ---------------------------------------------------------------------------

export async function deleteConversationController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<ConversationIdParams>(request);
  const result = await deleteConversationForUser(db, actor, id);
  return reply.status(200).send(result);
}
