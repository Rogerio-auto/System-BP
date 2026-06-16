// =============================================================================
// bubbles/StickerBubble.tsx — Bolha de sticker (figurinha WhatsApp).
// Exibe preview da imagem sem borda/fundo (stickers são transparentes).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface StickerBubbleProps {
  message: Message;
  isOutbound: boolean;
}

export function StickerBubble({ message, isOutbound }: StickerBubbleProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col max-w-[160px]',
        isOutbound ? 'self-end items-end' : 'self-start items-start',
      )}
    >
      {message.mediaUrl ? (
        <img
          src={message.mediaUrl}
          alt="Sticker"
          loading="lazy"
          className="w-32 h-32 object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div className="w-32 h-32 flex items-center justify-center bg-surface-2 rounded-md border border-border-subtle text-ink-3 text-xs">
          Sticker
        </div>
      )}
      <div className="flex items-center gap-1 mt-0.5">
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
