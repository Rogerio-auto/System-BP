// =============================================================================
// features/admin/notification-rules/hooks.ts — TanStack Query hooks (F24-S10).
//
// Hooks:
//   - useNotificationRules      — lista paginada com filtros (query)
//   - useNotificationCatalog    — catálogo de gatilhos (query, stale longo)
//   - useUpdateNotificationRule — atualização parcial / toggle enabled (mutation)
//   - useDeleteNotificationRule — remoção de regra (mutation)
//
// Nunca useEffect + fetch — apenas TanStack Query.
// Invalidate após mutate para manter cache consistente.
// =============================================================================
import type { NotificationRuleListResponse } from '@elemento/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteNotificationRule,
  fetchNotificationCatalog,
  fetchNotificationRules,
  updateNotificationRule,
} from './api';
import type { CatalogResponse, ListRulesParams } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const NOTIFICATION_RULES_KEYS = {
  all: ['notification-rules'] as const,
  list: (params: ListRulesParams) => [...NOTIFICATION_RULES_KEYS.all, 'list', params] as const,
  catalog: () => [...NOTIFICATION_RULES_KEYS.all, 'catalog'] as const,
} as const;

// ---------------------------------------------------------------------------
// useNotificationRules
// ---------------------------------------------------------------------------

export interface UseNotificationRulesResult {
  data: NotificationRuleListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useNotificationRules(params: ListRulesParams = {}): UseNotificationRulesResult {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: NOTIFICATION_RULES_KEYS.list(params),
    queryFn: () => fetchNotificationRules(params),
    staleTime: 30_000,
  });

  return { data, isLoading, isError, error: error as Error | null, refetch };
}

// ---------------------------------------------------------------------------
// useNotificationCatalog
// ---------------------------------------------------------------------------

export function useNotificationCatalog(): {
  data: CatalogResponse | undefined;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: NOTIFICATION_RULES_KEYS.catalog(),
    queryFn: fetchNotificationCatalog,
    // Catálogo é estático — stale por 5 minutos
    staleTime: 5 * 60 * 1000,
  });

  return { data, isLoading };
}

// ---------------------------------------------------------------------------
// useUpdateNotificationRule
//
// Retorna o `mutate` do useMutation sem estreitar o tipo — preserva o segundo
// argumento opcional (callbacks onSuccess/onError no call site).
// ---------------------------------------------------------------------------

export function useUpdateNotificationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Parameters<typeof updateNotificationRule>[1];
    }) => updateNotificationRule(id, body),
    onSuccess: () => {
      // Invalida todas as listas para refletir a mudança
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_RULES_KEYS.all });
    },
  });
}

// ---------------------------------------------------------------------------
// useDeleteNotificationRule
//
// Retorna o resultado completo do useMutation para preservar os callbacks.
// ---------------------------------------------------------------------------

export function useDeleteNotificationRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteNotificationRule(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_RULES_KEYS.all });
    },
  });
}
