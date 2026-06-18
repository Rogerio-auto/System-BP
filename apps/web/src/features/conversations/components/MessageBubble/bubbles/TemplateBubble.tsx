// =============================================================================
// bubbles/TemplateBubble.tsx — Bolha de mensagem de template WhatsApp.
//
// Exibe o nome do template + corpo renderizado (metadata.template_name / content).
// Read-only — o usuário não pode responder via template no painel.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface TemplateBubbleProps {
  message: Message;
  isOutbound: boolean;
}

function extractTemplateName(message: Message): string | null {
  const meta = message.metadata;
  if (typeof meta === 'object' && meta !== null && 'template_name' in meta) {
    const name = (meta as { template_name?: unknown }).template_name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

export function TemplateBubble({ message, isOutbound }: TemplateBubbleProps): React.JSX.Element {
  const templateName = extractTemplateName(message);

  return (
    <div
      className={cn(
        'relative max-w-full rounded-md overflow-hidden',
        'font-sans text-sm [box-shadow:var(--elev-1)]',
        isOutbound
          ? [
              'self-end',
              'bg-[color-mix(in_srgb,var(--brand-azul)_12%,var(--bg-elev-1))]',
              'border border-[color-mix(in_srgb,var(--brand-azul)_20%,transparent)]',
              'rounded-br-xs',
            ]
          : ['self-start', 'bg-surface-2 border border-border-subtle', 'rounded-bl-xs'],
      )}
    >
      {/* Cabeçalho: badge de template */}
      <div
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 border-b',
          isOutbound
            ? 'border-[color-mix(in_srgb,var(--brand-azul)_20%,transparent)]'
            : 'border-border-subtle',
        )}
      >
        {/* Ícone de template */}
        <svg
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5 text-ink-3 shrink-0"
        >
          <rect x="1" y="1" width="12" height="12" rx="2" />
          <path d="M4 4h6M4 7h4M4 10h3" strokeLinecap="round" />
        </svg>
        <span className="text-xs font-medium text-ink-3 uppercase tracking-wide">Template</span>
        {templateName && (
          <span className="text-xs text-ink-3 truncate max-w-[140px]">· {templateName}</span>
        )}
      </div>

      {/* Corpo do template */}
      <div className="px-3 pt-2">
        {message.content ? (
          <p className="text-ink whitespace-pre-wrap break-words leading-relaxed">
            {message.content}
          </p>
        ) : (
          <p className="text-ink-3 italic text-xs">Corpo não disponível</p>
        )}
      </div>

      {/* Footer: timestamp + status */}
      <div
        className={cn(
          'flex items-center gap-1 px-3 pb-2 pt-1',
          isOutbound ? 'justify-end' : 'justify-start',
        )}
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
