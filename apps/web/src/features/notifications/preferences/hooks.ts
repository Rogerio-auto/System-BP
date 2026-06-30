// =============================================================================
// features/notifications/preferences/hooks.ts — TanStack Query hooks.
//
// useNotificationPreferences  — GET com staleTime de 5 min.
// useUpdateNotificationPreferences — PUT com optimistic update + rollback em erro.
//
// Nunca useEffect + fetch — sempre TanStack Query.
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { PreferenceItem, PreferencesBatchUpdate, PreferencesResponse } from './api';
import { fetchPreferences, updatePreferences } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const preferencesKeys = {
  all: ['notifications', 'preferences'] as const,
} as const;

// ---------------------------------------------------------------------------
// Hook de leitura
// ---------------------------------------------------------------------------

/**
 * Lê a matriz de preferências do usuário autenticado.
 * staleTime alto pois preferências mudam raramente.
 */
export function useNotificationPreferences() {
  return useQuery({
    queryKey: preferencesKeys.all,
    queryFn: fetchPreferences,
    staleTime: 5 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Hook de mutação
// ---------------------------------------------------------------------------

/**
 * Atualiza preferências de notificação com optimistic update.
 * Em erro HTTP/rede, faz rollback automático ao snapshot anterior.
 * onSettled invalida o cache para revalidar com o servidor.
 */
export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (body: PreferencesBatchUpdate) => updatePreferences(body),

    // Optimistic update: merge incoming prefs no cache antes da resposta
    onMutate: async (body: PreferencesBatchUpdate) => {
      await qc.cancelQueries({ queryKey: preferencesKeys.all });

      const previous = qc.getQueryData<PreferencesResponse>(preferencesKeys.all);

      qc.setQueryData<PreferencesResponse>(preferencesKeys.all, (old) => {
        if (!old) return old;

        const updated: PreferenceItem[] = [...old.data];

        for (const incoming of body.preferences) {
          const incomingCategory = incoming.category ?? null;
          const idx = updated.findIndex(
            (p) => p.channel === incoming.channel && (p.category ?? null) === incomingCategory,
          );
          if (idx >= 0) {
            const existing = updated[idx];
            if (existing) {
              updated[idx] = { ...existing, enabled: incoming.enabled };
            }
          } else {
            updated.push({ ...incoming });
          }
        }

        return { data: updated };
      });

      return { previous };
    },

    // Rollback ao snapshot anterior em caso de erro
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData<PreferencesResponse>(preferencesKeys.all, ctx.previous);
      }
    },

    // Revalida com o servidor após qualquer desfecho
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: preferencesKeys.all });
    },
  });
}
