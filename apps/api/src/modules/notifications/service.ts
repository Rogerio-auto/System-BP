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
import type { Database } from '../../db/client.js';

import {
  getNotificationPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  upsertNotificationPreferences,
} from './repository.js';
import type {
  Notification,
  NotificationListQuery,
  NotificationListResponse,
  NotificationPreferencesBatchUpdate,
  NotificationPreferencesList,
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
