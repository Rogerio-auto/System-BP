// =============================================================================
// features/notifications/api.ts — Funções de acesso à API de notificações.
//
// Todas as chamadas passam por lib/api.ts (único ponto de rede).
// Tipos derivados de packages/shared-schemas/src/notifications.ts.
// =============================================================================

import type { NotificationListResponse } from '@elemento/shared-schemas';

import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Tipos de query
// ---------------------------------------------------------------------------

export interface NotificationsQueryParams {
  page?: number;
  per_page?: number;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/notifications — lista paginada de notificações.
 * Inclui `unread_count` para o badge do sino.
 */
export async function fetchNotifications(
  params: NotificationsQueryParams = {},
): Promise<NotificationListResponse> {
  const qs = new URLSearchParams();
  if (params.page !== null && params.page !== undefined) qs.set('page', String(params.page));
  if (params.per_page !== null && params.per_page !== undefined)
    qs.set('per_page', String(params.per_page));

  const query = qs.toString();
  return api.get<NotificationListResponse>(`/api/notifications${query ? `?${query}` : ''}`);
}

/**
 * POST /api/notifications/:id/read — marca uma notificação como lida.
 */
export async function markNotificationRead(id: string): Promise<void> {
  return api.post<void>(`/api/notifications/${encodeURIComponent(id)}/read`, {});
}

/**
 * POST /api/notifications/read-all — marca todas as notificações como lidas.
 */
export async function markAllNotificationsRead(): Promise<void> {
  return api.post<void>('/api/notifications/read-all', {});
}
