// =============================================================================
// features/configuracoes/ai-console/prompts/ActivateModal.tsx
//
// Modal de ativação de versão de prompt:
//   - Mostra diff entre versão ativa atual e versão a ser ativada
//   - Aviso explícito "substitui imediatamente em produção"
//   - Checkbox de confirmação obrigatório
//   - Botão "Ativar" desabilitado até checkbox marcado
//   - elev-5 (modal — DS §7)
//   - Overlay com backdrop blur
//
// LGPD: body do prompt nunca vai para console/log.
// =============================================================================

import * as React from 'react';

import { Button } from '../../../../components/ui/Button';
import { type PromptVersion } from '../../../../hooks/ai-console/usePrompts';
import { cn } from '../../../../lib/cn';

import { PromptDiffView } from './PromptDiffView';

// ─── Subcomponente: overlay ────────────────────────────────────────────────────

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

// ─── Componente principal ─────────────────────────────────────────────────────

interface ActivateModalProps {
  /** Versão que será ativada */
  targetVersion: PromptVersion;
  /** Versão atualmente ativa (null se nenhuma) */
  currentActiveVersion: PromptVersion | null;
  /** Chamado ao confirmar ativação */
  onConfirm: () => void;
  /** Chamado ao cancelar */
  onClose: () => void;
  /** true enquanto a mutation está em progresso */
  isPending: boolean;
  /** Erro da mutation (se houver) */
  error: Error | null;
}

/**
 * Modal de ativação de versão de prompt.
 * DS §7: elev-5, radius-lg, backdrop blur.
 * Exibe diff entre versão ativa atual e versão alvo.
 */
export function ActivateModal({
  targetVersion,
  currentActiveVersion,
  onConfirm,
  onClose,
  isPending,
  error,
}: ActivateModalProps): React.JSX.Element {
  const [confirmed, setConfirmed] = React.useState(false);

  // Fechar com Escape
  React.useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isPending) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPending, onClose]);

  // Foco no modal ao montar (acessibilidade)
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
                /* bloqueado durante ativação */
              }
            : onClose
        }
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="activate-modal-title"
        aria-describedby="activate-modal-desc"
        tabIndex={-1}
        className={cn(
          'fixed z-50 inset-4 md:inset-auto',
          'md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2',
          'md:w-[min(860px,90vw)] md:max-h-[85vh]',
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
          <div className="flex flex-col gap-1">
            <h2
              id="activate-modal-title"
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
            >
              Ativar versão {targetVersion.version}
            </h2>
            <p className="font-mono text-xs text-ink-3">{targetVersion.key}</p>
          </div>
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

        {/* ── Aviso de produção ───────────────────────────────────────── */}
        <div
          className="flex items-start gap-3 mx-5 mt-4 p-3 rounded-md border"
          style={{
            background: 'var(--warning-bg)',
            borderColor: 'var(--brand-amarelo)',
          }}
          role="alert"
        >
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-5 h-5 shrink-0 mt-0.5 text-[var(--warning)]"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <p
            id="activate-modal-desc"
            className="font-sans text-sm text-ink"
            style={{ lineHeight: 1.5 }}
          >
            <strong className="font-semibold">
              Esta ação substitui imediatamente a versão ativa em produção.
            </strong>{' '}
            O agente de IA começará a usar o novo prompt no próximo processamento.
            {currentActiveVersion
              ? ` A versão ${currentActiveVersion.version} atual será substituída.`
              : ' Não há versão ativa no momento.'}
          </p>
        </div>

        {/* ── Diff ──────────────────────────────────────────────────── */}
        <div
          className="flex-1 min-h-0 overflow-hidden mx-5 mt-4 rounded-md border border-border"
          style={{ boxShadow: 'var(--elev-1)' }}
        >
          {currentActiveVersion ? (
            <PromptDiffView from={currentActiveVersion} to={targetVersion} className="h-full" />
          ) : (
            <div className="flex flex-col gap-2 p-6 h-full">
              <p className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3">
                Nova versão (sem base de comparação)
              </p>
              <pre className="font-mono text-xs text-ink leading-relaxed overflow-y-auto whitespace-pre-wrap break-all">
                {targetVersion.body}
              </pre>
            </div>
          )}
        </div>

        {/* ── Checkbox de confirmação ──────────────────────────────── */}
        <div className="flex items-start gap-3 mx-5 mt-4">
          <input
            id="confirm-activate"
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={isPending}
            className="mt-0.5 w-4 h-4 rounded-sm cursor-pointer accent-azul disabled:cursor-not-allowed"
            aria-describedby="confirm-activate-label"
          />
          <label
            id="confirm-activate-label"
            htmlFor="confirm-activate"
            className="font-sans text-sm text-ink leading-snug cursor-pointer select-none"
          >
            Entendo que esta ação substituirá a versão ativa em produção imediatamente e não pode
            ser desfeita automaticamente.
          </label>
        </div>

        {/* ── Error ────────────────────────────────────────────────── */}
        {error && (
          <div
            className="mx-5 mt-3 px-3 py-2 rounded-md bg-danger-bg border border-danger/30"
            role="alert"
          >
            <p className="font-sans text-xs text-danger">
              {error.message ?? 'Erro ao ativar versão. Tente novamente.'}
            </p>
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-border shrink-0 mt-4">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={!confirmed || isPending}
          >
            {isPending ? 'Ativando...' : `Ativar v${targetVersion.version}`}
          </Button>
        </div>
      </div>
    </>
  );
}
