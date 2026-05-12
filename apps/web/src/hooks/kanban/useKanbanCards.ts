// =============================================================================
// hooks/kanban/useKanbanCards.ts — Busca os cards de um estágio.
//
// TODO(F1-S13b): endpoint GET /api/kanban/cards?stage_id=... ainda não existe.
// Retorna mock data enquanto o endpoint não estiver disponível.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type { KanbanCard, KanbanFilters } from './types';

export const KANBAN_CARDS_KEY = (filters: KanbanFilters) => ['kanban', 'cards', filters] as const;

// ── Mock fallback (remover quando endpoint existir) ───────────────────────────

function generateMockCards(stageId: string, count: number): KanbanCard[] {
  const names = [
    'Ana Silva',
    'Carlos Mendes',
    'Fernanda Lima',
    'João Oliveira',
    'Maria Santos',
    'Pedro Alves',
    'Sandra Costa',
    'Rodrigo Ferreira',
  ];
  const agents = ['Agente 1', 'Agente 2', null];
  const notes = [
    'Documentação pendente',
    'Aguardando análise de crédito',
    null,
    'Retornar na segunda-feira',
  ];

  return Array.from({ length: count }, (_, i) => ({
    id: `card-${stageId}-${i + 1}`,
    stageId,
    leadId: `lead-${stageId}-${i + 1}`,
    leadName: names[i % names.length] ?? 'Lead',
    // LGPD: telefone mascarado — nunca expor número completo
    phoneMasked: `+55 69 ****-${String(1000 + i * 37).slice(-4)}`,
    agentId: i % 3 === 0 ? null : `agent-${(i % 2) + 1}`,
    agentName: agents[i % agents.length] ?? null,
    loanAmountCents: (5 + i) * 100_000,
    position: i + 1,
    lastNote: notes[i % notes.length] ?? null,
    updatedAt: new Date(Date.now() - i * 3_600_000).toISOString(),
  }));
}

const MOCK_CARDS: Record<string, KanbanCard[]> = {
  'stage-1': generateMockCards('stage-1', 3),
  'stage-2': generateMockCards('stage-2', 2),
  'stage-3': generateMockCards('stage-3', 1),
  'stage-4': generateMockCards('stage-4', 0),
  'stage-5': generateMockCards('stage-5', 1),
};

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
  try {
    return await api.get<KanbanCard[]>(`/api/kanban/cards${qs ? `?${qs}` : ''}`);
  } catch {
    // TODO(F1-S13b): remover mock quando endpoint estiver disponível
    const allMock = Object.values(MOCK_CARDS).flat();
    return allMock;
  }
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
