// =============================================================================
// hooks/kanban/useKanbanStages.ts — Busca as colunas do Kanban.
//
// Endpoint real: GET /api/kanban/stages → { stages: KanbanStage[] }
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { KanbanStage } from './types';

export const KANBAN_STAGES_KEY = ['kanban', 'stages'] as const;

interface StagesResponse {
  stages: KanbanStage[];
}

async function fetchStages(): Promise<KanbanStage[]> {
  const res = await api.get<StagesResponse>('/api/kanban/stages');
  return res.stages;
}

/**
 * Hook para buscar as colunas/estágios do Kanban.
 * Cache de 60s — estágios raramente mudam.
 */
export function useKanbanStages(): {
  stages: KanbanStage[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: KANBAN_STAGES_KEY,
    queryFn: fetchStages,
    staleTime: 60_000,
  });

  return {
    stages: data ?? [],
    isLoading,
    isError,
  };
}
