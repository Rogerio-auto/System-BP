// =============================================================================
// components/ui/responsive-table/DesktopTable.tsx — Metade "tabela" do
// ResponsiveTable (DS §9.7). Visível apenas em `md:` e acima; a metade
// "cards" (MobileCards.tsx) cuida do mobile a partir da MESMA lista de
// colunas — sem duplicar a lógica de apresentação.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

import { SkeletonBar } from './SkeletonBar';
import type { ResponsiveTableColumn } from './types';
import { hideBelowClassName } from './types';

interface DesktopTableProps<T> {
  columns: ResponsiveTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
  isLoading: boolean;
  skeletonKeys: string[];
  className?: string | undefined;
  ariaLabel?: string | undefined;
}

export function DesktopTable<T>({
  columns,
  data,
  getRowKey,
  isLoading,
  skeletonKeys,
  className,
  ariaLabel,
}: DesktopTableProps<T>): React.JSX.Element {
  return (
    <div className={cn('hidden md:block overflow-x-auto', className)}>
      <table className="w-full border-collapse" aria-label={ariaLabel}>
        <thead>
          <tr style={{ background: 'var(--bg-elev-2)' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'py-3 px-4 font-sans font-bold text-ink-3',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  hideBelowClassName(col.hideBelow),
                  col.widthClassName,
                )}
                style={{ fontSize: '0.7rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? skeletonKeys.map((key) => (
                <tr key={key} aria-hidden="true" className="border-t border-border-subtle">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn('px-4 py-3.5', hideBelowClassName(col.hideBelow))}
                    >
                      <SkeletonBar className={col.align === 'right' ? 'ml-auto w-16' : 'w-28'} />
                    </td>
                  ))}
                </tr>
              ))
            : data.map((row, idx) => (
                <tr
                  key={getRowKey(row, idx)}
                  className="group border-t border-border-subtle transition-colors duration-fast hover:bg-surface-hover"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-3.5',
                        col.align === 'right' ? 'text-right' : undefined,
                        hideBelowClassName(col.hideBelow),
                      )}
                    >
                      {col.cell(row, idx)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
