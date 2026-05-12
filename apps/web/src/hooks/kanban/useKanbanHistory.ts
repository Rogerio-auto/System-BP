// =============================================================================
// hooks/kanban/useKanbanHistory.ts — Histórico de um card.
//
// TODO(F1-S13b): endpoint GET /api/kanban/cards/:id/history ainda não existe.
// Retorna mock data enquanto não disponível.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { KanbanStageHistory } from './types';

export const KANBAN_HISTORY_KEY = (cardId: string) => ['kanban', 'history', cardId] as const;

const MOCK_HISTORY: KanbanStageHistory[] = [
  {
    id: 'hist-1',
    cardId: 'any',
    fromStageId: null,
    toStageId: 'stage-1',
    fromStageName: null,
    toStageName: 'Novo Lead',
    actorName: 'Sistema',
    note: 'Lead criado via WhatsApp',
    createdAt: new Date(Date.now() - 86_400_000 * 3).toISOString(),
  },
  {
    id: 'hist-2',
    cardId: 'any',
    fromStageId: 'stage-1',
    toStageId: 'stage-2',
    fromStageName: 'Novo Lead',
    toStageName: 'Em Análise',
    actorName: 'Agente 1',
    note: 'Documentos recebidos. Iniciando análise.',
    createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  },
];

async function fetchHistory(cardId: string): Promise<KanbanStageHistory[]> {
  try {
    return await api.get<KanbanStageHistory[]>(`/api/kanban/cards/${cardId}/history`);
  } catch {
    // TODO(F1-S13b): remover mock quando endpoint estiver disponível
    return MOCK_HISTORY.map((h) => ({ ...h, cardId }));
  }
}

/**
 * Hook para buscar o histórico de estágios de um card específico.
 * Ativado apenas quando cardId é fornecido (lazy — só carrega no modal).
 */
export function useKanbanHistory(cardId: string | null): {
  history: KanbanStageHistory[];
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery({
    queryKey: KANBAN_HISTORY_KEY(cardId ?? ''),
    queryFn: () => fetchHistory(cardId!),
    enabled: Boolean(cardId),
    staleTime: 30_000,
  });

  return {
    history: data ?? [],
    isLoading,
  };
}
