// =============================================================================
// components/kanban/KanbanCard.tsx — Card arrastável do Kanban.
//
// DS §9.3: bg-elev-1, border, elev-2, hover Spotlight.
// Durante drag: elev-4 + scale(1.02) + opacity 0.95 (DS §8 drag state).
// Spotlight: halo radial verde segue cursor via CSS custom props --mx/--my.
// LGPD: apenas phoneMasked é exibido. Nunca CPF ou nome completo visível em log.
// =============================================================================

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import * as React from 'react';

import type { KanbanCard as KanbanCardType } from '../../hooks/kanban/types';
import { cn } from '../../lib/cn';

// ── Formatadores ──────────────────────────────────────────────────────────────

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'Agora mesmo';
  if (hours < 24) return `Há ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Há ${days}d`;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(
    new Date(dateStr),
  );
}

// ── Ícones ────────────────────────────────────────────────────────────────────

function IconPhone(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.58 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.55a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconUser(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface KanbanCardProps {
  card: KanbanCardType;
  onClick: (card: KanbanCardType) => void;
  /** Desabilitar drag em estado de loading */
  disabled?: boolean | undefined;
}

// ── Componente ────────────────────────────────────────────────────────────────

/**
 * Card do Kanban com drag-and-drop via @dnd-kit/sortable.
 *
 * Hover Spotlight: pseudo-elemento radial verde segue o cursor via
 * custom properties CSS --mx/--my atualizadas no onPointerMove.
 *
 * DS §9.3: bg-elev-1, border, elev-2. Durante drag: elev-4, scale, opacity.
 */
export function KanbanCard({
  card,
  onClick,
  disabled = false,
}: KanbanCardProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled,
  });

  // Spotlight: atualiza --mx/--my em percentagem relativa ao card
  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isDragging) return;
      const el = e.currentTarget;
      const rect = el.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      el.style.setProperty('--mx', `${x}%`);
      el.style.setProperty('--my', `${y}%`);
    },
    [isDragging],
  );

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // DS §8 drag state
    ...(isDragging
      ? {
          boxShadow: 'var(--elev-4)',
          opacity: 0.95,
          transform: `${CSS.Transform.toString(transform) ?? ''} scale(1.02)`,
          zIndex: 50,
        }
      : {}),
    // Spotlight custom props
    '--mx': '50%',
    '--my': '50%',
  } as React.CSSProperties & { '--mx': string; '--my': string };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        // DS §9.3 base
        'relative group overflow-hidden',
        'rounded-md border border-border',
        'bg-[var(--bg-elev-1)]',
        'p-3 flex flex-col gap-2',
        // Transições
        'transition-[transform,box-shadow,opacity,border-color]',
        'duration-fast ease-out',
        // Hover: lift + border stronger (Spotlight via pseudo-element CSS)
        !isDragging && [
          'hover:-translate-y-[3px]',
          'hover:border-border-strong',
          'cursor-grab active:cursor-grabbing',
        ],
        // Drag state (shadow via inline style, scale via transform)
        !isDragging && 'shadow-e2',
        // Não clicável durante drag
        isDragging && 'pointer-events-none select-none',
      )}
      onPointerMove={handlePointerMove}
      onClick={() => !isDragging && onClick(card)}
      role="button"
      tabIndex={0}
      aria-label={`Card: ${card.leadName}. Clique para ver detalhes.`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(card);
        }
      }}
    >
      {/* Spotlight: radial verde segue cursor — DS §8 padrão Spotlight */}
      {!isDragging && (
        <span
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-[250ms]"
          style={{
            background:
              'radial-gradient(circle 80px at var(--mx, 50%) var(--my, 50%), rgba(46,155,62,0.10), transparent 70%)',
          }}
        />
      )}

      {/* Nome do lead */}
      <p
        className="font-display font-bold text-ink leading-tight relative z-10"
        style={{
          fontSize: 'var(--text-sm)',
          letterSpacing: '-0.028em',
        }}
      >
        {card.leadName}
      </p>

      {/* Telefone mascarado (LGPD) */}
      <div className="flex items-center gap-1.5 text-ink-3 relative z-10">
        <IconPhone />
        <span className="font-mono text-xs" style={{ letterSpacing: '-0.01em' }}>
          {card.phoneMasked}
        </span>
      </div>

      {/* Valor do empréstimo */}
      {card.loanAmountCents !== null && (
        <p
          className="font-mono font-semibold text-azul relative z-10"
          style={{ fontSize: 'var(--text-xs)', letterSpacing: '-0.01em' }}
        >
          {formatCurrency(card.loanAmountCents)}
        </p>
      )}

      {/* Footer: agente + tempo */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border-subtle relative z-10">
        <div className="flex items-center gap-1 text-ink-4 min-w-0">
          <IconUser />
          <span className="font-sans text-xs truncate">{card.agentName ?? 'Sem agente'}</span>
        </div>
        <span className="font-sans text-xs text-ink-4 shrink-0">
          {formatRelativeTime(card.updatedAt)}
        </span>
      </div>

      {/* Nota mais recente (se houver) */}
      {card.lastNote && (
        <p className="font-sans text-xs text-ink-3 line-clamp-2 leading-relaxed relative z-10">
          {card.lastNote}
        </p>
      )}
    </div>
  );
}

// ── Overlay (clone durante drag) ──────────────────────────────────────────────

interface KanbanCardOverlayProps {
  card: KanbanCardType;
}

/**
 * Versão simplificada do card usada como DragOverlay.
 * Elev-4, scale 1.02 — estado "carregando no ar".
 */
export function KanbanCardOverlay({ card }: KanbanCardOverlayProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'rounded-md border border-border-strong',
        'bg-[var(--bg-elev-1)]',
        'p-3 flex flex-col gap-2',
        'opacity-95 scale-[1.02]',
        'cursor-grabbing select-none',
        'min-w-[220px]',
      )}
      style={{ boxShadow: 'var(--elev-4)' }}
    >
      <p
        className="font-display font-bold text-ink leading-tight"
        style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.028em' }}
      >
        {card.leadName}
      </p>
      <span className="font-mono text-xs text-ink-3">{card.phoneMasked}</span>
    </div>
  );
}
