// =============================================================================
// hooks/kanban/useMoveCard.ts — Mutation para mover card entre colunas.
//
// Otimismo UI: aplica a mudança localmente antes da resposta do servidor.
// Rollback completo em caso de erro (incluindo 422 para transição inválida).
// Invalidação do cache após sucesso.
// =============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ApiError, api } from '../../lib/api';

import type { KanbanCard, KanbanFilters, MoveCardPayload, MoveCardResponse } from './types';
import { KANBAN_CARDS_KEY } from './useKanbanCards';

export interface MoveCardContext {
  previousCardsByStage: Record<string, KanbanCard[]>;
}

export interface UseMoveCardOptions {
  filters: KanbanFilters;
  onInvalidTransition?: (cardId: string, targetStageId: string) => void;
  onError?: (error: Error) => void;
  onSuccess?: () => void;
}

/**
 * Mutation para mover um card entre colunas.
 *
 * Estratégia otimista:
 * 1. Salva snapshot do estado atual.
 * 2. Aplica a mudança localmente (remove da origem, adiciona no destino).
 * 3. POST /api/kanban/cards/:id/move
 * 4. Em erro: rollback completo via snapshot.
 * 5. Em sucesso: invalida queries para forçar re-fetch.
 *
 * Erro 422: transição inválida conforme matriz do F1-S13.
 *           Chama onInvalidTransition para o toast específico.
 */
export function useMoveCard({
  filters,
  onInvalidTransition,
  onError,
  onSuccess,
}: UseMoveCardOptions) {
  const queryClient = useQueryClient();
  const queryKey = KANBAN_CARDS_KEY(filters);

  return useMutation<MoveCardResponse, Error, MoveCardPayload, MoveCardContext>({
    mutationFn: ({ cardId, targetStageId, position }) =>
      api.post<MoveCardResponse>(`/api/kanban/cards/${cardId}/move`, {
        stage_id: targetStageId,
        position,
      }),

    onMutate: async ({ cardId, targetStageId, position = 1 }) => {
      // Cancela queries em curso para evitar sobrescrita do estado otimista
      await queryClient.cancelQueries({ queryKey });

      // Snapshot para rollback
      const previousData = queryClient.getQueryData<KanbanCard[]>(queryKey);
      const previousCardsByStage: Record<string, KanbanCard[]> = {};
      if (previousData) {
        for (const card of previousData) {
          if (!previousCardsByStage[card.stageId]) {
            previousCardsByStage[card.stageId] = [];
          }
          previousCardsByStage[card.stageId]!.push(card);
        }
      }

      // Aplicar mudança otimista
      queryClient.setQueryData<KanbanCard[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((card) =>
          card.id === cardId ? { ...card, stageId: targetStageId, position } : card,
        );
      });

      return { previousCardsByStage };
    },

    onError: (error, { cardId, targetStageId }, context) => {
      // Rollback: restaura snapshot anterior
      if (context?.previousCardsByStage) {
        const allCards = Object.values(context.previousCardsByStage).flat();
        queryClient.setQueryData<KanbanCard[]>(queryKey, allCards);
      }

      // 422 = transição inválida conforme matriz do F1-S13
      if (error instanceof ApiError && error.status === 422) {
        onInvalidTransition?.(cardId, targetStageId);
        return;
      }

      onError?.(error);
    },

    onSuccess: () => {
      // Invalida cache para sincronizar com servidor
      void queryClient.invalidateQueries({ queryKey });
      onSuccess?.();
    },
  });
}
