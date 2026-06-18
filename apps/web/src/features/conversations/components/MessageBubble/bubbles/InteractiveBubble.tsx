// =============================================================================
// bubbles/InteractiveBubble.tsx — Bolha de mensagem interativa (botões/lista).
//
// WhatsApp interactive messages: button_reply, list_reply, etc.
// Exibição read-only no painel — o cliente interagiu e a resposta é registrada.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface InteractiveBubbleProps {
  message: Message;
  isOutbound: boolean;
}

interface InteractivePayload {
  type?: string;
  body?: { text?: string };
  header?: { text?: string };
  footer?: { text?: string };
  action?: {
    buttons?: Array<{ reply?: { id?: string; title?: string } }>;
    sections?: Array<{
      title?: string;
      rows?: Array<{ id?: string; title?: string; description?: string }>;
    }>;
    button?: string;
  };
  button_reply?: { id?: string; title?: string };
  list_reply?: { id?: string; title?: string; description?: string };
}

function parseInteractive(payload: Record<string, unknown> | null): InteractivePayload {
  if (!payload) return {};
  return payload as InteractivePayload;
}

export function InteractiveBubble({
  message,
  isOutbound,
}: InteractiveBubbleProps): React.JSX.Element {
  const interactive = parseInteractive(message.interactivePayload);
  const bodyText = interactive.body?.text ?? message.content;
  const headerText = interactive.header?.text;
  const footerText = interactive.footer?.text;
  const buttons = interactive.action?.buttons ?? [];
  const buttonReply = interactive.button_reply;
  const listReply = interactive.list_reply;

  return (
    <div
      className={cn(
        'relative max-w-[min(75%,40rem)] rounded-md overflow-hidden',
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
      {/* Se é resposta de botão ou lista */}
      {(buttonReply ?? listReply) ? (
        <div className="px-3 pt-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <svg
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-3.5 h-3.5 text-azul shrink-0"
            >
              <path d="M1 4h12M1 7h8M1 10h5" strokeLinecap="round" />
            </svg>
            <span className="text-xs text-ink-3">Resposta interativa</span>
          </div>
          <p className="text-ink font-medium">{buttonReply?.title ?? listReply?.title ?? '—'}</p>
          {listReply?.description && (
            <p className="text-xs text-ink-3 mt-0.5">{listReply.description}</p>
          )}
        </div>
      ) : (
        <div className="px-3 pt-3">
          {/* Header */}
          {headerText && <p className="font-semibold text-ink mb-1">{headerText}</p>}
          {/* Body */}
          {bodyText && (
            <p className="text-ink whitespace-pre-wrap break-words leading-relaxed">{bodyText}</p>
          )}
          {/* Footer */}
          {footerText && <p className="text-xs text-ink-3 mt-1 italic">{footerText}</p>}
          {/* Botões (read-only) */}
          {buttons.length > 0 && (
            <div className="flex flex-col gap-1 mt-2 mb-1">
              {buttons.map((btn, i) => (
                <div
                  key={btn.reply?.id ?? i}
                  className={cn(
                    'flex items-center justify-center px-3 py-1.5 rounded-sm',
                    'text-xs font-medium text-azul',
                    'border border-[color-mix(in_srgb,var(--brand-azul)_25%,transparent)]',
                    'opacity-60 cursor-not-allowed select-none',
                  )}
                >
                  {btn.reply?.title ?? 'Botão'}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
