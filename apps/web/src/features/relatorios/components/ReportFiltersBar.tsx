// =============================================================================
// features/relatorios/components/ReportFiltersBar.tsx -- Barra de filtros
// adaptativa ao papel (F23-S06 s5). Estado na URL via useReportFilters.
// DS: light-first, tokens canonicos, bg-elev-1, border-strong.
// =============================================================================

import type { ReportRange, ReportScope } from '@elemento/shared-schemas';
import * as React from 'react';

import type { CityPublic } from '../../../hooks/useCitiesList';
import type { ReportFilters, ReportFiltersActions } from '../hooks/useReportFilters';

const RANGE_OPTIONS: { value: ReportRange; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: 'last7d', label: 'Ultimos 7 dias' },
  { value: 'last30d', label: 'Ultimos 30 dias' },
  { value: 'last90d', label: 'Ultimos 90 dias' },
  { value: 'thisMonth', label: 'Este mes' },
  { value: 'lastMonth', label: 'Mes anterior' },
];

const SCOPE_OPTIONS: { value: ReportScope; label: string }[] = [
  { value: 'self', label: 'Meus dados' },
  { value: 'city', label: 'Minha cidade' },
  { value: 'global', label: 'Consolidado' },
];

export interface AgentOption {
  id: string;
  name: string;
}

interface ReportFiltersBarProps {
  filters: ReportFilters & ReportFiltersActions;
  availableScopes: ReportScope[];
  availableCities: CityPublic[];
  showAgentFilter: boolean;
  availableAgents: AgentOption[];
}

const selectClass =
  'font-sans text-sm rounded-sm border pl-3 pr-8 py-2 appearance-none transition-all duration-fast focus:outline-none focus-visible:ring-2';

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-elev-1)',
  borderColor: 'var(--border-strong)',
  color: 'var(--text)',
  boxShadow: 'var(--elev-1), inset 0 1px 2px var(--border-inner-dark)',
};

function ChevronIcon(): React.JSX.Element {
  return (
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
  );
}

function FilterLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label
      htmlFor={htmlFor}
      className="font-sans font-semibold uppercase text-ink-3"
      style={{ fontSize: '0.68rem', letterSpacing: '0.1em' }}
    >
      {children}
    </label>
  );
}

function ScopeToggle({
  value,
  options,
  onChange,
}: {
  value: ReportScope;
  options: { value: ReportScope; label: string }[];
  onChange: (scope: ReportScope) => void;
}): React.JSX.Element {
  return (
    <div
      className="flex rounded-sm border overflow-hidden"
      style={{ borderColor: 'var(--border-strong)', boxShadow: 'var(--elev-1)' }}
      role="group"
      aria-label="Escopo do relatorio"
    >
      {options.map((opt, idx) => {
        const isActive = opt.value === value;
        const isLast = idx === options.length - 1;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className="font-sans text-sm px-3 py-2 transition-all duration-fast focus:outline-none"
            style={{
              background: isActive ? 'var(--brand-verde)' : 'var(--bg-elev-1)',
              color: isActive ? '#fff' : 'var(--text)',
              fontWeight: isActive ? 600 : 400,
              borderRight: isLast ? 'none' : '1px solid var(--border-strong)',
            }}
            aria-pressed={isActive}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Barra de filtros adaptativa ao papel para Relatorios.
 *
 * Adaptacao ao papel (plano relatorios-metricas.md s3/s5):
 *   - scope toggle: so aparece quando papel tem >1 escopo possivel
 *     (admin/gestor_geral: global+city; gestor_regional: city; agente: self)
 *   - city: so quando scope=city|global e ha >1 cidade no scope do usuario
 *   - agent: so quando hasPermission('dashboard:read_by_agent')
 */
export function ReportFiltersBar({
  filters,
  availableScopes,
  availableCities,
  showAgentFilter,
  availableAgents,
}: ReportFiltersBarProps): React.JSX.Element {
  const showScopeToggle = availableScopes.length > 1;
  const showCityFilter =
    (filters.scope === 'city' || filters.scope === 'global') && availableCities.length > 1;
  const activeScopeOptions = SCOPE_OPTIONS.filter((o) => availableScopes.includes(o.value));

  return (
    <div
      className="sticky top-0 z-10 flex flex-wrap items-end gap-4 rounded-md border px-4 py-3"
      style={{
        background: 'var(--bg-elev-1)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--elev-2)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* 1. Range select */}
      <div className="flex flex-col gap-1">
        <FilterLabel htmlFor="report-range">Periodo</FilterLabel>
        <div className="relative">
          <select
            id="report-range"
            value={filters.range}
            onChange={(e) => filters.setRange(e.target.value as ReportRange)}
            className={selectClass}
            style={selectStyle}
          >
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronIcon />
        </div>
      </div>

      {/* 2. Scope toggle */}
      {showScopeToggle && (
        <div className="flex flex-col gap-1">
          <span
            className="font-sans font-semibold uppercase text-ink-3"
            style={{ fontSize: '0.68rem', letterSpacing: '0.1em' }}
          >
            Escopo
          </span>
          <ScopeToggle
            value={filters.scope}
            options={activeScopeOptions}
            onChange={filters.setScope}
          />
        </div>
      )}

      {/* 3. City multi-select */}
      {showCityFilter && (
        <div className="flex flex-col gap-1">
          <FilterLabel htmlFor="report-cities">Cidades</FilterLabel>
          <select
            id="report-cities"
            multiple
            size={Math.min(availableCities.length, 4)}
            value={filters.cityIds}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
              filters.setCityIds(selected);
            }}
            className="font-sans text-sm rounded-sm border px-3 py-1.5 focus:outline-none"
            style={{ ...selectStyle, minWidth: '160px' }}
          >
            {availableCities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {filters.cityIds.length > 0 && (
            <button
              type="button"
              onClick={() => filters.setCityIds([])}
              className="font-sans text-xs text-ink-3 hover:text-ink underline self-start"
            >
              Limpar
            </button>
          )}
        </div>
      )}

      {/* 4. Agent filter */}
      {showAgentFilter && availableAgents.length > 0 && (
        <div className="flex flex-col gap-1">
          <FilterLabel htmlFor="report-agents">Agente</FilterLabel>
          <div className="relative">
            <select
              id="report-agents"
              value={filters.agentIds[0] ?? ''}
              onChange={(e) => filters.setAgentIds(e.target.value ? [e.target.value] : [])}
              className={selectClass}
              style={{ ...selectStyle, minWidth: '160px' }}
            >
              <option value="">Todos os agentes</option>
              {availableAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </div>
        </div>
      )}

      {/* 5. Toggle vs periodo anterior */}
      <div className="flex items-end pb-0.5 ml-auto">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div className="relative flex-shrink-0" style={{ width: '34px', height: '18px' }}>
            <input
              type="checkbox"
              className="sr-only"
              checked={filters.compareWithPrevious}
              onChange={(e) => filters.setCompareWithPrevious(e.target.checked)}
            />
            <div
              className="absolute inset-0 rounded-pill transition-colors duration-fast"
              style={{
                background: filters.compareWithPrevious
                  ? 'var(--brand-verde)'
                  : 'var(--surface-muted)',
              }}
            />
            <div
              className="absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform duration-fast"
              style={{
                transform: filters.compareWithPrevious ? 'translateX(16px)' : 'translateX(0)',
              }}
            />
          </div>
          <span className="font-sans text-sm text-ink-2">vs periodo anterior</span>
        </label>
      </div>
    </div>
  );
}
