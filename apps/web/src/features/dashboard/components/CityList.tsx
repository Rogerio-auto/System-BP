// =============================================================================
// features/dashboard/components/CityList.tsx — Lista top 5 cidades com
// barras inline.
//
// SVG manual (sem dep). Lista acessível + barras proporcionais.
// Mostra no máximo 5 cidades. Cores tokens DS.
// =============================================================================

import * as React from 'react';

import type { LeadsByCityItem } from '../../../hooks/dashboard/types';

interface CityListProps {
  data: LeadsByCityItem[];
}

/**
 * Lista de top 5 cidades com barras inline proporcionais.
 * Acessível via lista semântica com role="list".
 */
export function CityList({ data }: CityListProps): React.JSX.Element {
  const top5 = [...data].sort((a, b) => b.count - a.count).slice(0, 5);
  const max = top5[0]?.count ?? 0;
  const total = data.reduce((s, d) => s + d.count, 0);
  const isEmpty = top5.length === 0;

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <p
        className="font-sans font-semibold uppercase mb-4"
        style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'var(--text-3)' }}
      >
        Leads por cidade
        {data.length > 5 && (
          <span className="ml-1 normal-case font-normal" style={{ letterSpacing: 0 }}>
            (top 5 de {data.length})
          </span>
        )}
      </p>

      {isEmpty ? (
        <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-3)' }}>
          <p className="font-sans text-sm">Sem dados no período selecionado.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3" role="list" aria-label="Top 5 cidades por leads">
          {top5.map((city, idx) => {
            const pct = max > 0 ? (city.count / max) * 100 : 0;
            const totalPct = total > 0 ? Math.round((city.count / total) * 100) : 0;
            // Cores: 1° azul, 2° verde, 3° amarelo, demais text-3
            const barColors = [
              'var(--brand-azul)',
              'var(--brand-verde)',
              'var(--brand-amarelo)',
              'var(--info)',
              'var(--text-3)',
            ];
            const barColor = barColors[idx] ?? 'var(--text-3)';

            return (
              <li key={city.cityId} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs gap-2">
                  <span
                    className="font-sans font-medium truncate min-w-0"
                    style={{ color: 'var(--text-2)' }}
                  >
                    <span
                      className="font-mono mr-1.5 tabular-nums"
                      style={{
                        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                        color: barColor,
                        fontSize: '0.65rem',
                        fontWeight: 600,
                      }}
                    >
                      {idx + 1}.
                    </span>
                    {city.cityName}
                  </span>
                  <span
                    className="font-mono shrink-0 tabular-nums"
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      color: 'var(--text-3)',
                    }}
                  >
                    {city.count.toLocaleString('pt-BR')}
                    <span className="ml-1 opacity-60">({totalPct}%)</span>
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-pill overflow-hidden"
                  style={{ background: 'var(--surface-muted)' }}
                  role="presentation"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-pill transition-all duration-slow"
                    style={{
                      width: `${pct}%`,
                      background: barColor,
                      minWidth: pct > 0 ? '3px' : '0',
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function CityListSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)', minHeight: '200px' }}
    >
      <div
        className="mb-4 h-2.5 w-28 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex flex-col gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex justify-between">
              <div
                className="h-2.5 rounded-pill animate-pulse"
                style={{ background: 'var(--surface-muted)', width: `${80 - i * 10}px` }}
              />
              <div
                className="h-2.5 w-12 rounded-pill animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
            <div
              className="h-1.5 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)', width: `${70 - i * 12}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
