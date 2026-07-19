// =============================================================================
// features/notifications/severity.tsx — Estilo visual por severidade (F26-S04).
//
// Fonte única para cor/ícone/rótulo de severidade — reusada pelo toast em
// tempo real (NotificationDropdown), pelo item persistente (NotificationItem,
// dropdown + central) e pela central de notificações. Antes desta extração o
// toast definia sua própria cópia de `TOAST_SEVERITY_STYLE`/`ToastIcon`
// localmente; a central precisava do mesmo estilo e não deve duplicá-lo
// (mesmo princípio de `navigation.ts` para deep-links — doc 23 §14, gap G2).
//
// Domínio de valores: 'info' | 'warning' | 'critical' — igual ao
// `NotificationSeveritySchema` de @elemento/shared-schemas (persistido desde
// F26-S03) e ao `NotificationSocketSeverity` do payload em tempo real
// (mesmo domínio, tipos estruturalmente compatíveis).
//
// Cores sempre via tokens do DS (--info/--warning/--danger + *-bg) — nunca
// hex hardcoded.
// =============================================================================

import type { NotificationSeverity } from '@elemento/shared-schemas';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Estilo por severidade — border/bg/fg (Alert/Toast pattern, DS §9.6)
// ---------------------------------------------------------------------------

export interface SeverityStyle {
  readonly border: string;
  readonly bg: string;
  readonly fg: string;
}

export const SEVERITY_STYLE: Record<NotificationSeverity, SeverityStyle> = {
  info: { border: 'var(--info)', bg: 'var(--info-bg)', fg: 'var(--info)' },
  warning: { border: 'var(--warning)', bg: 'var(--warning-bg)', fg: 'var(--warning)' },
  critical: { border: 'var(--danger)', bg: 'var(--danger-bg)', fg: 'var(--danger)' },
};

/** Rótulo PT-BR de severidade — exibido na central e em tooltips/aria-label. */
export function getSeverityLabel(severity: NotificationSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Crítico';
    case 'warning':
      return 'Atenção';
    default:
      return 'Informativo';
  }
}

// ---------------------------------------------------------------------------
// Ícone por severidade (linear, stroke-width 2 — DS §9.11)
// ---------------------------------------------------------------------------

interface SeverityIconProps {
  severity: NotificationSeverity;
  /** Tamanho em px (largura=altura). Default 14. */
  size?: number;
  className?: string;
}

/**
 * SeverityIcon — ícone linear por severidade (crítico = alerta, atenção =
 * triângulo, info = "i" em círculo). `currentColor` — o chamador define a cor
 * via `style={{ color: ... }}` (normalmente `SEVERITY_STYLE[severity].fg`).
 */
export function SeverityIcon({
  severity,
  size = 14,
  className,
}: SeverityIconProps): React.JSX.Element {
  if (severity === 'critical') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }

  if (severity === 'warning') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
      >
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
