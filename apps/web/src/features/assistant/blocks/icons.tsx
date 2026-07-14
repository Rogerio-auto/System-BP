// =============================================================================
// features/assistant/blocks/icons.tsx — Ícones lineares (DS §9.11) dos cards
// de bloco do copiloto interno (F6-S22). Mesmo estilo de SparkleIcon.tsx:
// SVG inline, stroke, sem emoji.
// =============================================================================

import * as React from 'react';

interface IconProps {
  className?: string;
}

const commonProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

/** funnel_metrics */
export function FunnelIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M4 5h16l-6 7.5V19l-4 2v-8.5L4 5z" />
    </svg>
  );
}

/** lead_count */
export function UsersIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19c.7-3 3-4.5 5.5-4.5s4.8 1.5 5.5 4.5" />
      <circle cx="17" cy="8.5" r="2.3" />
      <path d="M15.3 14.8c2 .2 3.6 1.6 4.2 4.2" />
    </svg>
  );
}

/** analysis_status */
export function ClipboardCheckIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <rect x="6" y="4" width="12" height="16" rx="2" />
      <path d="M9 4V3.5A1.5 1.5 0 0110.5 2h3A1.5 1.5 0 0115 3.5V4" />
      <path d="M9 12.5l2 2 4-4.5" />
    </svg>
  );
}

/** billing */
export function ReceiptIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M6 3h12v18l-2.5-1.5L13 21l-1.5-1.5L10 21l-2.5-1.5L6 21V3z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </svg>
  );
}

/** lead_summary */
export function MessageIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M4 5h16v11H9l-4 3.5V16H4V5z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}

/** tipo desconhecido (forward-compat) */
export function BoxIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M4 8l8-4.5L20 8v8l-8 4.5L4 16V8z" />
      <path d="M4 8l8 4.5M12 12.5L20 8M12 12.5V21" />
    </svg>
  );
}

/** dado indisponível */
export function InboxOffIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg {...commonProps} className={className}>
      <path d="M4 12l2.5-7h11L20 12" />
      <path d="M4 12v6a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0020 18v-6h-4.5l-1 2h-5l-1-2H4z" />
    </svg>
  );
}
