// =============================================================================
// features/assistant/components/AssistantWorkspaceHeader.tsx — Cabeçalho do
// workspace fullscreen do copiloto interno (F6-S12): ícone + título + botão
// de fechar (X). Extraído de AssistantWorkspaceModal para manter o
// componente principal abaixo de 200 linhas.
//
// `conversationTitle` (F6-S28): quando o workspace abre uma conversa salva do
// histórico, o título dela substitui o subtítulo padrão — sinaliza ao
// usuário que ele está vendo uma conversa anterior, não uma nova.
//
// `onOpenHistoryMobile` (F6-S29): em telas estreitas (< sm) a barra lateral
// de histórico fica atrás de um overlay — este botão (visível só em mobile)
// a abre. Em telas maiores a barra já é persistente, então o botão some.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

import { SparkleIcon } from './SparkleIcon';

interface AssistantWorkspaceHeaderProps {
  onClose: () => void;
  /** Título da conversa salva aberta (F6-S28) — ausente em uma conversa nova. */
  conversationTitle?: string | undefined;
  /** Abre a barra lateral de histórico em telas estreitas (F6-S29). */
  onOpenHistoryMobile?: () => void;
}

function HistoryIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M2 8a6 6 0 1 0 1.8-4.3M2 2.5v3.2h3.2" />
      <path d="M8 5v3.2l2.2 1.3" />
    </svg>
  );
}

export function AssistantWorkspaceHeader({
  onClose,
  conversationTitle,
  onOpenHistoryMobile,
}: AssistantWorkspaceHeaderProps): React.JSX.Element {
  return (
    <div
      className="flex items-center justify-between px-6 py-4 border-b shrink-0"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elev-2)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {onOpenHistoryMobile && (
          <button
            type="button"
            onClick={onOpenHistoryMobile}
            aria-label="Abrir histórico de conversas"
            className={cn(
              'sm:hidden w-9 h-9 flex items-center justify-center rounded-sm shrink-0',
              'text-ink-3 hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            <HistoryIcon />
          </button>
        )}
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
          <p className="font-sans text-xs text-ink-3 truncate">
            {conversationTitle?.trim() ? conversationTitle : 'Copiloto sobre seus dados'}
          </p>
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
