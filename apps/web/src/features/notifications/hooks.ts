// =============================================================================
// features/notifications/hooks.ts — TanStack Query hooks para notificações.
//
// Regras:
//   - Nunca useEffect + fetch — sempre TanStack Query.
//   - Mutações invalidam a lista e o unread_count após sucesso.
//   - Poll de 60s para manter o badge atualizado sem WebSocket.
//
// F26-S04: `useNotificationsInfinite` alimenta a central (/notificacoes).
// Key ISOLADA (`listInfinite`, segmento 'infinite') — nunca reusar a key
// flat de `list()` para uma infinite query: o shape do cache diverge
// (InfiniteData vs resposta flat) e o InfiniteQueryObserver crasha lendo uma
// entrada legada em `getNextPageParam` (mesma pegadinha documentada em
// features/conversations/queries.ts, incidente de lista quebrada). O prefixo
// `['notifications']` continua casando em `invalidateQueries({queryKey: all})`
// — markRead/markAllRead seguem invalidando a central também.
// =============================================================================

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATIONS_CENTER_PAGE_SIZE,
} from './api';
import type { NotificationsQueryParams } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (params: NotificationsQueryParams) => ['notifications', 'list', params] as const,
  /** Central (/notificacoes) — infinite query por página numérica. Ver nota de cabeçalho. */
  listInfinite: ['notifications', 'list', 'infinite'] as const,
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

/**
 * useNotificationsInfinite — lista da central (/notificacoes) como INFINITE
 * QUERY paginada por número de página (a API é offset-based: `page`/`per_page`,
 * não cursor).
 *
 * A API não expõe filtro server-side por categoria/lidas (só paginação —
 * ver `docs/23-notificacoes.md` §14). Filtros da central são aplicados
 * client-side sobre as páginas já carregadas (`NotificationsPage`); esta
 * hook só cuida de buscar mais páginas cruas do servidor via `fetchNextPage`.
 *
 * `getNextPageParam` compara `page * per_page` contra `total` — retorna
 * `undefined` quando não há mais páginas (hasNextPage vira false, sem loop
 * de fetch vazio).
 */
export function useNotificationsInfinite() {
  return useInfiniteQuery({
    queryKey: notificationKeys.listInfinite,
    queryFn: ({ pageParam }) =>
      fetchNotifications({ page: pageParam, per_page: NOTIFICATIONS_CENTER_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const loaded = lastPage.page * lastPage.per_page;
      return loaded < lastPage.total ? lastPage.page + 1 : undefined;
    },
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

/**
 * useMarkManyRead — ação em lote "marcar selecionadas como lidas" (F26-S04).
 *
 * A API não tem endpoint de marcação em lote por ids específicos (só
 * `:id/read` individual e `read-all` global) — dispara `POST :id/read` em
 * paralelo para cada id selecionado. Idempotente por item (o backend não
 * falha se já lida), então re-selecionar itens já lidos é inofensivo.
 */
export function useMarkManyRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      await Promise.all(ids.map((id) => markNotificationRead(id)));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}
