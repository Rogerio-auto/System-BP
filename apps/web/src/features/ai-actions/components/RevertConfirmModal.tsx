// =============================================================================
// features/ai-actions/components/RevertConfirmModal.tsx
//
// Modal de confirmação antes de reverter uma ação autônoma da IA.
// Padrão espelhado em ActivateModal.tsx (ai-console/prompts) — mesma DS:
//   - elev-5, radius-lg, overlay com backdrop blur
//   - Fecha com Escape (bloqueado durante a mutation)
//   - Foco no diálogo ao montar (acessibilidade)
// =============================================================================

import * as React from 'react';

import { Button } from '../../../components/ui/Button';
import { type AiActionItem } from '../../../hooks/ai-actions/useAiActions';
import { cn } from '../../../lib/cn';

import { actionLabel, formatOccurredAt } from './AiActionRow';

function ModalOverlay({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-40"
      style={{ background: 'rgba(10,18,40,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
      aria-hidden="true"
    />
  );
}

interface RevertConfirmModalProps {
  item: AiActionItem;
  onConfirm: () => void;
  onClose: () => void;
  isPending: boolean;
  error: Error | null;
}

export function RevertConfirmModal({
  item,
  onConfirm,
  onClose,
  isPending,
  error,
}: RevertConfirmModalProps): React.JSX.Element {
  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPending, onClose]);

  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <>
      <ModalOverlay
        onClose={
          isPending
            ? () => {
                /* bloqueado durante a reversão */
              }
            : onClose
        }
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revert-modal-title"
        aria-describedby="revert-modal-desc"
        tabIndex={-1}
        className={cn(
          'fixed z-50 inset-4 md:inset-auto',
          'md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2',
          'md:w-[min(480px,90vw)]',
          'flex flex-col rounded-lg border border-border',
          'focus:outline-none',
        )}
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between p-5 border-b border-border shrink-0">
          <h2
            id="revert-modal-title"
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
          >
            Reverter ação da IA?
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-md shrink-0',
              'text-ink-3 hover:text-ink hover:bg-surface-hover',
              'transition-colors duration-fast',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
            aria-label="Fechar modal"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* ── Corpo ─────────────────────────────────────────────────── */}
        <div className="p-5 flex flex-col gap-4">
          <p
            id="revert-modal-desc"
            className="font-sans text-sm text-ink"
            style={{ lineHeight: 1.5 }}
          >
            O lead <strong className="font-semibold">{item.lead_name_masked ?? 'sem nome'}</strong>{' '}
            voltará a um status não-terminal do funil, desfazendo a ação{' '}
            <strong className="font-semibold">{actionLabel(item.action).toLowerCase()}</strong>{' '}
            feita automaticamente pela IA em {formatOccurredAt(item.occurred_at)}.
          </p>

          <div
            className="flex items-start gap-3 p-3 rounded-md border"
            style={{ background: 'var(--info-bg)', borderColor: 'var(--info)' }}
            role="note"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: 'var(--info)' }}
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" />
              <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
            </svg>
            <p className="font-sans text-xs leading-relaxed" style={{ color: 'var(--info)' }}>
              O histórico da ação original é preservado — a reversão é registrada como um novo
              evento de auditoria, não apaga o anterior.
            </p>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-md bg-danger-bg border border-danger/30" role="alert">
              <p className="font-sans text-xs text-danger">
                {error.message || 'Erro ao reverter a ação. Tente novamente.'}
              </p>
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Revertendo...' : 'Reverter ação'}
          </Button>
        </div>
      </div>
    </>
  );
}
