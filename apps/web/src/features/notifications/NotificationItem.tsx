// =============================================================================
// features/notifications/NotificationItem.tsx — Item individual no dropdown.
//
// Não-lida: fundo info-bg + dot azul. Lida: fundo neutro.
// Clique → marca como lida via POST /api/notifications/:id/read.
// =============================================================================

import type { Notification } from '@elemento/shared-schemas';
import * as React from 'react';

import { cn } from '../../lib/cn';

import { useMarkRead } from './hooks';

interface NotificationItemProps {
  notification: Notification;
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `há ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

/**
 * Item de notificação no dropdown.
 * Hover bg-surface-hover (DS §6 Ghost pattern).
 */
export function NotificationItem({ notification }: NotificationItemProps): React.JSX.Element {
  const markRead = useMarkRead();
  const isUnread = notification.read_at === null;

  const handleClick = (): void => {
    if (isUnread && !markRead.isPending) {
      markRead.mutate(notification.id);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={notification.title}
      disabled={markRead.isPending}
      className={cn(
        'w-full text-left px-4 py-3 flex items-start gap-3',
        'outline-none focus-visible:ring-2 focus-visible:ring-inset',
        'transition-colors duration-[150ms]',
        'hover:bg-surface-hover',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        'border-b last:border-b-0',
      )}
      style={{
        background: isUnread ? 'var(--info-bg)' : 'transparent',
        borderColor: 'var(--border-subtle)',
      }}
    >
      {/* Dot indicador de não-lida */}
      <span
        className="mt-1.5 shrink-0 rounded-full"
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          background: isUnread ? 'var(--brand-azul)' : 'var(--surface-muted)',
          boxShadow: isUnread ? '0 0 4px var(--brand-azul)' : 'none',
          transition: 'background 150ms, box-shadow 150ms',
        }}
      />

      {/* Conteúdo */}
      <div className="flex-1 min-w-0">
        <p
          className="font-sans font-semibold truncate"
          style={{
            fontSize: 'var(--text-sm)',
            color: isUnread ? 'var(--text)' : 'var(--text-2)',
          }}
        >
          {notification.title}
        </p>
        {notification.body.length > 0 && (
          <p
            className="font-sans mt-0.5 line-clamp-2"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', lineHeight: 1.5 }}
          >
            {notification.body}
          </p>
        )}
        <p
          className="font-mono mt-1"
          style={{ fontSize: '0.65rem', color: 'var(--text-4)', letterSpacing: '-0.01em' }}
        >
          {formatRelativeTime(notification.created_at)}
        </p>
      </div>
    </button>
  );
}
