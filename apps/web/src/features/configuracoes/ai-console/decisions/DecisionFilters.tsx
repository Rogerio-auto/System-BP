// =============================================================================
// features/configuracoes/ai-console/decisions/DecisionFilters.tsx
//
// Painel de filtros para a lista de decisões do agente de IA.
// Filtros: data from/to, conversation_id, lead_id, intent, node, model.
// Estado sincronizado via URL querystring (chamador gerencia URLSearchParams).
//
// DS: inputs com inset shadow, border-border-strong, hover/focus em azul.
// Área clicável mínima 40px (WCAG). Todos os inputs com label semântica.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FilterValues {
  date_from: string;
  date_to: string;
  conversation_id: string;
  lead_id: string;
  intent: string;
  node: string;
  model: string;
}

interface DecisionFiltersProps {
  values: FilterValues;
  onChange: (key: keyof FilterValues, value: string) => void;
  onReset: () => void;
}

// ─── Primitivo de campo ───────────────────────────────────────────────────────

function FilterField({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={id}
        className="font-sans font-medium text-ink-3 uppercase tracking-widest"
        style={{ fontSize: '0.65rem' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// Classes de input reutilizáveis — DS canônico: inset shadow + border-strong
const inputCls = cn(
  'h-10 w-full px-3',
  'font-sans text-sm text-ink',
  'rounded-sm border border-border-strong',
  'bg-surface-1',
  'shadow-[inset_0_1px_2px_var(--border-inner-dark,rgba(0,0,0,0.06))]',
  'placeholder:text-ink-4',
  'focus:outline-none focus:border-azul',
  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.12),inset_0_1px_2px_rgba(0,0,0,0.06)]',
  'transition-[border-color,box-shadow] duration-[150ms] ease-out',
  'disabled:opacity-50 disabled:cursor-not-allowed',
);

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * Painel de filtros da lista de decisões do agente.
 * onChange notifica o pai que persiste na URL.
 */
export function DecisionFilters({
  values,
  onChange,
  onReset,
}: DecisionFiltersProps): React.JSX.Element {
  const hasActiveFilter = Object.values(values).some((v) => v.length > 0);

  return (
    <div
      className="rounded-lg border border-border p-4 flex flex-col gap-4"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
      aria-label="Filtros de decisões"
    >
      {/* Linha 1: datas */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <FilterField label="Data início" id="filter-date-from">
          <input
            id="filter-date-from"
            type="date"
            className={inputCls}
            value={values.date_from}
            onChange={(e) => onChange('date_from', e.target.value)}
            aria-label="Data de início do filtro"
          />
        </FilterField>

        <FilterField label="Data fim" id="filter-date-to">
          <input
            id="filter-date-to"
            type="date"
            className={inputCls}
            value={values.date_to}
            onChange={(e) => onChange('date_to', e.target.value)}
            aria-label="Data de fim do filtro"
          />
        </FilterField>

        <FilterField label="Conversa ID" id="filter-conversation-id">
          <input
            id="filter-conversation-id"
            type="text"
            className={inputCls}
            placeholder="ex: conv_abc123"
            value={values.conversation_id}
            onChange={(e) => onChange('conversation_id', e.target.value)}
            aria-label="Filtrar por ID de conversa"
          />
        </FilterField>

        <FilterField label="Lead ID" id="filter-lead-id">
          <input
            id="filter-lead-id"
            type="text"
            className={cn(inputCls, 'font-mono')}
            placeholder="UUID do lead"
            value={values.lead_id}
            onChange={(e) => onChange('lead_id', e.target.value)}
            aria-label="Filtrar por UUID do lead"
          />
        </FilterField>

        <FilterField label="Intent" id="filter-intent">
          <input
            id="filter-intent"
            type="text"
            className={inputCls}
            placeholder="ex: qualificação"
            value={values.intent}
            onChange={(e) => onChange('intent', e.target.value)}
            aria-label="Filtrar por intent do agente"
          />
        </FilterField>

        <FilterField label="Nó" id="filter-node">
          <input
            id="filter-node"
            type="text"
            className={inputCls}
            placeholder="ex: router"
            value={values.node}
            onChange={(e) => onChange('node', e.target.value)}
            aria-label="Filtrar por nó do grafo"
          />
        </FilterField>
      </div>

      {/* Linha 2: model + reset */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[160px] max-w-xs">
          <FilterField label="Modelo" id="filter-model">
            <input
              id="filter-model"
              type="text"
              className={cn(inputCls, 'font-mono')}
              placeholder="ex: claude-3-haiku"
              value={values.model}
              onChange={(e) => onChange('model', e.target.value)}
              aria-label="Filtrar por modelo de LLM"
            />
          </FilterField>
        </div>

        {hasActiveFilter && (
          <button
            type="button"
            onClick={onReset}
            className={cn(
              'h-10 px-4 rounded-sm border border-border',
              'font-sans text-sm font-medium text-ink-3',
              'bg-surface-1 hover:border-danger hover:text-danger',
              'transition-[border-color,color] duration-[150ms] ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
            aria-label="Limpar todos os filtros"
          >
            Limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}
