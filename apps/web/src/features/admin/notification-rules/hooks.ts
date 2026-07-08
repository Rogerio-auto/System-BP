// =============================================================================
// features/admin/notification-rules/hooks.ts — TanStack Query hooks (F24-S10/S11).
//
// Hooks:
//   - useNotificationRules         — lista paginada com filtros (query)
//   - useNotificationCatalog       — catálogo de gatilhos (query, stale longo)
//   - useNotificationRule          — detalhe de uma regra (query, para edit prefill)
//   - useCreateNotificationRule    — criação de regra (mutation)
//   - useUpdateNotificationRule    — atualização parcial / toggle enabled (mutation)
//   - useDeleteNotificationRule    — remoção de regra (mutation)
//   - useTestNotificationRule      — dry-run: preview destinatários + render (mutation)
//
// Nunca useEffect + fetch — apenas TanStack Query.
// Invalidate após mutate para manter cache consistente.
// =============================================================================
import type {
  NotificationRuleCreate,
  NotificationRuleListResponse,
  NotificationRuleResponse,
  NotificationRuleTestResponse,
} from '@elemento/shared-schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createNotificationRule,
  deleteNotificationRule,
  fetchNotificationCatalog,
  fetchNotificationRule,
  fetchNotificationRules,
  testNotificationRule,
  updateNotificationRule,
} from './api';
import type { CatalogResponse, ListRulesParams } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const NOTIFICATION_RULES_KEYS = {
  all: ['notification-rules'] as const,
  list: (params: ListRulesParams) => [...NOTIFICATION_RULES_KEYS.all, 'list', params] as const,
  detail: (id: string) => [...NOTIFICATION_RULES_KEYS.all, 'detail', id] as const,
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
// useNotificationRule (detalhe — prefill de edit)
// ---------------------------------------------------------------------------

/**
 * Busca o detalhe de uma regra pelo id.
 * Quando id é undefined a query fica desabilitada (enabled: false).
 * Usamos skipToken para compatibilidade com exactOptionalPropertyTypes.
 */
export function useNotificationRule(id: string | undefined): {
  data: NotificationRuleResponse | undefined;
  isLoading: boolean;
  isError: boolean;
} {
  // skipToken desabilita a query sem precisar de queryFn: undefined
  // (evita erro de tipo com exactOptionalPropertyTypes: true)
  const { data, isLoading, isError } = useQuery<NotificationRuleResponse>({
    queryKey:
      id !== undefined ? NOTIFICATION_RULES_KEYS.detail(id) : ['notification-rules', 'noop'],
    queryFn:
      id !== undefined ? () => fetchNotificationRule(id) : () => Promise.reject(new Error('no-op')),
    enabled: id !== undefined,
    staleTime: 60_000,
    retry: false,
  });

  return { data, isLoading, isError };
}

// ---------------------------------------------------------------------------
// useCreateNotificationRule
// ---------------------------------------------------------------------------

export interface CreateRuleCallbacks {
  onSuccess?: (rule: NotificationRuleResponse) => void;
  onError?: (err: Error) => void;
}

export function useCreateNotificationRule(callbacks?: CreateRuleCallbacks) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: NotificationRuleCreate) => createNotificationRule(body),
    onSuccess: (rule) => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_RULES_KEYS.all });
      callbacks?.onSuccess?.(rule);
    },
    onError: (err) => {
      callbacks?.onError?.(err instanceof Error ? err : new Error(String(err)));
    },
  });
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
    onSuccess: (_rule, { id }) => {
      // Invalida lista + detalhe específico
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_RULES_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: NOTIFICATION_RULES_KEYS.detail(id) });
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

// ---------------------------------------------------------------------------
// useTestNotificationRule
//
// Dry-run: preview de destinatários resolvidos + template renderizado.
// Não envia notificação.
// ---------------------------------------------------------------------------

export function useTestNotificationRule(): {
  test: (id: string) => void;
  data: NotificationRuleTestResponse | undefined;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  reset: () => void;
} {
  const mutation = useMutation({
    mutationFn: (id: string) => testNotificationRule(id),
  });

  return {
    test: mutation.mutate,
    data: mutation.data,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error instanceof Error ? mutation.error : null,
    reset: mutation.reset,
  };
}
