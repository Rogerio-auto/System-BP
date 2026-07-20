// =============================================================================
// notifications/service.ts — Regras de negócio do módulo de notificações (F15-S06).
//
// Responsabilidades:
//   - Listar notificações do usuário autenticado com unread_count.
//   - Marcar uma ou todas as notificações como lidas.
//   - Ler e atualizar preferências de canal.
//
// F24-S09: updatePreferencesService delega ao repositório atualizado que suporta
//   category × canal. Tipos fluem naturalmente via NotificationPreferencesBatchUpdate
//   (agora com category opcional por item).
//
// RBAC verificado nas rotas — não aqui.
// LGPD §8.5: title/body não são logados; apenas IDs opacos nos audit logs.
// =============================================================================
import { env } from '../../config/env.js';
import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { ForbiddenError } from '../../shared/errors.js';
import { isFlagEnabled } from '../featureFlags/service.js';

import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  softDeletePushSubscriptionByEndpoint,
  upsertNotificationPreferences,
  upsertPushSubscription,
} from './repository.js';
import type {
  Notification,
  NotificationListQuery,
  NotificationListResponse,
  NotificationPreferencesBatchUpdate,
  NotificationPreferencesList,
  PushPublicKeyResponse,
  PushSubscriptionAck,
  PushSubscriptionRequest,
  PushUnsubscribeAck,
} from './schemas.js';

/**
 * Lista notificações do usuário autenticado com paginação e unread_count.
 */
export async function listNotificationsService(
  db: Database,
  organizationId: string,
  userId: string,
  query: NotificationListQuery,
): Promise<NotificationListResponse> {
  return listNotifications(db, organizationId, userId, query);
}

/**
 * Marca uma notificação como lida.
 * Idempotente: se já lida, retorna o estado atual sem erro.
 */
export async function markNotificationReadService(
  db: Database,
  organizationId: string,
  userId: string,
  notificationId: string,
): Promise<Notification> {
  return markNotificationRead(db, organizationId, userId, notificationId);
}

/**
 * Marca todas as notificações não lidas do usuário como lidas.
 */
export async function markAllNotificationsReadService(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<{ marked: number }> {
  return markAllNotificationsRead(db, organizationId, userId);
}

/**
 * Retorna a matriz de preferências de notificação do usuário.
 *
 * F24-S09: resposta inclui tanto os defaults de canal (category=null)
 * quanto os overrides de categoria configurados.
 * Canais não configurados têm enabled=true (opt-out model).
 */
export async function getPreferencesService(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<NotificationPreferencesList> {
  return getNotificationPreferences(db, organizationId, userId);
}

/**
 * Atualiza preferências de canal do usuário.
 *
 * F24-S09: aceita items com `category` opcional.
 *   - Sem category (ou null) → atualiza o default do canal (retrocompat).
 *   - Com category          → atualiza o override de categoria específica.
 *
 * Upsert idempotente: re-enviar o mesmo payload é no-op.
 */
export async function updatePreferencesService(
  db: Database,
  organizationId: string,
  userId: string,
  body: NotificationPreferencesBatchUpdate,
): Promise<NotificationPreferencesList> {
  return upsertNotificationPreferences(db, organizationId, userId, body.preferences);
}

// ---------------------------------------------------------------------------
// Web Push (F27-S06 — doc 24 §5/§7)
//
// Gate em duas camadas — as duas precisam estar ligadas para mutar:
//   1. Env NOTIFICATIONS_PUSH_ENABLED — infra/credenciais.
//   2. Feature flag `pwa.enabled`     — decisão operacional (camada API).
// POST/DELETE recusam com ForbiddenError quando qualquer camada está
// desligada (doc 24 §7: "Endpoints de subscription recusam com flag off").
// ---------------------------------------------------------------------------

interface PushActorContext {
  organizationId: string;
  userId: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
}

async function assertPushMutationEnabled(db: Database): Promise<void> {
  if (!env.NOTIFICATIONS_PUSH_ENABLED) {
    throw new ForbiddenError('Web Push não está configurado nesta instância');
  }

  const { enabled } = await isFlagEnabled(db, 'pwa.enabled');
  if (!enabled) {
    throw new ForbiddenError('Recurso de Web Push está desabilitado (pwa.enabled)');
  }
}

/**
 * Retorna a chave pública VAPID para o frontend iniciar `PushManager.subscribe`.
 *
 * Degrada graciosamente: `public_key: null` quando env/flag estão desligados
 * (em vez de erro) — a UI de opt-in usa isso para se esconder sem precisar
 * tratar exceção num endpoint de leitura pura, sem efeito colateral.
 */
export async function getPushPublicKeyService(db: Database): Promise<PushPublicKeyResponse> {
  if (!env.NOTIFICATIONS_PUSH_ENABLED) {
    return { public_key: null };
  }

  const { enabled } = await isFlagEnabled(db, 'pwa.enabled');
  if (!enabled) {
    return { public_key: null };
  }

  // Non-null assertion justificada: env.NOTIFICATIONS_PUSH_ENABLED=true implica
  // VAPID_PUBLIC_KEY definida (garantido pelo refine de envSchema).
  return { public_key: env.VAPID_PUBLIC_KEY! };
}

/**
 * Registra/atualiza a subscription de push do usuário autenticado (upsert
 * idempotente por `endpoint`, F27-S05/repository).
 *
 * Auditado na mesma transação (mutação sensível — doc 17 §14.2): before/after
 * só carregam IDs opacos, nunca endpoint/keys (LGPD §8.5, redactSensitive
 * não é necessário aqui pois o payload já nasce sem PII no audit log).
 */
export async function subscribePushService(
  db: Database,
  actor: PushActorContext,
  body: PushSubscriptionRequest,
): Promise<PushSubscriptionAck> {
  await assertPushMutationEnabled(db);

  await db.transaction(async (tx) => {
    // `as unknown as Database` justificado: PgTransaction e Database (Drizzle
    // node-postgres) são estruturalmente compatíveis para os métodos usados
    // aqui (select/insert/update), mas não são o mesmo tipo nominal — mesmo
    // padrão usado em modules/users/service.ts.
    const txDb = tx as unknown as Database;

    const { id } = await upsertPushSubscription(txDb, {
      organizationId: actor.organizationId,
      userId: actor.userId,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userAgent: body.userAgent ?? null,
    });

    const auditActor: AuditActor = {
      userId: actor.userId,
      role: actor.role,
      ip: actor.ip,
      userAgent: actor.userAgent,
    };

    await auditLog(tx, {
      organizationId: actor.organizationId,
      actor: auditActor,
      action: 'notifications.push_subscription.created',
      resource: { type: 'push_subscription', id },
      // LGPD: nunca gravar endpoint/p256dh/auth em audit_logs — apenas o
      // rótulo de device (não-PII na prática, mas ainda assim opcional).
      after: { has_user_agent: body.userAgent !== undefined },
    });
  });

  return { subscribed: true };
}

/**
 * Remove (soft-delete) a subscription de push do usuário autenticado —
 * opt-out/logout. Idempotente: endpoint já removido ou inexistente ainda
 * responde `{ unsubscribed: true }` (sem vazar se a subscription existia).
 */
export async function unsubscribePushService(
  db: Database,
  actor: PushActorContext,
  endpoint: string,
): Promise<PushUnsubscribeAck> {
  await assertPushMutationEnabled(db);

  await db.transaction(async (tx) => {
    const txDb = tx as unknown as Database;

    const removedId = await softDeletePushSubscriptionByEndpoint(
      txDb,
      actor.organizationId,
      actor.userId,
      endpoint,
    );

    if (removedId !== null) {
      const auditActor: AuditActor = {
        userId: actor.userId,
        role: actor.role,
        ip: actor.ip,
        userAgent: actor.userAgent,
      };

      await auditLog(tx, {
        organizationId: actor.organizationId,
        actor: auditActor,
        action: 'notifications.push_subscription.deleted',
        resource: { type: 'push_subscription', id: removedId },
        before: { removed: true },
      });
    }
  });

  return { unsubscribed: true };
}
