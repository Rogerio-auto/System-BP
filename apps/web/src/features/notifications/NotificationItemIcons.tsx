// =============================================================================
// features/notifications/NotificationItemIcons.tsx — Ícones do item (F26-S01).
//
// Extraídos de NotificationItem.tsx para manter o componente principal abaixo
// de 200 linhas (norma do projeto).
// =============================================================================

import * as React from 'react';

export function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
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

export function CheckIcon(): React.JSX.Element {
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
