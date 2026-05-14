// =============================================================================
// components/kanban/KanbanColumn.tsx — Coluna do Kanban.
//
// Header: caption-style, badge de contagem.
// Body: bg-elev-2, elev-1, lista de cards droppable.
// Drop zones:
//   - Coluna válida: border-dashed brand-azul
//   - Coluna inválida: border-dashed danger
// Empty state: SVG inline + caption.
// Skeleton de loading: 3 cards placeholder.
// =============================================================================

import { useDroppable } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import * as React from 'react';

import type { KanbanCard, KanbanStage } from '../../hooks/kanban/types';
import { cn } from '../../lib/cn';

import { KanbanCard as KanbanCardComponent } from './KanbanCard';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  stage: KanbanStage;
  cards: KanbanCard[];
  isLoading?: boolean | undefined;
  isOver?: boolean | undefined;
  isInvalid?: boolean | undefined;
  onCardClick: (card: KanbanCard) => void;
}

// ── Empty State ────────────────────────────────────────────────────────────────

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-8 px-4">
      {/* Ilustração SVG inline minimalista */}
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect
          x="8"
          y="8"
          width="32"
          height="32"
          rx="6"
          stroke="var(--border-strong)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
        <path
          d="M18 24h12M24 18v12"
          stroke="var(--border-strong)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <p
        className="font-sans text-ink-4 text-center"
        style={{
          fontSize: 'var(--text-xs)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        Sem cards nessa etapa
      </p>
    </div>
  );
}

// ── Card Skeleton ──────────────────────────────────────────────────────────────

function CardSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-[var(--bg-elev-1)] p-3 flex flex-col gap-2 animate-pulse"
      style={{ boxShadow: 'var(--elev-1)' }}
    >
      <div className="h-3.5 bg-surface-muted rounded-xs w-3/4" />
      <div className="h-3 bg-surface-muted rounded-xs w-1/2" />
      <div className="h-3 bg-surface-muted rounded-xs w-1/3" />
      <div className="flex justify-between pt-1 border-t border-border-subtle">
        <div className="h-3 bg-surface-muted rounded-xs w-1/4" />
        <div className="h-3 bg-surface-muted rounded-xs w-1/6" />
      </div>
    </div>
  );
}

// ── Contagem badge ─────────────────────────────────────────────────────────────

interface CountBadgeProps {
  count: number;
}

function CountBadge({ count }: CountBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center',
        'font-sans font-bold text-ink-3',
        'bg-[var(--surface-muted)] rounded-pill',
        'px-2 py-0.5 min-w-[20px]',
      )}
      style={{
        fontSize: 'var(--text-xs)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {count}
    </span>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

/**
 * Coluna do Kanban — wrapper droppable para SortableContext.
 *
 * isOver + isInvalid controlam o indicador visual da drop zone:
 * - Válido: border-dashed brand-azul
 * - Inválido: border-dashed danger
 */
export function KanbanColumn({
  stage,
  cards,
  isLoading = false,
  isOver = false,
  isInvalid = false,
  onCardClick,
}: KanbanColumnProps): React.JSX.Element {
  const cardIds = cards.map((c) => c.id);

  // useDroppable garante que o body da coluna receba drops mesmo quando vazio.
  // Sem isso, `over` no DragEnd vem null ao soltar em coluna sem cards.
  const { setNodeRef, isOver: isDirectlyOver } = useDroppable({ id: stage.id });

  return (
    <div
      className="flex flex-col gap-0 min-w-[260px] max-w-[300px] w-full flex-shrink-0"
      role="region"
      aria-label={`Coluna ${stage.name}`}
    >
      {/* ── Header da coluna ─────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 mb-2">
        <h2
          className="font-sans font-bold text-ink-2 uppercase tracking-wider"
          style={{ fontSize: 'var(--text-xs)' }}
        >
          {stage.name}
        </h2>
        <CountBadge count={isLoading ? 0 : cards.length} />
      </div>

      {/* ── Body droppable ───────────────────────────────────────── */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-col gap-2 rounded-md p-2',
          'bg-[var(--bg-elev-2)] min-h-[120px] flex-1',
          'border border-transparent',
          'transition-[border-color,background] duration-fast ease-out',
          // Drop zone indicators — só destaca quando o ponteiro está SOBRE esta coluna
          isDirectlyOver && !isInvalid && 'border-dashed border-azul bg-[var(--info-bg)]',
          isOver && isInvalid && 'border-dashed border-danger bg-[var(--danger-bg)]',
        )}
        style={{ boxShadow: 'var(--elev-1)' }}
      >
        {isLoading ? (
          // Skeleton loading — 3 cards placeholder
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          // Sem `strategy`: evita shift dos outros cards (sensação de cursor
          // 1-2 slots à frente). Drop entre colunas é detectado pelo
          // useDroppable da coluna + closestCorners do DndContext.
          <SortableContext items={cardIds}>
            {cards.length === 0 ? (
              <EmptyState />
            ) : (
              cards.map((card) => (
                <KanbanCardComponent key={card.id} card={card} onClick={onCardClick} />
              ))
            )}
          </SortableContext>
        )}
      </div>
    </div>
  );
}
