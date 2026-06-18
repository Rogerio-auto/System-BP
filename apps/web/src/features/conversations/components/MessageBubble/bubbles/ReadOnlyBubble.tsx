// =============================================================================
// bubbles/ReadOnlyBubble.tsx — Bolha genérica read-only para tipos
// story_mention, story_reply, comment, comment_reply, ig_postback, referral, share.
//
// Não permite resposta. Exibe o tipo com ícone + conteúdo se disponível.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message, MessageType } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface ReadOnlyBubbleProps {
  message: Message;
  isOutbound: boolean;
}

type ReadOnlyType = Extract<
  MessageType,
  | 'story_mention'
  | 'story_reply'
  | 'comment'
  | 'comment_reply'
  | 'ig_postback'
  | 'referral'
  | 'share'
  | 'reaction'
>;

const typeLabel: Partial<Record<MessageType, string>> = {
  story_mention: 'Menção em story',
  story_reply: 'Resposta a story',
  comment: 'Comentário',
  comment_reply: 'Resposta a comentário',
  ig_postback: 'Postback Instagram',
  referral: 'Referência',
  share: 'Compartilhamento',
  reaction: 'Reação',
};

function TypeIcon({ type }: { type: ReadOnlyType }): React.JSX.Element {
  switch (type) {
    case 'story_mention':
    case 'story_reply':
      return (
        <svg
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="M7 4v4l2 2" strokeLinecap="round" />
        </svg>
      );
    case 'comment':
    case 'comment_reply':
      return (
        <svg
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5"
        >
          <path d="M2 2h10a1 1 0 011 1v6a1 1 0 01-1 1H5l-3 3V3a1 1 0 011-1z" />
        </svg>
      );
    case 'reaction':
      return (
        <svg
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="M5 8s.8 1.5 2 1.5S9 8 9 8" strokeLinecap="round" />
          <circle cx="5.5" cy="6" r=".5" fill="currentColor" stroke="none" />
          <circle cx="8.5" cy="6" r=".5" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return (
        <svg
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="M7 5v2.5l1.5 1.5" strokeLinecap="round" />
        </svg>
      );
  }
}

export function ReadOnlyBubble({ message, isOutbound }: ReadOnlyBubbleProps): React.JSX.Element {
  const label = typeLabel[message.type] ?? message.type;

  return (
    <div
      className={cn(
        'relative max-w-[min(75%,40rem)] rounded-md px-3 py-2',
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
      {/* Badge do tipo */}
      <div className="flex items-center gap-1.5 mb-1 text-ink-3">
        <TypeIcon type={message.type as ReadOnlyType} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        <span className="text-xs text-ink-4">(somente leitura)</span>
      </div>

      {/* Conteúdo se disponível */}
      {message.content && (
        <p className="text-ink whitespace-pre-wrap break-words leading-relaxed">
          {message.content}
        </p>
      )}

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
