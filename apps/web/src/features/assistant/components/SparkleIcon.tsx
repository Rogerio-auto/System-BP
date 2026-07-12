// =============================================================================
// features/assistant/components/SparkleIcon.tsx — Ícone "sparkle" (IA),
// compartilhado entre o botão da Topbar, o teaser e o workspace do copiloto
// interno. SVG inline linear, sem emoji (DS §9.11).
// =============================================================================

import * as React from 'react';

export function SparkleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 2.5l1.6 4.1 4.1 1.6-4.1 1.6L10 14l-1.6-4.2L4.3 8.2l4.1-1.6L10 2.5z" />
      <path d="M15.5 12.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  );
}
