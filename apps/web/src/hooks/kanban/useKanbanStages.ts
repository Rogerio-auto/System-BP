// =============================================================================
// hooks/kanban/useKanbanStages.ts — Busca as colunas do Kanban.
//
// TODO(F1-S13b): endpoint GET /api/kanban/stages ainda não existe.
// Retorna mock data enquanto o endpoint não estiver disponível.
// Remover mock e apontar para o endpoint real quando F1-S13b for concluído.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { KanbanStage } from './types';

export const KANBAN_STAGES_KEY = ['kanban', 'stages'] as const;

// ── Mock fallback (remover quando endpoint existir) ───────────────────────────

const MOCK_STAGES: KanbanStage[] = [
  {
    id: 'stage-1',
    name: 'Novo Lead',
    slug: 'novo-lead',
    position: 1,
    color: 'var(--brand-azul)',
    cityId: 'city-1',
    organizationId: 'org-1',
  },
  {
    id: 'stage-2',
    name: 'Em Análise',
    slug: 'em-analise',
    position: 2,
    color: 'var(--brand-amarelo)',
    cityId: 'city-1',
    organizationId: 'org-1',
  },
  {
    id: 'stage-3',
    name: 'Aprovado',
    slug: 'aprovado',
    position: 3,
    color: 'var(--brand-verde)',
    cityId: 'city-1',
    organizationId: 'org-1',
  },
  {
    id: 'stage-4',
    name: 'Contrato',
    slug: 'contrato',
    position: 4,
    color: 'var(--brand-azul-deep)',
    cityId: 'city-1',
    organizationId: 'org-1',
  },
  {
    id: 'stage-5',
    name: 'Encerrado',
    slug: 'encerrado',
    position: 5,
    color: 'var(--text-3)',
    cityId: 'city-1',
    organizationId: 'org-1',
  },
];

async function fetchStages(): Promise<KanbanStage[]> {
  try {
    return await api.get<KanbanStage[]>('/api/kanban/stages');
  } catch {
    // TODO(F1-S13b): remover mock quando endpoint estiver disponível
    return MOCK_STAGES;
  }
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
