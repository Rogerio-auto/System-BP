// =============================================================================
// MessageComposer/WindowNotice.tsx — Aviso de janela 24h expirada.
//
// Exibido quando composerState.window === 'template_only' | 'closed'.
// DS: fundo warning-bg, ícone de relógio, CTA para usar template.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../lib/cn';
import type { ComposerWindowKind } from '../../types';

interface WindowNoticeProps {
  windowKind: ComposerWindowKind | null;
  /** Callback ao clicar em "Usar template" */
  onUseTemplate?: (() => void) | undefined;
}

const messageByKind: Partial<Record<ComposerWindowKind, string>> = {
  template_only: 'A janela de 24h expirou. Apenas templates aprovados podem ser enviados agora.',
  closed: 'A janela de 24h expirou. Use um template para retomar o contato com o cliente.',
};

/**
 * WindowNotice — aviso visual de janela de conversa expirada.
 *
 * Não bloqueia visualmente o compositor — fica acima do textarea desabilitado
 * para que o atendente entenda o estado sem confusão.
 */
export function WindowNotice({ windowKind, onUseTemplate }: WindowNoticeProps): React.JSX.Element {
  const message =
    (windowKind ? (messageByKind[windowKind] ?? messageByKind.closed) : messageByKind.closed) ??
    'A janela de 24h expirou. Use um template para retomar o contato.';

  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        'border-t border-warning/30',
        'bg-warning-bg',
      )}
    >
      {/* Ícone de relógio */}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-4 h-4 shrink-0 mt-0.5 text-warning"
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3.5l2 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {/* Texto */}
      <div className="flex-1 min-w-0">
        <p className="font-sans text-xs font-medium" style={{ color: 'var(--warning)' }}>
          {message}
        </p>
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={onUseTemplate}
        disabled={!onUseTemplate}
        className={cn(
          'shrink-0 font-sans text-xs font-semibold px-3 py-1.5 rounded-sm',
          'border border-warning/40 text-warning bg-transparent',
          'transition-colors duration-fast ease',
          'hover:bg-warning/10 active:bg-warning/20',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/30',
          'disabled:opacity-40 disabled:cursor-not-allowed',
        )}
        aria-label="Abrir seleção de template"
      >
        Usar template
      </button>
    </div>
  );
}
