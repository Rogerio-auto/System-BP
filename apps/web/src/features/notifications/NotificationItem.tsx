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
//
// F26-S04: severidade (faixa esquerda 3px + ícone, DS §9.6 Alert pattern) e
// categoria (rótulo textual, derivada de entity_type — ver navigation.ts)
// exibidas em TODO uso do item — dropdown compacto e central em página cheia
// reusam o mesmo componente (não duplicar). `selectable` habilita o checkbox
// de seleção em lote, usado só pela central (dropdown não passa a prop).
// =============================================================================

import type { Notification } from '@elemento/shared-schemas';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

import { useMarkRead } from './hooks';
import { getNotificationActionLabel, resolveNotificationHref } from './navigation';
import { ChevronIcon, CheckIcon } from './NotificationItemIcons';
import { NotificationMeta } from './NotificationMeta';
import { SEVERITY_STYLE } from './severity';

interface NotificationItemProps {
  notification: Notification;
  /** Habilita checkbox de seleção em lote (só a central usa — F26-S04). */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

/**
 * Item de notificação no dropdown — acionável (F26-S01).
 * Hover bg-surface-hover (DS §6 Ghost pattern) no conteúdo clicável.
 */
export function NotificationItem({
  notification,
  selectable = false,
  selected = false,
  onToggleSelect,
}: NotificationItemProps): React.JSX.Element {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  const [expanded, setExpanded] = React.useState(false);

  const isUnread = notification.read_at === null;
  const href = resolveNotificationHref(notification.entity_type, notification.entity_id);
  const actionLabel = getNotificationActionLabel(notification.entity_type);
  const severityStyle = SEVERITY_STYLE[notification.severity];

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
        borderLeft: `3px solid ${severityStyle.border}`,
        background: isUnread ? 'var(--info-bg)' : 'transparent',
        transition: 'background 150ms',
      }}
    >
      <div className="flex items-start gap-2 px-4 py-3">
        {/* Checkbox de seleção em lote — só na central (F26-S04) */}
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(notification.id)}
            aria-label={`Selecionar notificação: ${notification.title}`}
            className={cn(
              'mt-1.5 shrink-0 rounded-sm border cursor-pointer',
              'outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
            )}
            style={{
              width: 16,
              height: 16,
              accentColor: 'var(--brand-azul)',
              borderColor: 'var(--border-strong)',
            }}
          />
        )}

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
          {/* Severidade (ícone) + horário + categoria — F26-S04 */}
          <NotificationMeta notification={notification} />
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
