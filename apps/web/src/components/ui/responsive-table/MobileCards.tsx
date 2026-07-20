// =============================================================================
// components/ui/responsive-table/MobileCards.tsx — Metade "cards" do
// ResponsiveTable (doc 24 §6). Visível apenas abaixo de `md:`. Cada linha
// vira 1 card (border + elev-1, DS §9.3): a coluna `primary` é reaproveitada
// como título do card — se ela embutir um <Link> (padrão do app), esse
// continua sendo o único alvo interativo, igual ao desktop (evita aninhar
// elemento interativo dentro de outro). As demais colunas viram pares
// rótulo/valor (label uppercase, mesmo padrão de caption usado no resto do DS).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

import { SkeletonBar } from './SkeletonBar';
import type { ResponsiveTableColumn } from './types';
import { splitCardColumns } from './types';

interface MobileCardsProps<T> {
  columns: ResponsiveTableColumn<T>[];
  data: T[];
  getRowKey: (row: T, index: number) => string;
  isLoading: boolean;
  skeletonKeys: string[];
  className?: string | undefined;
  ariaLabel?: string | undefined;
}

export function MobileCards<T>({
  columns,
  data,
  getRowKey,
  isLoading,
  skeletonKeys,
  className,
  ariaLabel,
}: MobileCardsProps<T>): React.JSX.Element {
  const { primary, secondary } = splitCardColumns(columns);

  return (
    <div
      className={cn('md:hidden flex flex-col gap-2.5', className)}
      role="list"
      aria-label={ariaLabel}
    >
      {isLoading
        ? skeletonKeys.map((key) => (
            <div
              key={key}
              aria-hidden="true"
              className="rounded-md border border-border bg-surface-1 p-4"
              style={{ boxShadow: 'var(--elev-1)' }}
            >
              <SkeletonBar className="w-40 mb-3" />
              <SkeletonBar className="w-24" />
            </div>
          ))
        : data.map((row, idx) => (
            <div
              key={getRowKey(row, idx)}
              role="listitem"
              className="rounded-md border border-border bg-surface-1 p-4"
              style={{ boxShadow: 'var(--elev-1)' }}
            >
              {primary && <div>{primary.cell(row, idx)}</div>}

              {secondary.length > 0 && (
                <dl
                  className={cn(
                    'flex flex-col gap-2',
                    primary && 'mt-3 pt-3 border-t border-border-subtle',
                  )}
                >
                  {secondary.map((col) => (
                    <div key={col.key} className="flex items-start justify-between gap-3">
                      <dt
                        className="font-sans font-bold uppercase text-ink-4 shrink-0 pt-0.5"
                        style={{ fontSize: '0.65rem', letterSpacing: '0.08em' }}
                      >
                        {col.header}
                      </dt>
                      {/* flex (não text-align) — funciona tanto para texto simples quanto
                          para células compostas (badge + legenda, avatar, etc.) */}
                      <dd className="min-w-0 flex-1 flex flex-col items-end text-right font-sans text-sm text-ink-2">
                        {col.cell(row, idx)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          ))}
    </div>
  );
}
