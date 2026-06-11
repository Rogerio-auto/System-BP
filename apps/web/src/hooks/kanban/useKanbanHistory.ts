// =============================================================================
// hooks/kanban/useKanbanHistory.ts — Histórico de um card.
//
// Consome GET /api/kanban/cards/:id/history (implementado em F13-S07).
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { KanbanStageHistory } from './types';

export const KANBAN_HISTORY_KEY = (cardId: string) => ['kanban', 'history', cardId] as const;

async function fetchHistory(cardId: string): Promise<KanbanStageHistory[]> {
  return api.get<KanbanStageHistory[]>(`/api/kanban/cards/${cardId}/history`);
}

/**
 * Hook para buscar o histórico de estágios de um card específico.
 * Ativado apenas quando cardId é fornecido (lazy — só carrega no modal).
 */
export function useKanbanHistory(cardId: string | null): {
  history: KanbanStageHistory[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: KANBAN_HISTORY_KEY(cardId ?? ''),
    queryFn: () => fetchHistory(cardId!),
    enabled: Boolean(cardId),
    staleTime: 30_000,
  });

  return {
    history: data ?? [],
    isLoading,
    isError,
  };
}
