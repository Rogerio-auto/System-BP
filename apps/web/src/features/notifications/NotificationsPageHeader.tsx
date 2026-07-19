// =============================================================================
// features/notifications/NotificationsPageHeader.tsx — Cabeçalho da central
// (F26-S04). Extraído de pages/NotificationsPage.tsx (norma <200 linhas/componente).
// =============================================================================

import * as React from 'react';

interface NotificationsPageHeaderProps {
  unreadTotal: number;
}

/** Título (Bricolage) + subtítulo + badge de não-lidas. */
export function NotificationsPageHeader({
  unreadTotal,
}: NotificationsPageHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1
          className="font-display font-bold"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.045em',
            lineHeight: 1.05,
            color: 'var(--text)',
            fontVariationSettings: "'opsz' 48",
          }}
        >
          Central de notificações
        </h1>
        <p
          className="font-sans mt-1"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
        >
          Todas as suas notificações, com filtro por categoria e status.
        </p>
      </div>
      {unreadTotal > 0 && (
        <span
          className="inline-flex items-center px-3 py-1 rounded-pill font-mono font-semibold"
          style={{
            fontSize: 'var(--text-sm)',
            background: 'var(--info-bg)',
            color: 'var(--info)',
            boxShadow: 'var(--elev-1)',
          }}
        >
          {unreadTotal} não lida{unreadTotal !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}
