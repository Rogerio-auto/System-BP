// =============================================================================
// bubbles/TextBubble.tsx — Bolha de mensagem de texto simples.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface TextBubbleProps {
  message: Message;
  isOutbound: boolean;
}

export function TextBubble({ message, isOutbound }: TextBubbleProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'relative rounded-md px-3 py-2 max-w-[min(75%,40rem)]',
        'font-sans text-sm leading-relaxed',
        isOutbound
          ? [
              // Outbound: azul suave (color-mix não tem suporte universal, usa azul-light/10)
              'self-end',
              'bg-[color-mix(in_srgb,var(--brand-azul)_12%,var(--bg-elev-1))]',
              'text-ink',
              'border border-[color-mix(in_srgb,var(--brand-azul)_20%,transparent)]',
              '[box-shadow:var(--elev-1)]',
              'rounded-br-xs',
            ]
          : [
              // Inbound: surface-subtle
              'self-start',
              'bg-surface-2',
              'text-ink border border-border-subtle',
              '[box-shadow:var(--elev-1)]',
              'rounded-bl-xs',
            ],
      )}
    >
      {/* Conteúdo — whitespace-pre-wrap preserva quebras de linha */}
      <p className="whitespace-pre-wrap break-words">{message.content}</p>

      {/* Rodapé: timestamp + status */}
      <div
        className={cn('flex items-center gap-1 mt-1', isOutbound ? 'justify-end' : 'justify-start')}
      >
        <time
          dateTime={message.createdAt}
          className="font-sans text-xs text-ink-3 tabular-nums"
          title={new Date(message.createdAt).toLocaleString('pt-BR')}
        >
          {formatBubbleTime(message.createdAt)}
        </time>
        {isOutbound && message.viewStatus && <StatusIcon status={message.viewStatus} size={12} />}
      </div>
    </div>
  );
}
