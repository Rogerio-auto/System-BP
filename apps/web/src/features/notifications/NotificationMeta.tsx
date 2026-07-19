// =============================================================================
// features/notifications/NotificationMeta.tsx — Linha de metadados do item.
//
// Ícone de severidade + horário relativo + rótulo de categoria (F26-S04).
// Extraído de NotificationItem.tsx para manter o componente principal abaixo
// de 200 linhas (norma do projeto) — mesma reutilização em dropdown e central.
// =============================================================================

import type { Notification } from '@elemento/shared-schemas';
import * as React from 'react';

import { getNotificationCategoryLabel, resolveNotificationCategory } from './navigation';
import { getSeverityLabel, SEVERITY_STYLE, SeverityIcon } from './severity';

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

interface NotificationMetaProps {
  notification: Notification;
}

/** Ícone de severidade + horário relativo + categoria — DS §9.6 (cores por estado). */
export function NotificationMeta({ notification }: NotificationMetaProps): React.JSX.Element {
  const severityStyle = SEVERITY_STYLE[notification.severity];
  const category = resolveNotificationCategory(notification.entity_type);
  const categoryLabel = getNotificationCategoryLabel(category);

  return (
    <div className="flex items-center gap-1.5 mt-1.5">
      <span
        aria-label={getSeverityLabel(notification.severity)}
        title={getSeverityLabel(notification.severity)}
        style={{ color: severityStyle.fg }}
        className="inline-flex shrink-0"
      >
        <SeverityIcon severity={notification.severity} size={12} />
      </span>
      <p
        className="font-mono"
        style={{ fontSize: '0.65rem', color: 'var(--text-4)', letterSpacing: '-0.01em' }}
        title={new Date(notification.created_at).toLocaleString('pt-BR')}
      >
        {formatRelativeTime(notification.created_at)}
      </p>
      <span aria-hidden="true" style={{ color: 'var(--text-4)', fontSize: '0.6rem' }}>
        •
      </span>
      <span className="font-sans truncate" style={{ fontSize: '0.65rem', color: 'var(--text-3)' }}>
        {categoryLabel}
      </span>
    </div>
  );
}
