// =============================================================================
// bubbles/SystemBubble.tsx — Mensagem de sistema (centralizada, sem bolha).
//
// Usada para eventos como "conversa iniciada", "atendente alterado", etc.
// Tipografia mais leve, centralizada, sem fundo de bolha.
// =============================================================================

import * as React from 'react';

import type { Message } from '../../../types';
import { formatBubbleTime } from '../utils';

interface SystemBubbleProps {
  message: Message;
}

export function SystemBubble({ message }: SystemBubbleProps): React.JSX.Element {
  return (
    <div className="self-center max-w-[60%] flex flex-col items-center gap-0.5 my-1">
      <div className="flex items-center gap-2">
        {/* Separador decorativo */}
        <div className="h-px w-8 bg-border-subtle" />
        <p className="font-sans text-xs text-ink-3 text-center">
          {message.content ?? 'Evento do sistema'}
        </p>
        <div className="h-px w-8 bg-border-subtle" />
      </div>
      <time
        dateTime={message.createdAt}
        className="font-sans text-xs text-ink-4 tabular-nums"
        title={new Date(message.createdAt).toLocaleString('pt-BR')}
      >
        {formatBubbleTime(message.createdAt)}
      </time>
    </div>
  );
}
