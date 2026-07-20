// =============================================================================
// components/ui/responsive-table/SkeletonBar.tsx — Pulso genérico de loading
// reaproveitado pelos dois modos (tabela/cards) do ResponsiveTable. Skeleton,
// nunca spinner isolado (DS — anti-padrão "loading engasgado").
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

export function SkeletonBar({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn('h-4 rounded-xs animate-pulse', className)}
      style={{ background: 'var(--surface-muted)' }}
    />
  );
}
