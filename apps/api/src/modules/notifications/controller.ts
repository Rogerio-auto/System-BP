// =============================================================================
// notifications/controller.ts — Handlers HTTP do módulo de notificações (F15-S06).
//
// Responsabilidades:
//   - Extrair params/body/query do request Fastify.
//   - Montar organizationId + userId a partir de request.user.
//   - Delegar ao service; enviar resposta HTTP.
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// RBAC é verificado pelo authorize() middleware antes de chegar aqui.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type {
  NotificationIdParam,
  NotificationListQuery,
  NotificationPreferencesBatchUpdate,
  PushSubscriptionRequest,
  PushUnsubscribeQuery,
} from './schemas.js';
import {
  getPreferencesService,
  getPushPublicKeyService,
  listNotificationsService,
  markAllNotificationsReadService,
  markNotificationReadService,
  subscribePushService,
  unsubscribePushService,
  updatePreferencesService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper — contexto do usuário autenticado
// ---------------------------------------------------------------------------

interface UserContext {
  organizationId: string;
  userId: string;
}

function getUserContext(request: FastifyRequest): UserContext {
  if (!request.user?.organizationId || !request.user?.id) {
    throw new UnauthorizedError('Contexto de usuário ausente — authenticate() não executou');
  }
  return {
    organizationId: request.user.organizationId,
    userId: request.user.id,
  };
}

/**
 * Contexto completo de ator (audit) — mesmo padrão de modules/users/controller.ts:
 * role snapshot derivado da primeira permissão (request.user não tem campo `role`
 * dedicado, ver shared/fastify.d.ts).
 */
function getActorContext(request: FastifyRequest): {
  organizationId: string;
  userId: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
} {
  const { organizationId, userId } = getUserContext(request);
  // `as` justificado: request.user já foi verificado não-nulo em getUserContext.
  const permissions = (request.user as { permissions: string[] }).permissions;
  const role = permissions[0] ?? 'unknown';

  return {
    organizationId,
    userId,
    role,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/notifications — minhas notificações
// ---------------------------------------------------------------------------

export async function listNotificationsController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId } = getUserContext(request);
  const query = typedQuery<NotificationListQuery>(request);
  const result = await listNotificationsService(db, organizationId, userId, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/notifications/:id/read — marcar notificação como lida
// ---------------------------------------------------------------------------

export async function markReadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId } = getUserContext(request);
  const { id } = typedParams<NotificationIdParam>(request);
  const result = await markNotificationReadService(db, organizationId, userId, id);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all — marcar todas como lidas
// ---------------------------------------------------------------------------

export async function markAllReadController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId } = getUserContext(request);
  const result = await markAllNotificationsReadService(db, organizationId, userId);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/notifications/preferences — ver preferências
// ---------------------------------------------------------------------------

export async function getPreferencesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId } = getUserContext(request);
  const result = await getPreferencesService(db, organizationId, userId);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// PUT /api/notifications/preferences — atualizar preferências
// ---------------------------------------------------------------------------

export async function updatePreferencesController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId } = getUserContext(request);
  const body = typedBody<NotificationPreferencesBatchUpdate>(request);
  const result = await updatePreferencesService(db, organizationId, userId, body);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// GET /api/notifications/push/public-key — chave pública VAPID (F27-S06)
// ---------------------------------------------------------------------------

export async function getPushPublicKeyController(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await getPushPublicKeyService(db);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/notifications/push/subscription — registrar subscription (F27-S06)
// ---------------------------------------------------------------------------

export async function subscribePushController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const body = typedBody<PushSubscriptionRequest>(request);
  const result = await subscribePushService(db, actor, body);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// DELETE /api/notifications/push/subscription — remover subscription (F27-S06)
// ---------------------------------------------------------------------------

export async function unsubscribePushController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const actor = getActorContext(request);
  const { endpoint } = typedQuery<PushUnsubscribeQuery>(request);
  const result = await unsubscribePushService(db, actor, endpoint);
  await reply.status(200).send(result);
}
