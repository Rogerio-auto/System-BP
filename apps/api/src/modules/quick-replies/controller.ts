// =============================================================================
// quick-replies/controller.ts — Handlers HTTP do módulo (F28-S03).
//
// Responsabilidades:
//   - Extrair params/query do request (validados pelo Fastify normalmente).
//   - POST/PATCH: `request.body` é repassado CRU ao service — routes.ts usa
//     `attachValidation: true` para que o Fastify NÃO rejeite automaticamente
//     o body antes do handler (o service faz a validação manual via
//     quickReplyCreateSchema/UpdateSchema + extractQuickReplyErrorCode, para
//     poder responder 422 com o código estável do catálogo de variáveis —
//     ver service.ts). `body:` continua declarado na rota só para a
//     documentação OpenAPI.
//   - Montar ActorContext a partir de request.user.
//   - Chamar o service correto e enviar resposta tipada.
//
// request.user é garantidamente definido (authenticate() nos preHandlers).
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { ForbiddenError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { QuickReplyListQuery } from './repository.js';
import type { QuickReplyIdParam, QuickReplyReorderBody } from './schemas.js';
import type { ActorContext } from './service.js';
import {
  createQuickReplyService,
  deleteQuickReplyService,
  getQuickReplyService,
  listQuickRepliesService,
  reorderQuickRepliesService,
  updateQuickReplyService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper: ActorContext de request.user
// ---------------------------------------------------------------------------

function getActorContext(request: FastifyRequest): ActorContext {
  if (!request.user) {
    throw new ForbiddenError('Contexto de usuário ausente — authenticate() não foi executado');
  }

  const { id, organizationId, permissions, cityScopeIds } = request.user;

  return {
    userId: id,
    organizationId,
    permissions,
    cityScopeIds,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/quick-replies
// ---------------------------------------------------------------------------

export async function listQuickRepliesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const query = typedQuery<QuickReplyListQuery>(request);
  const result = await listQuickRepliesService(db, actor, query);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/quick-replies/:id
// ---------------------------------------------------------------------------

export async function getQuickReplyController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<QuickReplyIdParam>(request);
  const result = await getQuickReplyService(db, actor, id);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/quick-replies
// ---------------------------------------------------------------------------

export async function createQuickReplyController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const result = await createQuickReplyService(db, actor, request.body);
  return reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// PATCH /api/quick-replies/:id
// ---------------------------------------------------------------------------

export async function updateQuickReplyController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<QuickReplyIdParam>(request);
  const result = await updateQuickReplyService(db, actor, id, request.body);
  return reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/quick-replies/:id
// ---------------------------------------------------------------------------

export async function deleteQuickReplyController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { id } = typedParams<QuickReplyIdParam>(request);
  await deleteQuickReplyService(db, actor, id);
  return reply.status(204).send();
}

// ---------------------------------------------------------------------------
// PATCH /api/quick-replies/reorder
// ---------------------------------------------------------------------------

export async function reorderQuickRepliesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  // Body validado normalmente pelo Fastify (schema simples, sem superRefine
  // de negócio de catálogo — não precisa do bypass usado em create/update).
  const items = typedBody<QuickReplyReorderBody>(request);
  const result = await reorderQuickRepliesService(db, actor, items);
  return reply.status(200).send(result);
}
