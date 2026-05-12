// =============================================================================
// components/kanban/KanbanDetailModal.tsx — Modal de detalhe do card Kanban.
//
// DS: overlay --overlay-1, content --elev-5, border-radius --radius-lg.
// LGPD: exibe apenas phoneMasked (nunca CPF, nunca telefone completo).
// Histórico: via useKanbanHistory — lazy load quando modal abre.
// Fecha em Escape, click no overlay, botão X.
// =============================================================================

import * as React from 'react';

import type { KanbanCard } from '../../hooks/kanban/types';
import { useKanbanHistory } from '../../hooks/kanban/useKanbanHistory';
import { cn } from '../../lib/cn';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface KanbanDetailModalProps {
  card: KanbanCard | null;
  stageName: string;
  onClose: () => void;
}

// ── Formatadores ──────────────────────────────────────────────────────────────

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDateTime(dateStr: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr));
}

// ── Ícones ────────────────────────────────────────────────────────────────────

function IconClose(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconHistory(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="12 8 12 12 14 14" />
      <path d="M3.05 11a9 9 0 1 0 .5-4" />
      <polyline points="3 3 3 7 7 7" />
    </svg>
  );
}

// ── Seção de histórico ────────────────────────────────────────────────────────

interface HistorySectionProps {
  cardId: string;
}

function HistorySection({ cardId }: HistorySectionProps): React.JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  const { history, isLoading } = useKanbanHistory(expanded ? cardId : null);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        className={cn(
          'flex items-center gap-2 font-sans text-xs font-semibold text-azul',
          'hover:text-azul-deep transition-colors duration-fast',
          'focus-visible:ring-2 focus-visible:ring-azul/30 rounded-xs',
          '-ml-1 px-1 py-0.5',
        )}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <IconHistory />
        {expanded ? 'Ocultar histórico' : 'Histórico completo'}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className={cn('transition-transform duration-fast', expanded && 'rotate-180')}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="flex flex-col gap-0">
          {isLoading ? (
            <div className="flex flex-col gap-2 py-2">
              {[1, 2].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-2 h-2 rounded-full bg-surface-muted mt-1.5 shrink-0" />
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="h-3 bg-surface-muted rounded-xs w-1/2" />
                    <div className="h-3 bg-surface-muted rounded-xs w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="font-sans text-xs text-ink-4 py-2">Nenhum histórico disponível.</p>
          ) : (
            <ol className="flex flex-col gap-0 relative">
              {/* Timeline line */}
              <span
                aria-hidden="true"
                className="absolute left-[7px] top-2 bottom-2 w-px bg-border-subtle"
              />
              {history.map((entry, idx) => (
                <li key={entry.id} className="flex gap-3 pb-4 last:pb-0 relative">
                  {/* Dot */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-1.5 w-[15px] h-[15px] rounded-full shrink-0 z-10',
                      'flex items-center justify-center',
                      idx === 0
                        ? 'bg-azul shadow-[0_0_0_2px_var(--bg-elev-1),0_0_0_3px_var(--brand-azul)]'
                        : 'bg-surface-muted border border-border',
                    )}
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <p className="font-sans text-xs font-semibold text-ink leading-snug">
                      {entry.fromStageName ? (
                        <>
                          <span className="text-ink-3">{entry.fromStageName}</span>
                          {' → '}
                          <span className="text-ink">{entry.toStageName}</span>
                        </>
                      ) : (
                        <span className="text-ink">{entry.toStageName}</span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 text-ink-4">
                      <span className="font-sans text-xs">{entry.actorName}</span>
                      <span aria-hidden="true">·</span>
                      <time
                        className="font-mono text-xs"
                        dateTime={entry.createdAt}
                        style={{ letterSpacing: '-0.01em' }}
                      >
                        {formatDateTime(entry.createdAt)}
                      </time>
                    </div>
                    {entry.note && (
                      <p className="font-sans text-xs text-ink-2 leading-relaxed mt-0.5">
                        {entry.note}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────────

/**
 * Modal de detalhe do card Kanban.
 * DS: overlay rgba(0,0,0,0.5), content elev-5, border-radius lg.
 * Fecha em Escape, click no overlay, botão X.
 * Focus trapped via tabIndex=-1 no container.
 */
export function KanbanDetailModal({
  card,
  stageName,
  onClose,
}: KanbanDetailModalProps): React.JSX.Element | null {
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Fecha no Escape
  React.useEffect(() => {
    if (!card) return;

    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [card, onClose]);

  // Focus trap inicial
  React.useEffect(() => {
    if (card) {
      contentRef.current?.focus();
    }
  }, [card]);

  // Lock body scroll
  React.useEffect(() => {
    if (card) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [card]);

  if (!card) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 150, background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="kanban-modal-title"
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-lg max-h-[90vh]',
          'flex flex-col',
          'rounded-lg border border-border',
          'bg-[var(--bg-elev-1)]',
          'overflow-hidden',
          'focus:outline-none',
          'animation-fade-up',
        )}
        style={{
          boxShadow: 'var(--elev-5)',
          animation: 'fade-up var(--dur-slow) var(--ease-out)',
        }}
      >
        {/* ── Header ────────────────────────────────────────────── */}
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border bg-[var(--bg-elev-2)]"
          style={{ boxShadow: 'var(--elev-1)' }}
        >
          <div className="flex flex-col gap-1 min-w-0">
            <h2
              id="kanban-modal-title"
              className="font-display font-bold text-ink leading-tight truncate"
              style={{
                fontSize: 'var(--text-xl)',
                letterSpacing: '-0.028em',
                fontVariationSettings: "'opsz' 20",
              }}
            >
              {card.leadName}
            </h2>
            {/* Badge de etapa */}
            <span
              className={cn(
                'inline-flex items-center gap-1 self-start',
                'font-sans font-bold uppercase tracking-wider',
                'px-2 py-0.5 rounded-pill',
                'bg-[var(--info-bg)] text-info',
              )}
              style={{
                fontSize: '0.65rem',
                boxShadow: 'var(--elev-1)',
              }}
            >
              <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-info inline-block" />
              {stageName}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar modal"
            className={cn(
              'shrink-0 text-ink-3 hover:text-ink',
              'transition-colors duration-fast',
              'rounded-md p-1.5',
              'hover:bg-surface-hover',
              'focus-visible:ring-2 focus-visible:ring-azul/30',
              'min-w-[40px] min-h-[40px] flex items-center justify-center',
            )}
          >
            <IconClose />
          </button>
        </div>

        {/* ── Corpo scrollável ────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* Informações do lead */}
          <div className="flex flex-col gap-3">
            <h3
              className="font-sans font-bold text-ink-3 uppercase tracking-wider"
              style={{ fontSize: 'var(--text-xs)' }}
            >
              Informações
            </h3>

            <dl className="flex flex-col gap-2">
              {/* Telefone — LGPD: mascarado */}
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-xs text-ink-4 w-24 shrink-0">Telefone</dt>
                <dd className="font-mono text-sm text-ink" style={{ letterSpacing: '-0.01em' }}>
                  {card.phoneMasked}
                </dd>
              </div>

              {/* Valor do empréstimo */}
              {card.loanAmountCents !== null && (
                <div className="flex items-baseline gap-2">
                  <dt className="font-sans text-xs text-ink-4 w-24 shrink-0">Valor</dt>
                  <dd
                    className="font-mono font-semibold text-sm text-azul"
                    style={{ letterSpacing: '-0.01em' }}
                  >
                    {formatCurrency(card.loanAmountCents)}
                  </dd>
                </div>
              )}

              {/* Agente */}
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-xs text-ink-4 w-24 shrink-0">Agente</dt>
                <dd className="font-sans text-sm text-ink">
                  {card.agentName ?? <span className="text-ink-4 italic">Não atribuído</span>}
                </dd>
              </div>

              {/* Última atualização */}
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-xs text-ink-4 w-24 shrink-0">Atualizado</dt>
                <dd className="font-mono text-xs text-ink-3" style={{ letterSpacing: '-0.01em' }}>
                  {formatDateTime(card.updatedAt)}
                </dd>
              </div>
            </dl>
          </div>

          {/* Último comentário */}
          {card.lastNote && (
            <div
              className="flex flex-col gap-2 p-3 rounded-sm border-l-2 border-azul"
              style={{ background: 'var(--info-bg)' }}
            >
              <p
                className="font-sans font-bold text-ink-3 uppercase tracking-wider"
                style={{ fontSize: 'var(--text-xs)' }}
              >
                Último comentário
              </p>
              <p className="font-sans text-sm text-ink-2 leading-relaxed">{card.lastNote}</p>
            </div>
          )}

          {/* Divider */}
          <hr className="border-border-subtle" />

          {/* Histórico */}
          <HistorySection cardId={card.id} />
        </div>
      </div>
    </div>
  );
}
