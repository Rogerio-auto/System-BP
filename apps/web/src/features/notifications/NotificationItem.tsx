// =============================================================================
// features/notifications/NotificationItem.tsx — Item individual no dropdown.
//
// F26-S01 (doc 23 §14, gaps G1/G2/G3/G5): item acionável.
//   - Conteúdo (título/corpo): se a entidade resolve rota, navega + marca lida
//     ao abrir. Se não resolve, apenas expande (nada é "aberto" → nada marca
//     lida — G3).
//   - Chevron: expande/recolhe o corpo completo (line-clamp some) sem
//     depender de resolução de rota nem marcar lida (G5 "expandir").
//   - Botão "marcar como lida": affordance explícito, independente de
//     navegar (G3).
//   - Expandido + entidade resolvível: CTA rotulado por entity_type
//     (`getNotificationActionLabel`) — ação explícita além do clique no
//     conteúdo (G5).
//
// `resolveNotificationHref`/`getNotificationActionLabel` vêm de `./navigation`
// — mesma fonte usada pelo toast em tempo real (sem duplicação, G2).
// =============================================================================

import type { Notification } from '@elemento/shared-schemas';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

import { useMarkRead } from './hooks';
import { getNotificationActionLabel, resolveNotificationHref } from './navigation';

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

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="transition-transform duration-[150ms]"
      style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Item de notificação no dropdown — acionável (F26-S01).
 * Hover bg-surface-hover (DS §6 Ghost pattern) no conteúdo clicável.
 */
export function NotificationItem({ notification }: NotificationItemProps): React.JSX.Element {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const [expanded, setExpanded] = React.useState(false);

  const isUnread = notification.read_at === null;
  const href = resolveNotificationHref(notification.entity_type, notification.entity_id);
  const actionLabel = getNotificationActionLabel(notification.entity_type);

  const markAsReadIfNeeded = (): void => {
    if (isUnread && !markRead.isPending) markRead.mutate(notification.id);
  };

  /** Conteúdo clicado: se resolve entidade, "abre" (navega + marca lida). Senão, só expande. */
  const handleOpen = (): void => {
    if (href !== null) {
      markAsReadIfNeeded();
      navigate(href);
      return;
    }
    setExpanded((v) => !v);
  };

  const handleToggleExpand = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setExpanded((v) => !v);
  };

  const handleMarkReadOnly = (e: React.MouseEvent): void => {
    e.stopPropagation();
    markAsReadIfNeeded();
  };

  const contentLabel = href !== null ? `${actionLabel}: ${notification.title}` : notification.title;

  return (
    <div
      className="border-b last:border-b-0"
      style={{
        borderColor: 'var(--border-subtle)',
        background: isUnread ? 'var(--info-bg)' : 'transparent',
        transition: 'background 150ms',
      }}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        {/* Dot indicador de não-lida — puramente visual */}
        <span
          className="mt-2 shrink-0 rounded-full"
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            background: isUnread ? 'var(--brand-azul)' : 'var(--surface-muted)',
            boxShadow: isUnread ? '0 0 4px var(--brand-azul)' : 'none',
            transition: 'background 150ms, box-shadow 150ms',
          }}
        />

        {/* Conteúdo: navega+marca lida se resolvível, senão apenas expande */}
        <button
          type="button"
          onClick={handleOpen}
          disabled={markRead.isPending}
          aria-label={contentLabel}
          className={cn(
            'flex-1 min-w-0 text-left rounded-sm',
            'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-azul/40',
            'transition-colors duration-[150ms]',
            'hover:bg-surface-hover',
            'disabled:opacity-60 disabled:cursor-not-allowed',
          )}
        >
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
              className={cn('font-sans mt-0.5', !expanded && 'line-clamp-2')}
              style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', lineHeight: 1.5 }}
            >
              {notification.body}
            </p>
          )}
          <p
            className="font-mono mt-1"
            style={{ fontSize: '0.65rem', color: 'var(--text-4)', letterSpacing: '-0.01em' }}
            title={new Date(notification.created_at).toLocaleString('pt-BR')}
          >
            {formatRelativeTime(notification.created_at)}
          </p>
        </button>

        {/* Controles explícitos: expandir + marcar como lida (independentes de navegar) */}
        <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
          <button
            type="button"
            onClick={handleToggleExpand}
            aria-expanded={expanded}
            aria-label={expanded ? 'Recolher notificação' : 'Expandir para ler tudo'}
            className={cn(
              'min-w-[24px] min-h-[24px] flex items-center justify-center rounded-sm',
              'outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
              'transition-colors duration-[150ms] hover:bg-surface-hover',
            )}
            style={{ color: 'var(--text-3)' }}
          >
            <ChevronIcon expanded={expanded} />
          </button>

          {isUnread && (
            <button
              type="button"
              onClick={handleMarkReadOnly}
              disabled={markRead.isPending}
              aria-label="Marcar como lida"
              className={cn(
                'min-w-[24px] min-h-[24px] flex items-center justify-center rounded-sm',
                'outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
                'transition-colors duration-[150ms] hover:bg-surface-hover',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              style={{ color: 'var(--brand-azul)' }}
            >
              <CheckIcon />
            </button>
          )}
        </div>
      </div>

      {/* Ação explícita (G5) — só quando há entidade resolvível para abrir */}
      {expanded && href !== null && (
        <div className="pb-3 pl-[34px] pr-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleOpen}
            disabled={markRead.isPending}
          >
            {actionLabel} →
          </Button>
        </div>
      )}
    </div>
  );
}
