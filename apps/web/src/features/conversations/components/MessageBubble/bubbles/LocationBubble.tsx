// =============================================================================
// bubbles/LocationBubble.tsx — Bolha de localização WhatsApp.
//
// Exibe lat/lng com link para Google Maps.
// metadata.latitude / metadata.longitude (se presentes no payload do backend).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../../lib/cn';
import type { Message } from '../../../types';
import { StatusIcon } from '../StatusIcon';
import { formatBubbleTime } from '../utils';

interface LocationBubbleProps {
  message: Message;
  isOutbound: boolean;
}

interface LocationMeta {
  latitude?: number | undefined;
  longitude?: number | undefined;
  name?: string | undefined;
  address?: string | undefined;
}

function extractLocation(msg: Message): LocationMeta {
  const meta = msg.metadata as LocationMeta | null;
  return {
    latitude: meta?.latitude ?? undefined,
    longitude: meta?.longitude ?? undefined,
    name: meta?.name ?? undefined,
    address: meta?.address ?? undefined,
  };
}

export function LocationBubble({ message, isOutbound }: LocationBubbleProps): React.JSX.Element {
  const loc = extractLocation(message);
  const hasCoords = loc.latitude !== undefined && loc.longitude !== undefined;
  const mapsUrl = hasCoords
    ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`
    : null;

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
      <div className="flex items-start gap-2">
        {/* Pin icon */}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className="w-4 h-4 shrink-0 mt-0.5 text-danger"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path d="M8 1a5 5 0 015 5c0 3.5-5 9-5 9S3 9.5 3 6a5 5 0 015-5z" />
          <circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        <div className="min-w-0">
          {loc.name && <p className="font-medium text-ink truncate">{loc.name}</p>}
          {loc.address && <p className="text-xs text-ink-3 mt-0.5 break-words">{loc.address}</p>}
          {hasCoords && (
            <p className="font-mono text-xs text-ink-3 mt-0.5 tabular-nums">
              {loc.latitude?.toFixed(6)}, {loc.longitude?.toFixed(6)}
            </p>
          )}
          {!loc.name && !loc.address && !hasCoords && message.content && (
            <p className="text-ink break-words">{message.content}</p>
          )}
        </div>
      </div>

      {mapsUrl && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-xs text-azul hover:underline transition-colors"
        >
          Ver no Google Maps
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-3 h-3"
          >
            <path d="M5 2H2v8h8V7M7 1h4v4M11 1L6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
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
