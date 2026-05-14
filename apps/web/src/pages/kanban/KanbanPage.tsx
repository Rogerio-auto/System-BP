// =============================================================================
// pages/kanban/KanbanPage.tsx — Tela principal do Kanban (rota /kanban).
//
// Arquitetura drag-and-drop:
//   @dnd-kit/core + @dnd-kit/sortable
//   Motivo: acessibilidade out-of-the-box (ARIA live regions, keyboard nav),
//   bundle menor que react-beautiful-dnd (~10KB vs ~28KB gzip),
//   sem deps legadas (React 18 compat nativo), API composable.
//
// Fluxo otimista:
//   1. DragEnd → identifica card e coluna destino.
//   2. Verifica transição válida (ou deixa o backend retornar 422).
//   3. useMoveCard aplica localmente e chama POST /api/kanban/cards/:id/move.
//   4. Erro 422 → rollback + toast com coluna inválida destacada.
//   5. Outros erros → rollback + toast genérico.
//
// LGPD: nenhum dado pessoal nos parâmetros de URL ou logs de console.
// =============================================================================

import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { KanbanCardOverlay } from '../../components/kanban/KanbanCard';
import { KanbanColumn } from '../../components/kanban/KanbanColumn';
import { KanbanDetailModal } from '../../components/kanban/KanbanDetailModal';
import { KanbanFiltersBar } from '../../components/kanban/KanbanFilters';
import { KanbanToastContainer, useKanbanToasts } from '../../components/kanban/KanbanToast';
import type { KanbanCard as KanbanCardType, KanbanFilters } from '../../hooks/kanban/types';
import { useKanbanCards } from '../../hooks/kanban/useKanbanCards';
import { useKanbanStages } from '../../hooks/kanban/useKanbanStages';
import { useMoveCard } from '../../hooks/kanban/useMoveCard';

// ── Componente principal ──────────────────────────────────────────────────────

interface KanbanPageProps {
  /** Quando `true`, suprime o cabeçalho interno (h1 + subtitle).
   * Usado ao renderizar o board embutido dentro do CRM. */
  hideHeader?: boolean;
}

/**
 * Página Kanban — board drag-and-drop de leads por etapa.
 *
 * Lib DnD: @dnd-kit/core + @dnd-kit/sortable
 * - Acessibilidade: keyboard DnD, ARIA live regions automáticos.
 * - Bundle: ~10KB gzip, sem legado React 16.
 * - API composable: DragOverlay separado do Sortable.
 *
 * Otimismo UI: useMoveCard aplica mutação local e faz rollback em erro.
 */
export function KanbanPage({ hideHeader = false }: KanbanPageProps): React.JSX.Element {
  // ── Estado ─────────────────────────────────────────────────────────────────
  const [filters, setFilters] = React.useState<KanbanFilters>({});
  const [activeCard, setActiveCard] = React.useState<KanbanCardType | null>(null);
  const [detailCard, setDetailCard] = React.useState<KanbanCardType | null>(null);
  const [invalidStageId, setInvalidStageId] = React.useState<string | null>(null);

  // ── Data fetching ───────────────────────────────────────────────────────────
  const { stages, isLoading: stagesLoading } = useKanbanStages();
  const { cardsByStage, isLoading: cardsLoading } = useKanbanCards(filters);

  // ── Toasts ─────────────────────────────────────────────────────────────────
  const { toasts, addToast, dismissToast } = useKanbanToasts();

  // ── Move mutation ───────────────────────────────────────────────────────────
  const moveCard = useMoveCard({
    filters,
    onInvalidTransition: (_cardId, targetStageId) => {
      // Destaca a coluna inválida por 2s
      setInvalidStageId(targetStageId);
      setTimeout(() => setInvalidStageId(null), 2_000);

      const stageName = stages.find((s) => s.id === targetStageId)?.name ?? 'essa etapa';
      addToast({
        variant: 'error',
        title: 'Transição inválida',
        description: `Não é possível mover para "${stageName}" a partir do estágio atual.`,
      });
    },
    onError: (_error) => {
      addToast({
        variant: 'warning',
        title: 'Erro ao mover card',
        description: 'Tente novamente. O card foi restaurado à posição original.',
      });
    },
  });

  // ── DnD sensors ────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Exige 8px de movimento antes de ativar drag — evita drag acidental em click
        distance: 8,
      },
    }),
  );

  // ── Helpers para encontrar stage de um card ─────────────────────────────────
  const findCardById = React.useCallback(
    (cardId: string): KanbanCardType | undefined => {
      for (const cards of Object.values(cardsByStage)) {
        const found = cards.find((c) => c.id === cardId);
        if (found) return found;
      }
      return undefined;
    },
    [cardsByStage],
  );

  // ── Drag handlers ───────────────────────────────────────────────────────────

  const handleDragStart = React.useCallback(
    (event: DragStartEvent) => {
      const card = findCardById(String(event.active.id));
      if (card) setActiveCard(card);
    },
    [findCardById],
  );

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      setActiveCard(null);
      const { active, over } = event;

      if (!over) return;

      const cardId = String(active.id);
      const card = findCardById(cardId);
      if (!card) return;

      // over.id pode ser o id de um card (sortable) ou um stage (droppable)
      // Nós usamos o stageId de destino: se over.id é um card, pega o stageId
      // dele; se é um stageId direto, usa diretamente.
      let targetStageId = String(over.id);

      // Verifica se o over é um card — nesse caso usa o stageId do card destino
      const overCard = findCardById(targetStageId);
      if (overCard) {
        targetStageId = overCard.stageId;
      }

      // Se já está no mesmo estágio, não faz nada
      if (card.stageId === targetStageId) return;

      // Calcula posição de destino
      const targetCards = cardsByStage[targetStageId] ?? [];
      const newPosition = overCard
        ? targetCards.findIndex((c) => c.id === over.id) + 1
        : targetCards.length + 1;

      moveCard.mutate({
        cardId,
        targetStageId,
        position: newPosition,
      });
    },
    [findCardById, cardsByStage, moveCard],
  );

  // ── Stage name lookup para o modal ─────────────────────────────────────────
  const detailStageName = React.useMemo(
    () => (detailCard ? (stages.find((s) => s.id === detailCard.stageId)?.name ?? '') : ''),
    [detailCard, stages],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Cabeçalho da página — ocultado quando embutido no CRM */}
      {!hideHeader && (
        <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out)' }}>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.045em',
              fontVariationSettings: "'opsz' 48",
              lineHeight: 1,
            }}
          >
            Kanban
          </h1>
          <p className="font-sans text-sm text-ink-3 mt-1">
            Gerencie leads por etapa com drag-and-drop.
          </p>
        </div>
      )}

      {/* Filtros */}
      <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}>
        <KanbanFiltersBar filters={filters} onChange={setFilters} />
      </div>

      {/* Board
          NÃO aplicamos `animation: fade-up` aqui: o transform do fade-up
          torna este div um containing-block para `position: fixed`, e o
          DragOverlay do dnd-kit (fixed) acaba posicionado relativo a este
          container em vez do viewport — o card "voa pra baixo" no drag. */}
      <div className="flex-1 min-h-0 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          measuring={{
            droppable: { strategy: MeasuringStrategy.Always },
          }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 pb-4 min-w-max h-full">
            {stagesLoading ? (
              // Skeleton de colunas
              <>
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="min-w-[260px] max-w-[300px] rounded-md bg-[var(--bg-elev-2)] animate-pulse"
                    style={{
                      height: '400px',
                      boxShadow: 'var(--elev-1)',
                    }}
                  />
                ))}
              </>
            ) : (
              stages.map((stage) => {
                const cards = cardsByStage[stage.id] ?? [];
                const isOver = activeCard !== null;
                const isInvalid = invalidStageId === stage.id;

                return (
                  <KanbanColumn
                    key={stage.id}
                    stage={stage}
                    cards={cards}
                    isLoading={cardsLoading}
                    isOver={isOver}
                    isInvalid={isInvalid}
                    onCardClick={setDetailCard}
                  />
                );
              })
            )}
          </div>

          {/* Overlay — clone do card durante drag.
              Renderizado via portal no <body> para escapar de QUALQUER
              ancestor com transform/filter/perspective que possa criar
              containing-block para `position: fixed` e desalinhar o overlay
              do cursor (animations fade-up, etc). */}
          {typeof document !== 'undefined' &&
            createPortal(
              <DragOverlay>
                {activeCard ? <KanbanCardOverlay card={activeCard} /> : null}
              </DragOverlay>,
              document.body,
            )}
        </DndContext>
      </div>

      {/* Modal de detalhe */}
      <KanbanDetailModal
        card={detailCard}
        stageName={detailStageName}
        onClose={() => setDetailCard(null)}
      />

      {/* Toasts */}
      <KanbanToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
