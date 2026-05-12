// =============================================================================
// components/kanban/KanbanFilters.tsx — Barra de filtros do Kanban.
//
// Filtros: cidade (Select), agente (Select), faixa de valor (Input range),
// range de data (Input date). Compactos, usando tokens DS.
// Integra com KanbanFilters do hook sem React Hook Form (filtros simples).
// =============================================================================

import * as React from 'react';

import type { KanbanFilters } from '../../hooks/kanban/types';
import { cn } from '../../lib/cn';

// ── Tipos ─────────────────────────────────────────────────────────────────────

interface CityOption {
  id: string;
  name: string;
}

interface AgentOption {
  id: string;
  name: string;
}

interface KanbanFiltersBarProps {
  filters: KanbanFilters;
  onChange: (filters: KanbanFilters) => void;
  cities?: CityOption[] | undefined;
  agents?: AgentOption[] | undefined;
}

// ── Utilitários de estilo ─────────────────────────────────────────────────────

const selectClass = cn(
  'font-sans text-xs font-medium text-ink',
  'bg-[var(--bg-elev-1)] rounded-xs px-2 py-1.5',
  'border border-border-strong',
  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
  'transition-[border-color,box-shadow] duration-fast ease',
  'hover:border-ink-3',
  'focus:outline-none focus:border-azul',
  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'cursor-pointer min-h-[32px]',
);

const inputClass = cn(
  'font-sans text-xs font-medium text-ink',
  'bg-[var(--bg-elev-1)] rounded-xs px-2 py-1.5',
  'border border-border-strong',
  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
  'transition-[border-color,box-shadow] duration-fast ease',
  'placeholder:text-ink-4',
  'hover:border-ink-3',
  'focus:outline-none focus:border-azul',
  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
  'min-h-[32px]',
);

// ── Componente ────────────────────────────────────────────────────────────────

/**
 * Barra de filtros compacta para o Kanban.
 * Todos os filtros são opcionais e atualizam o estado pai imediatamente.
 */
export function KanbanFiltersBar({
  filters,
  onChange,
  cities = [],
  agents = [],
}: KanbanFiltersBarProps): React.JSX.Element {
  const handleCity = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    onChange({ ...filters, cityId: e.target.value || undefined });
  };

  const handleAgent = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    onChange({ ...filters, agentId: e.target.value || undefined });
  };

  const handleMinAmount = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = e.target.value ? Number(e.target.value) * 100 : undefined;
    onChange({ ...filters, minAmountCents: val });
  };

  const handleMaxAmount = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = e.target.value ? Number(e.target.value) * 100 : undefined;
    onChange({ ...filters, maxAmountCents: val });
  };

  const handleDateFrom = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...filters, dateFrom: e.target.value || undefined });
  };

  const handleDateTo = (e: React.ChangeEvent<HTMLInputElement>): void => {
    onChange({ ...filters, dateTo: e.target.value || undefined });
  };

  const hasActiveFilters = Boolean(
    filters.cityId ||
      filters.agentId ||
      filters.minAmountCents !== undefined ||
      filters.maxAmountCents !== undefined ||
      filters.dateFrom ||
      filters.dateTo,
  );

  const handleClear = (): void => {
    onChange({});
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-md border border-border bg-[var(--bg-elev-1)]"
      style={{ boxShadow: 'var(--elev-1)' }}
      role="search"
      aria-label="Filtros do Kanban"
    >
      {/* Label caption */}
      <span
        className="font-sans font-bold text-ink-3 uppercase tracking-wider mr-1 hidden sm:block"
        style={{ fontSize: 'var(--text-xs)' }}
      >
        Filtros
      </span>

      {/* Cidade */}
      <label className="flex flex-col gap-0.5">
        <span className="sr-only">Cidade</span>
        <select
          className={selectClass}
          value={filters.cityId ?? ''}
          onChange={handleCity}
          aria-label="Filtrar por cidade"
        >
          <option value="">Todas as cidades</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {/* Agente */}
      <label className="flex flex-col gap-0.5">
        <span className="sr-only">Agente</span>
        <select
          className={selectClass}
          value={filters.agentId ?? ''}
          onChange={handleAgent}
          aria-label="Filtrar por agente"
        >
          <option value="">Todos os agentes</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      {/* Faixa de valor */}
      <div className="flex items-center gap-1" aria-label="Faixa de valor em R$">
        <input
          type="number"
          className={cn(inputClass, 'w-24')}
          placeholder="R$ Mín"
          min={0}
          step={1000}
          value={filters.minAmountCents !== undefined ? filters.minAmountCents / 100 : ''}
          onChange={handleMinAmount}
          aria-label="Valor mínimo em reais"
        />
        <span className="text-ink-4 text-xs font-sans">—</span>
        <input
          type="number"
          className={cn(inputClass, 'w-24')}
          placeholder="R$ Máx"
          min={0}
          step={1000}
          value={filters.maxAmountCents !== undefined ? filters.maxAmountCents / 100 : ''}
          onChange={handleMaxAmount}
          aria-label="Valor máximo em reais"
        />
      </div>

      {/* Range de data */}
      <div className="flex items-center gap-1" aria-label="Período">
        <input
          type="date"
          className={cn(inputClass, 'w-36')}
          value={filters.dateFrom ?? ''}
          onChange={handleDateFrom}
          aria-label="Data inicial"
        />
        <span className="text-ink-4 text-xs font-sans">—</span>
        <input
          type="date"
          className={cn(inputClass, 'w-36')}
          value={filters.dateTo ?? ''}
          onChange={handleDateTo}
          aria-label="Data final"
        />
      </div>

      {/* Limpar filtros */}
      {hasActiveFilters && (
        <button
          type="button"
          className={cn(
            'font-sans text-xs font-semibold text-danger',
            'px-2 py-1.5 rounded-xs',
            'hover:bg-[var(--danger-bg)] transition-colors duration-fast ease',
            'focus-visible:ring-2 focus-visible:ring-danger/30',
            'min-h-[32px]',
          )}
          onClick={handleClear}
          aria-label="Limpar filtros"
        >
          Limpar
        </button>
      )}
    </div>
  );
}
