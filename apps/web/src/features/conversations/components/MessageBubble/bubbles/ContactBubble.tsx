// =============================================================================
// bubbles/ContactBubble.tsx — Bolha de contato compartilhado via WhatsApp.
//
// Exibe nome do contato e, se disponível, telefone (mascarado por LGPD).
// metadata.contact_name / metadata.contact_phone se presentes.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface ContactBubbleProps {
  message: Message;
  isOutbound: boolean;
}

interface ContactMeta {
  contact_name?: string | undefined;
  contact_phone?: string | undefined;
}

function extractContact(msg: Message): ContactMeta {
  const meta = msg.metadata as ContactMeta | null;
  return {
    contact_name: meta?.contact_name ?? undefined,
    contact_phone: meta?.contact_phone ?? undefined,
  };
}

export function ContactBubble({ message, isOutbound }: ContactBubbleProps): React.JSX.Element {
  const contact = extractContact(message);
  const displayName = contact.contact_name ?? message.content ?? 'Contato';

  return (
    <div
      className={cn(
        'relative max-w-[75%] rounded-md px-3 py-2',
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
      <div className="flex items-center gap-3">
        {/* Avatar do contato */}
        <div
          className="w-9 h-9 rounded-pill flex items-center justify-center shrink-0 text-white font-semibold text-sm"
          style={{ background: 'var(--grad-azul)' }}
          aria-hidden="true"
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{displayName}</p>
          {/* LGPD: telefone mascarado */}
          {contact.contact_phone && (
            <p className="font-mono text-xs text-ink-3 mt-0.5">
              {contact.contact_phone.replace(/(\d{2})(\d+)(\d{2})/, '$1 ···· $3')}
            </p>
          )}
        </div>
      </div>

      <div
        className={cn('flex items-center gap-1 mt-2', isOutbound ? 'justify-end' : 'justify-start')}
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
