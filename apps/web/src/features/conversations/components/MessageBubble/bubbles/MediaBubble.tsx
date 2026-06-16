// =============================================================================
// bubbles/MediaBubble.tsx — Bolha de mídia (image, video, audio, voice, document).
//
// - image: thumbnail clicável (abre em nova aba)
// - video: thumbnail com ícone play
// - audio/voice: player nativo <audio>
// - document: ícone de arquivo + nome inferido da URL
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message, MessageType } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface MediaBubbleProps {
  message: Message;
  isOutbound: boolean;
}

// ─── Ícones inline ───────────────────────────────────────────────────────────

function IconImage(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-5 h-5"
    >
      <rect x="2" y="2" width="16" height="16" rx="3" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none" />
      <path d="M2 13l5-4 4 4 2-2 5 5" strokeLinejoin="round" />
    </svg>
  );
}

function IconVideo(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-5 h-5"
    >
      <rect x="1" y="4" width="13" height="12" rx="2" />
      <path d="M14 8l5-3v10l-5-3V8z" />
    </svg>
  );
}

function IconAudio(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-5 h-5"
    >
      <path d="M9 4v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1h3a1 1 0 011 1z" />
      <path d="M9 7l7 3-7 3V7z" />
    </svg>
  );
}

function IconDocument(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-5 h-5"
    >
      <path d="M4 2h8l4 4v12a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M12 2v4h4M7 9h6M7 12h6M7 15h4" strokeLinecap="round" />
    </svg>
  );
}

function IconPlay(): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 opacity-90">
      <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.5)" stroke="white" strokeWidth="1" />
      <path d="M10 8.5l6 3.5-6 3.5V8.5z" fill="white" />
    </svg>
  );
}

// ─── Mapa de ícones por tipo ──────────────────────────────────────────────────

type MediaType = Extract<MessageType, 'image' | 'video' | 'audio' | 'voice' | 'document'>;

const mediaIcon: Record<MediaType, React.ReactNode> = {
  image: <IconImage />,
  video: <IconVideo />,
  audio: <IconAudio />,
  voice: <IconAudio />,
  document: <IconDocument />,
};

const mediaLabel: Record<MediaType, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  voice: 'Mensagem de voz',
  document: 'Documento',
};

// ─── Extrai nome de arquivo de URL ───────────────────────────────────────────

function fileNameFromUrl(url: string | null): string {
  if (!url) return 'arquivo';
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/');
    return decodeURIComponent(parts[parts.length - 1] ?? 'arquivo');
  } catch {
    return 'arquivo';
  }
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function MediaBubble({ message, isOutbound }: MediaBubbleProps): React.JSX.Element {
  const type = message.type as MediaType;
  const isImage = type === 'image';
  const isVideo = type === 'video';
  const isAudio = type === 'audio' || type === 'voice';
  const isDocument = type === 'document';

  const bubbleBase = cn(
    'relative max-w-[75%] rounded-md overflow-hidden',
    'font-sans text-sm',
    '[box-shadow:var(--elev-1)]',
    isOutbound
      ? [
          'self-end',
          'bg-[color-mix(in_srgb,var(--brand-azul)_12%,var(--bg-elev-1))]',
          'border border-[color-mix(in_srgb,var(--brand-azul)_20%,transparent)]',
          'rounded-br-xs',
        ]
      : ['self-start', 'bg-surface-2 border border-border-subtle', 'rounded-bl-xs'],
  );

  const footer = (
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
  );

  // ── Imagem ──────────────────────────────────────────────────────────────────
  if (isImage && message.mediaUrl) {
    return (
      <div className={cn(bubbleBase, 'p-0')}>
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir imagem em nova aba"
          className="block"
        >
          <img
            src={message.mediaUrl}
            alt={message.content ?? 'Imagem'}
            loading="lazy"
            className="max-w-[280px] max-h-[300px] object-cover w-full"
          />
        </a>
        {message.content && (
          <p className="px-3 pt-2 text-ink whitespace-pre-wrap break-words">{message.content}</p>
        )}
        {footer}
      </div>
    );
  }

  // ── Vídeo ───────────────────────────────────────────────────────────────────
  if (isVideo && message.mediaUrl) {
    return (
      <div className={cn(bubbleBase, 'p-0')}>
        <a
          href={message.mediaUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Abrir vídeo em nova aba"
          className="relative block bg-black"
        >
          <video
            src={message.mediaUrl}
            preload="metadata"
            className="max-w-[280px] max-h-[220px] object-cover w-full"
            muted
          />
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <IconPlay />
          </span>
        </a>
        {message.content && (
          <p className="px-3 pt-2 text-ink whitespace-pre-wrap break-words">{message.content}</p>
        )}
        {footer}
      </div>
    );
  }

  // ── Áudio / Voz ─────────────────────────────────────────────────────────────
  if (isAudio && message.mediaUrl) {
    return (
      <div className={cn(bubbleBase, 'px-3 pt-3')}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-ink-3">{mediaIcon[type]}</span>
          <span className="text-xs text-ink-3 font-medium">{mediaLabel[type]}</span>
        </div>
        <audio controls src={message.mediaUrl} className="w-full max-w-[240px] h-8">
          Seu navegador não suporta reprodução de áudio.
        </audio>
        {footer}
      </div>
    );
  }

  // ── Documento ────────────────────────────────────────────────────────────────
  if (isDocument) {
    const fileName = fileNameFromUrl(message.mediaUrl);
    const href = message.mediaUrl ?? undefined;
    return (
      <div className={cn(bubbleBase, 'px-3 pt-3')}>
        <div className="flex items-center gap-3 mb-1">
          <span className="text-ink-3 shrink-0">{mediaIcon[type]}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate max-w-[180px]">{fileName}</p>
            <p className="text-xs text-ink-3">{mediaLabel[type]}</p>
          </div>
        </div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-azul hover:underline mb-1 transition-colors"
            download
          >
            Baixar arquivo
          </a>
        )}
        {footer}
      </div>
    );
  }

  // Fallback genérico (mime conhecido mas sem URL)
  return (
    <div className={cn(bubbleBase, 'px-3 py-3')}>
      <div className="flex items-center gap-2 text-ink-3">
        <span>{mediaIcon[type] ?? <IconDocument />}</span>
        <span className="text-xs">{mediaLabel[type] ?? 'Mídia'} (sem prévia)</span>
      </div>
      {footer}
    </div>
  );
}
