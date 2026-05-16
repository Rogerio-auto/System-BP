// =============================================================================
// features/dashboard/components/StatsRow.tsx — Row de 4 KPIs principais.
//
// DS §9.8 Stat/KPI: bg-elev-1, elev-2, label uppercase, valor Bricolage 800.
// Hover: Spotlight (halo verde segue cursor via --mx/--my).
// 4 cards: Total leads, Novos no range, Em qualificação/simulação, Conversão.
// =============================================================================

import * as React from 'react';

import { Stat } from '../../../components/ui/Stat';
import type { LeadsMetrics, RangeInfo } from '../../../hooks/dashboard/types';

interface StatsRowProps {
  leads: LeadsMetrics;
  range: RangeInfo;
}

/** Formata número no locale pt-BR */
function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}

/** Formata percentual: 0.2345 → "23,4%" */
function fmtPercent(n: number): string {
  return (
    (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  );
}

/**
 * Row de 4 KPIs do dashboard.
 * Grid responsivo: 1 coluna mobile, 2 colunas tablet, 4 colunas desktop.
 */
export function StatsRow({ leads, range }: StatsRowProps): React.JSX.Element {
  // Leads em qualificação ou simulação (status ativos)
  const activeStatuses = ['qualifying', 'simulation'] as const;
  const activeCount = leads.byStatus
    .filter((s) => activeStatuses.includes(s.status as (typeof activeStatuses)[number]))
    .reduce((sum, s) => sum + s.count, 0);

  // Conversão: closed_won / (closed_won + closed_lost)
  const closedWon = leads.byStatus.find((s) => s.status === 'closed_won')?.count ?? 0;
  const closedLost = leads.byStatus.find((s) => s.status === 'closed_lost')?.count ?? 0;
  const totalClosed = closedWon + closedLost;
  const conversionRate = totalClosed > 0 ? closedWon / totalClosed : 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat label="Total de leads" value={fmtNumber(leads.total)} description={range.label} />
      <Stat
        label="Novos no período"
        value={fmtNumber(leads.newInRange)}
        description={range.label}
      />
      <Stat
        label="Em qualificação"
        value={fmtNumber(activeCount)}
        description="qualificação + simulação"
      />
      <Stat
        label="Conversão"
        value={totalClosed > 0 ? fmtPercent(conversionRate) : '—'}
        description={
          totalClosed > 0
            ? `${fmtNumber(closedWon)} de ${fmtNumber(totalClosed)} fechados`
            : 'sem fechamentos no período'
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/** Skeleton respeitando o layout final dos 4 KPIs. Sem layout shift. */
export function StatsRowSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border bg-surface-1 p-5"
          style={{ boxShadow: 'var(--elev-2)', minHeight: '100px' }}
        >
          <div
            className="mb-3 h-2.5 w-24 rounded-pill animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
          <div
            className="h-8 w-16 rounded-xs animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
          <div
            className="mt-2 h-2 w-32 rounded-pill animate-pulse"
            style={{ background: 'var(--border-subtle)' }}
          />
        </div>
      ))}
    </div>
  );
}
