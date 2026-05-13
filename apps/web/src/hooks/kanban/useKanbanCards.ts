// =============================================================================
// hooks/kanban/useKanbanCards.ts — Busca os cards do Kanban com filtros.
//
// Endpoint real: GET /api/kanban/cards?city_id=...&agent_id=... → { cards, total }
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { KanbanCard, KanbanFilters } from './types';

export const KANBAN_CARDS_KEY = (filters: KanbanFilters) => ['kanban', 'cards', filters] as const;

interface CardsResponse {
  cards: KanbanCard[];
  total: number;
}

async function fetchCards(filters: KanbanFilters): Promise<KanbanCard[]> {
  const params = new URLSearchParams();
  if (filters.cityId) params.set('city_id', filters.cityId);
  if (filters.agentId) params.set('agent_id', filters.agentId);
  if (filters.minAmountCents !== undefined)
    params.set('min_amount_cents', String(filters.minAmountCents));
  if (filters.maxAmountCents !== undefined)
    params.set('max_amount_cents', String(filters.maxAmountCents));
  if (filters.dateFrom) params.set('date_from', filters.dateFrom);
  if (filters.dateTo) params.set('date_to', filters.dateTo);

  const qs = params.toString();
  const res = await api.get<CardsResponse>(`/api/kanban/cards${qs ? `?${qs}` : ''}`);
  return res.cards;
}

/**
 * Hook para buscar todos os cards do Kanban com filtros opcionais.
 * Retorna cards indexados por stageId para facilitar render das colunas.
 */
export function useKanbanCards(filters: KanbanFilters = {}): {
  cardsByStage: Record<string, KanbanCard[]>;
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: KANBAN_CARDS_KEY(filters),
    queryFn: () => fetchCards(filters),
    staleTime: 15_000,
  });

  const cardsByStage: Record<string, KanbanCard[]> = {};
  if (data) {
    for (const card of data) {
      if (!cardsByStage[card.stageId]) {
        cardsByStage[card.stageId] = [];
      }
      cardsByStage[card.stageId]!.push(card);
    }
    // Sort by position within each stage
    for (const stageId of Object.keys(cardsByStage)) {
      cardsByStage[stageId]!.sort((a, b) => a.position - b.position);
    }
  }

  return { cardsByStage, isLoading, isError };
}
