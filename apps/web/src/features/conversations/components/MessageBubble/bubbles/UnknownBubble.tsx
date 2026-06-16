// =============================================================================
// bubbles/UnknownBubble.tsx — Fallback para tipos de mensagem não reconhecidos.
//
// Exibe o tipo em cinza sem quebrar a UI. Graceful degradation.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message } from '../../../types';
import { formatBubbleTime } from '../utils';

interface UnknownBubbleProps {
  message: Message;
  isOutbound: boolean;
}

export function UnknownBubble({ message, isOutbound }: UnknownBubbleProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'relative max-w-[75%] rounded-md px-3 py-2',
        'font-sans text-xs [box-shadow:var(--elev-1)]',
        'bg-surface-2 border border-border-subtle',
        isOutbound ? 'self-end rounded-br-xs' : 'self-start rounded-bl-xs',
      )}
    >
      <div className="flex items-center gap-1.5 text-ink-3">
        <svg
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5 shrink-0"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="M7 6v.5M7 9v.5" strokeLinecap="round" strokeWidth={2} />
        </svg>
        <span>
          Tipo não suportado: <code className="font-mono">{message.type}</code>
        </span>
      </div>
      {message.content && <p className="text-ink-3 mt-1 break-words">{message.content}</p>}
      <time
        dateTime={message.createdAt}
        className="block mt-1 text-ink-4 tabular-nums"
        title={new Date(message.createdAt).toLocaleString('pt-BR')}
      >
        {formatBubbleTime(message.createdAt)}
      </time>
    </div>
  );
}
