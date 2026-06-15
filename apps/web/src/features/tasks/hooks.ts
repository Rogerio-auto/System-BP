// =============================================================================
// features/tasks/hooks.ts — TanStack Query hooks para o domínio de tarefas.
//
// Regras:
//   - Nunca useEffect + fetch — sempre TanStack Query.
//   - Mutações invalidam a lista após sucesso.
//   - Chaves de query seguem padrão ['tasks', params].
// =============================================================================

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cancelTask, claimTask, completeTask, fetchTasks } from './api';
import type { TasksQueryParams } from './api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const taskKeys = {
  all: ['tasks'] as const,
  list: (params: TasksQueryParams) => ['tasks', 'list', params] as const,
} as const;

// ---------------------------------------------------------------------------
// Hooks de leitura
// ---------------------------------------------------------------------------

/**
 * Lista paginada de tarefas com filtros opcionais.
 * staleTime herdado do QueryClient global (30s).
 */
export function useTasks(params: TasksQueryParams = {}) {
  return useQuery({
    queryKey: taskKeys.list(params),
    queryFn: () => fetchTasks(params),
  });
}

// ---------------------------------------------------------------------------
// Hooks de mutação
// ---------------------------------------------------------------------------

/**
 * Assume uma tarefa.
 * Após sucesso invalida a lista — o claimed_by é atualizado no servidor e
 * a tarefa permanece visível na lista (status continua open/in_progress).
 */
export function useClaimTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => claimTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/**
 * Conclui uma tarefa.
 * Após sucesso invalida a lista — tarefa sai da visão open/in_progress.
 */
export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => completeTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

/**
 * Cancela uma tarefa.
 * Após sucesso invalida a lista — tarefa sai da visão open/in_progress.
 */
export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelTask(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
