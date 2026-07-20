// =============================================================================
// components/ui/ResponsiveTable.tsx — Superfície densa responsiva (F27-S04,
// DS §9.7 + doc 24 §6): tabela no desktop, cards empilhados no mobile — a
// partir da MESMA definição de colunas (sem duplicar a lógica table↔cards
// por tela). Usado em features/crm/CrmListPage.tsx e
// features/relatorios/components/*.
//
//   - Desktop (>= md): DesktopTable — <table> denso, thead caption-style,
//     hover de linha.
//   - Mobile (< md): MobileCards — 1 card por linha (border + elev-1).
//   - Loading: skeleton (nunca spinner) nos dois modos.
//   - Empty: `emptyState` substitui os dois modos por um único bloco (o
//     chamador injeta a ilustração/CTA — este componente só decide QUANDO).
// =============================================================================

import * as React from 'react';

import { DesktopTable } from './responsive-table/DesktopTable';
import { MobileCards } from './responsive-table/MobileCards';
import type { ResponsiveTableColumn } from './responsive-table/types';

export type { ResponsiveTableBreakpoint, ResponsiveTableColumn } from './responsive-table/types';
export { hideBelowClassName, splitCardColumns } from './responsive-table/types';

export interface ResponsiveTableProps<T> {
  columns: ResponsiveTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
  /** Skeleton (nunca spinner) enquanto os dados carregam. */
  isLoading?: boolean;
  skeletonRowCount?: number;
  /** Renderizado no lugar da tabela/cards quando `data` está vazio (com CTA). */
  emptyState?: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}

/**
 * Tabela densa que degrada para cards no mobile (DS §9.7 + doc 24 §6).
 * Ver DesktopTable/MobileCards para os dois modos de renderização.
 */
export function ResponsiveTable<T>({
  columns,
  data,
  getRowKey,
  isLoading = false,
  skeletonRowCount = 5,
  emptyState,
  className,
  ...rest
}: ResponsiveTableProps<T>): React.JSX.Element {
  const ariaLabel = rest['aria-label'];
  const showEmpty = !isLoading && data.length === 0 && Boolean(emptyState);
  const skeletonKeys = React.useMemo(
    () => Array.from({ length: skeletonRowCount }, (_, i) => `skeleton-${i}`),
    [skeletonRowCount],
  );

  if (showEmpty) {
    return <div className={className}>{emptyState}</div>;
  }

  return (
    <>
      <DesktopTable
        columns={columns}
        data={data}
        getRowKey={getRowKey}
        isLoading={isLoading}
        skeletonKeys={skeletonKeys}
        className={className}
        ariaLabel={ariaLabel}
      />
      <MobileCards
        columns={columns}
        data={data}
        getRowKey={getRowKey}
        isLoading={isLoading}
        skeletonKeys={skeletonKeys}
        className={className}
        ariaLabel={ariaLabel}
      />
    </>
  );
}
