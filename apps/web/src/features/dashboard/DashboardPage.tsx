// =============================================================================
// features/dashboard/DashboardPage.tsx — Dashboard real com KPIs e gráficos.
//
// Consome GET /api/dashboard/metrics via useDashboardMetrics (TanStack Query).
// Layout em 3 zonas: StatsRow (KPIs) → gráficos (2 colunas) → TopAgentsTable.
// Filtros: range (today/7d/30d/mtd/ytd) + cidade (quando >1 no escopo).
// Gráficos: SVG manual (sem dep externa — recharts não estava no package.json).
// DS: light-first, tokens canônicos, profundidade elev-2, hover Spotlight.
// =============================================================================

import * as React from 'react';

import type { Range } from '../../hooks/dashboard/types';
import { useDashboardMetrics } from '../../hooks/dashboard/useDashboardMetrics';
import { useAuth } from '../auth/useAuth';

import { ChannelBars, ChannelBarsSkeleton } from './components/ChannelBars';
import { CityList, CityListSkeleton } from './components/CityList';
import { KanbanBars, KanbanBarsSkeleton } from './components/KanbanBars';
import { StaleBanner } from './components/StaleBanner';
import { StatsRow, StatsRowSkeleton } from './components/StatsRow';
import { StatusDonut, StatusDonutSkeleton } from './components/StatusDonut';
import { TopAgentsTable, TopAgentsTableSkeleton } from './components/TopAgentsTable';

// ---------------------------------------------------------------------------
// Range options
// ---------------------------------------------------------------------------

const RANGE_OPTIONS: { value: Range; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'mtd', label: 'Mês atual' },
  { value: 'ytd', label: 'Ano atual' },
];

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * Dashboard real com KPIs e gráficos.
 * Substitui o placeholder implementado em F1-S10.
 */
export function DashboardPage(): React.JSX.Element {
  const { user } = useAuth();

  const [range, setRange] = React.useState<Range>('30d');
  const [cityId, setCityId] = React.useState<string | undefined>(undefined);

  // Build query params — omit cityId when undefined (exactOptionalPropertyTypes)
  const metricsQuery = cityId ? { range, cityId } : { range };
  const { data, isLoading, isError, isForbidden, error, refetch } =
    useDashboardMetrics(metricsQuery);

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex flex-col gap-6"
      style={{
        animation:
          'fade-up var(--dur-slow, 400ms) var(--ease-out, cubic-bezier(0.16,1,0.3,1)) both',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            Dashboard
          </h1>
          <p className="font-sans text-sm mt-1" style={{ color: 'var(--text-3)' }}>
            {data?.range.label ?? 'Carregando...'} — bem-vindo, {user?.fullName ?? 'Agente'}.
          </p>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Range select */}
          <div className="relative">
            <label htmlFor="dash-range" className="sr-only">
              Período
            </label>
            <select
              id="dash-range"
              value={range}
              onChange={(e) => setRange(e.target.value as Range)}
              className="font-sans text-sm rounded-sm border pl-3 pr-8 py-2 appearance-none transition-all duration-fast focus:outline-none focus-visible:ring-2"
              style={{
                background: 'var(--bg-elev-1)',
                borderColor: 'var(--border-strong)',
                color: 'var(--text)',
                boxShadow: 'var(--elev-1), inset 0 1px 2px var(--border-inner-dark)',
                ['--tw-ring-color' as string]: 'rgba(27,58,140,0.15)',
              }}
            >
              {RANGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {/* Ícone chevron do select */}
            <svg
              className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-3)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {/* Cidade select — só aparece se tiver dados de múltiplas cidades */}
          {data && data.leads.byCity.length > 1 && (
            <div className="relative">
              <label htmlFor="dash-city" className="sr-only">
                Cidade
              </label>
              <select
                id="dash-city"
                value={cityId ?? ''}
                onChange={(e) => setCityId(e.target.value || undefined)}
                className="font-sans text-sm rounded-sm border pl-3 pr-8 py-2 appearance-none transition-all duration-fast focus:outline-none focus-visible:ring-2"
                style={{
                  background: 'var(--bg-elev-1)',
                  borderColor: 'var(--border-strong)',
                  color: 'var(--text)',
                  boxShadow: 'var(--elev-1), inset 0 1px 2px var(--border-inner-dark)',
                  ['--tw-ring-color' as string]: 'rgba(27,58,140,0.15)',
                }}
              >
                <option value="">Todas as cidades</option>
                {data.leads.byCity.map((city) => (
                  <option key={city.cityId} value={city.cityId}>
                    {city.cityName}
                  </option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text-3)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* ── Stale Banner ────────────────────────────────────────────────────── */}
      {data && <StaleBanner staleCount={data.leads.staleCount} />}

      {/* ── 403 — sem permissão ─────────────────────────────────────────────── */}
      {isForbidden && (
        <div
          className="rounded-md p-6 text-center"
          style={{
            background: 'var(--danger-bg)',
            borderLeft: '3px solid var(--danger)',
            boxShadow: 'var(--elev-1)',
          }}
        >
          <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
            Você não tem permissão para visualizar o dashboard.
          </p>
          <p className="font-sans text-sm mt-1" style={{ color: 'var(--text-3)' }}>
            Contate o administrador do sistema.
          </p>
        </div>
      )}

      {/* ── Erro genérico ───────────────────────────────────────────────────── */}
      {isError && !isForbidden && (
        <div
          className="rounded-md p-5 flex items-center justify-between gap-4"
          style={{
            background: 'var(--danger-bg)',
            borderLeft: '3px solid var(--danger)',
            boxShadow: 'var(--elev-1)',
          }}
        >
          <div>
            <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
              Erro ao carregar o dashboard
            </p>
            <p className="font-sans text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
              {error?.message ?? 'Erro desconhecido'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-sans text-xs font-semibold px-3 py-1.5 rounded-xs border transition-all duration-fast hover:opacity-80 focus:outline-none focus-visible:ring-2 active:scale-95"
            style={{
              borderColor: 'var(--danger)',
              color: 'var(--danger)',
              ['--tw-ring-color' as string]: 'rgba(200,52,31,0.2)',
            }}
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* ── Stats Row ───────────────────────────────────────────────────────── */}
      {isLoading ? (
        <StatsRowSkeleton />
      ) : data ? (
        <StatsRow leads={data.leads} range={data.range} />
      ) : null}

      {/* ── Gráficos (2 colunas desktop, 1 coluna mobile) ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Donut de status */}
        {isLoading ? (
          <StatusDonutSkeleton />
        ) : data ? (
          <StatusDonut data={data.leads.byStatus} />
        ) : null}

        {/* Barras de canal */}
        {isLoading ? (
          <ChannelBarsSkeleton />
        ) : data ? (
          <ChannelBars
            data={data.interactions.byChannel}
            totalInRange={data.interactions.totalInRange}
          />
        ) : null}

        {/* Lista de cidades */}
        {isLoading ? <CityListSkeleton /> : data ? <CityList data={data.leads.byCity} /> : null}

        {/* Barras Kanban */}
        {isLoading ? (
          <KanbanBarsSkeleton />
        ) : data ? (
          <KanbanBars data={data.kanban.cardsByStage} />
        ) : null}
      </div>

      {/* ── Top Agentes ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <TopAgentsTableSkeleton />
      ) : data ? (
        <TopAgentsTable agents={data.agents.topByLeadsClosed} />
      ) : null}
    </div>
  );
}
