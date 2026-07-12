// =============================================================================
// features/assistant/components/AssistantWorkspaceHeader.tsx — Cabeçalho do
// workspace fullscreen do copiloto interno (F6-S12): ícone + título + botão
// de fechar (X). Extraído de AssistantWorkspaceModal para manter o
// componente principal abaixo de 200 linhas.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

import { SparkleIcon } from './SparkleIcon';

interface AssistantWorkspaceHeaderProps {
  onClose: () => void;
}

export function AssistantWorkspaceHeader({
  onClose,
}: AssistantWorkspaceHeaderProps): React.JSX.Element {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 border-b shrink-0"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elev-2)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-flex items-center justify-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: 'var(--radius-sm)',
            color: 'var(--brand-azul)',
            background: 'color-mix(in srgb, var(--brand-azul) 12%, transparent)',
          }}
        >
          <SparkleIcon className="w-[18px] h-[18px]" />
        </span>
        <div className="min-w-0">
          <h2 className="font-sans font-semibold text-ink text-base leading-tight truncate">
            Assistente interno
          </h2>
          <p className="font-sans text-xs text-ink-3">Copiloto sobre seus dados</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar assistente"
        className={cn(
          'w-9 h-9 flex items-center justify-center rounded-sm shrink-0',
          'text-ink-3 hover:text-ink hover:bg-surface-hover',
          'transition-all duration-fast ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        )}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
