// =============================================================================
// MessageBubble/MessageBubble.tsx — Dispatch polimórfico por tipo de mensagem.
//
// Recebe um `Message` e renderiza o sub-componente correto.
// Alinhamento: inbound (esquerda) vs outbound (direita).
//
// Tipos cobertos:
//   text          → TextBubble
//   image/video/audio/voice/document → MediaBubble
//   template      → TemplateBubble
//   interactive   → InteractiveBubble
//   sticker       → StickerBubble
//   location      → LocationBubble
//   contact       → ContactBubble
//   system        → SystemBubble (centralizada, sem bolha)
//   reaction/story_mention/story_reply/comment/comment_reply/ig_postback/referral/share
//               → ReadOnlyBubble
//   fallback      → UnknownBubble
//
// LGPD (doc 17 §8.1): não loga message.content.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../lib/cn';
import type { Message } from '../../types';

import { ContactBubble } from './bubbles/ContactBubble';
import { InteractiveBubble } from './bubbles/InteractiveBubble';
import { LocationBubble } from './bubbles/LocationBubble';
import { MediaBubble } from './bubbles/MediaBubble';
import { ReadOnlyBubble } from './bubbles/ReadOnlyBubble';
import { StickerBubble } from './bubbles/StickerBubble';
import { SystemBubble } from './bubbles/SystemBubble';
import { TemplateBubble } from './bubbles/TemplateBubble';
import { TextBubble } from './bubbles/TextBubble';
import { UnknownBubble } from './bubbles/UnknownBubble';

// ─── Tipos de agrupamento ────────────────────────────────────────────────────

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'voice', 'document'] as const);
const READONLY_TYPES = new Set([
  'story_mention',
  'story_reply',
  'comment',
  'comment_reply',
  'ig_postback',
  'referral',
  'share',
  'reaction',
] as const);

// ─── Componente ──────────────────────────────────────────────────────────────

export interface MessageBubbleProps {
  message: Message;
}

/**
 * MessageBubble — wrapper de alinhamento + dispatch por tipo.
 *
 * O container flex (`items-start` / `items-end`) posiciona a bolha
 * à esquerda (inbound) ou à direita (outbound).
 * A bolha interna (`self-start` / `self-end`) define sua largura máxima.
 */
export function MessageBubble({ message }: MessageBubbleProps): React.JSX.Element {
  const isOutbound = message.direction === 'out';

  // ── Sistema: sem bolha, centralizado ──────────────────────────────────────
  if (message.type === 'system') {
    return (
      <div className="flex justify-center px-4 py-0.5" role="status">
        <SystemBubble message={message} />
      </div>
    );
  }

  return (
    <div
      className={cn('flex w-full px-4 py-0.5', isOutbound ? 'justify-end' : 'justify-start')}
      // Não usar aria-label com conteúdo da mensagem (LGPD)
    >
      {/* Avatar inbound (apenas para inbound, lado esquerdo) */}
      {!isOutbound && (
        <div
          className="w-7 h-7 rounded-pill flex items-center justify-center shrink-0 mr-2 mt-1 text-white text-xs font-semibold"
          style={{ background: 'var(--grad-azul)', boxShadow: 'var(--elev-1)' }}
          aria-hidden="true"
        >
          C
        </div>
      )}

      {/* Bolha */}
      <div className={cn('flex flex-col', isOutbound ? 'items-end' : 'items-start')}>
        {renderBubble(message, isOutbound)}
      </div>
    </div>
  );
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

function renderBubble(message: Message, isOutbound: boolean): React.ReactNode {
  const { type } = message;

  if (type === 'text') {
    return <TextBubble message={message} isOutbound={isOutbound} />;
  }

  if (MEDIA_TYPES.has(type as 'image' | 'video' | 'audio' | 'voice' | 'document')) {
    return <MediaBubble message={message} isOutbound={isOutbound} />;
  }

  if (type === 'template') {
    return <TemplateBubble message={message} isOutbound={isOutbound} />;
  }

  if (type === 'interactive') {
    return <InteractiveBubble message={message} isOutbound={isOutbound} />;
  }

  if (type === 'sticker') {
    return <StickerBubble message={message} isOutbound={isOutbound} />;
  }

  if (type === 'location') {
    return <LocationBubble message={message} isOutbound={isOutbound} />;
  }

  if (type === 'contact') {
    return <ContactBubble message={message} isOutbound={isOutbound} />;
  }

  if (
    READONLY_TYPES.has(
      type as
        | 'story_mention'
        | 'story_reply'
        | 'comment'
        | 'comment_reply'
        | 'ig_postback'
        | 'referral'
        | 'share'
        | 'reaction',
    )
  ) {
    return <ReadOnlyBubble message={message} isOutbound={isOutbound} />;
  }

  // Tipo não reconhecido — graceful degradation
  return <UnknownBubble message={message} isOutbound={isOutbound} />;
}
