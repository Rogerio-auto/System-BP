// =============================================================================
// features/notifications/hooks.ts — TanStack Query hooks para notificações.
//
// Regras:
//   - Nunca useEffect + fetch — sempre TanStack Query.
//   - Mutações invalidam a lista e o unread_count após sucesso.
//   - Poll de 60s para manter o badge atualizado sem WebSocket.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from './api';
import type { NotificationsQueryParams } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (params: NotificationsQueryParams) => ['notifications', 'list', params] as const,
} as const;

// ---------------------------------------------------------------------------
// Hooks de leitura
// ---------------------------------------------------------------------------

/**
 * Lista paginada de notificações.
 * Poll de 60s para manter unread_count atualizado sem WebSocket.
 */
export function useNotifications(params: NotificationsQueryParams = {}) {
  return useQuery({
    queryKey: notificationKeys.list(params),
    queryFn: () => fetchNotifications(params),
    // Poll periódico para atualizar badge de não-lidas
    refetchInterval: 60_000,
  });
}

// ---------------------------------------------------------------------------
// Hooks de mutação
// ---------------------------------------------------------------------------

/**
 * Marca uma notificação individual como lida.
 * Invalida a lista para atualizar o badge.
 */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/**
 * Marca todas as notificações como lidas.
 * Invalida a lista para zerar o badge.
 */
export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
