// =============================================================================
// features/assistant/components/AssistantConversationUnavailableState.tsx —
// Estado exibido quando a conversa salva não pôde ser aberta (404: removida,
// de outro usuário, ou inexistente — o backend nunca distingue os três
// casos, de propósito, para não vazar a existência do recurso — F6-S28).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';
import { InboxOffIcon } from '../blocks/icons';

interface AssistantConversationUnavailableStateProps {
  onClose: () => void;
}

export function AssistantConversationUnavailableState({
  onClose,
}: AssistantConversationUnavailableStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
      <span
        className="inline-flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-3)',
          background: 'var(--bg-elev-2)',
          boxShadow: 'var(--elev-2)',
        }}
      >
        <InboxOffIcon className="w-6 h-6" />
      </span>
      <div className="max-w-[360px]">
        <h3 className="font-display font-bold text-ink text-xl tracking-tight">
          Conversa indisponível
        </h3>
        <p className="mt-2 font-sans text-sm text-ink-3 leading-relaxed">
          Esta conversa não foi encontrada — pode ter sido removida ou você não tem mais acesso a
          ela.
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className={cn(
          'font-sans text-sm font-semibold rounded-sm px-4 py-2',
          'transition-all duration-fast ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        )}
        style={{
          color: 'var(--brand-azul)',
          background: 'color-mix(in srgb, var(--brand-azul) 10%, transparent)',
        }}
      >
        Fechar assistente
      </button>
    </div>
  );
}
