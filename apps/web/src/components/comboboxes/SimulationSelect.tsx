// =============================================================================
// components/comboboxes/SimulationSelect.tsx — Select de simulações de um lead.
//
// Lista cronológica (mais recente primeiro) via GET /api/leads/:leadId/simulations.
// Sem campo de busca livre — lista fixa de até 20 simulações.
// Disabled com hint quando leadId está vazio.
//
// Exibe: "R$ X.XXX,XX × N meses" + data relativa + Badge "Atual" se is_current.
// LGPD: simulações não contêm PII — apenas dados financeiros + metadados.
//
// DS: dropdown elev-3 + hover Spotlight + light-first + dark.
// =============================================================================

import * as React from 'react';

import type { LeadSimulation } from '../../hooks/crm/types';
import { formatBRL, formatRelativeDate } from '../../hooks/crm/types';
import { useLeadSimulations } from '../../hooks/crm/useLeadSimulations';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SimulationSelectProps {
  leadId: string | null;
  value: string; // simulationId selecionado
  onChange: (simulationId: string, simulation: LeadSimulation | null) => void;
  error?: string | undefined;
  disabled?: boolean;
  label?: string;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Select de simulações de um lead.
 * Disabled com hint "Selecione um lead primeiro" quando leadId vazio.
 * Sem campo de busca — lista cronológica de até 20 simulações.
 */
export function SimulationSelect({
  leadId,
  value,
  onChange,
  error,
  disabled,
  label = 'Simulação vinculada',
}: SimulationSelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [selectedSimulation, setSelectedSimulation] = React.useState<LeadSimulation | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  const isDisabled = disabled || !leadId;
  const hasError = Boolean(error);

  const { simulations, isLoading } = useLeadSimulations(leadId ?? '');

  // Fecha ao clicar fora
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Guarda referência estável ao callback para evitar loop infinito.
  // O parent pode passar callback inline (nova ref a cada render); colocá-lo
  // direto na dep list do effect abaixo causaria Maximum update depth exceeded.
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Sincroniza quando leadId muda (resetar seleção)
  React.useEffect(() => {
    if (!leadId) {
      setSelectedSimulation(null);
      onChangeRef.current('', null);
    }
  }, [leadId]);

  // Sincroniza quando value é limpo externamente
  React.useEffect(() => {
    if (!value) {
      setSelectedSimulation(null);
    }
  }, [value]);

  function handleSelect(sim: LeadSimulation) {
    setSelectedSimulation(sim);
    setOpen(false);
    onChange(sim.id, sim);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedSimulation(null);
    onChange('', null);
  }

  function formatSimulationLabel(sim: LeadSimulation): string {
    return `${formatBRL(sim.amount)} × ${sim.termMonths} meses`;
  }

  const triggerLabel = selectedSimulation
    ? formatSimulationLabel(selectedSimulation)
    : !leadId
      ? 'Selecione um lead primeiro'
      : 'Selecionar simulação…';

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="simulation-select-trigger"
        className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-3"
      >
        {label}
      </label>

      <div ref={containerRef} className="relative">
        {/* Trigger — botão estilo combobox */}
        <button
          ref={buttonRef}
          id="simulation-select-trigger"
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls="simulation-select-listbox"
          disabled={isDisabled}
          onClick={() => {
            if (!isDisabled) setOpen((v) => !v);
          }}
          className={cn(
            'w-full flex items-center justify-between gap-2',
            'font-sans text-sm font-medium text-left',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            hasError &&
              'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border-strong disabled:hover:bg-surface-1',
            selectedSimulation ? 'text-ink' : 'text-ink-4',
          )}
        >
          <span className="truncate">{triggerLabel}</span>

          <span className="flex items-center gap-1.5 shrink-0">
            {/* Botão de limpar */}
            {selectedSimulation && !isDisabled && (
              <span
                role="button"
                aria-label="Limpar simulação selecionada"
                onClick={handleClear}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedSimulation(null);
                    onChange('', null);
                  }
                }}
                tabIndex={0}
                className="flex items-center justify-center w-4 h-4 rounded-xs text-ink-3 hover:text-danger transition-colors duration-fast focus:outline-none focus:ring-1 focus:ring-azul/30"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="w-3 h-3"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </span>
            )}

            {/* Indicador de loading */}
            {isLoading && leadId && (
              <span
                className="block w-3.5 h-3.5 rounded-full border-2 border-border-strong border-t-azul animate-spin"
                aria-hidden="true"
              />
            )}

            {/* Chevron */}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className={cn(
                'w-4 h-4 text-ink-3 transition-transform duration-[150ms]',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            >
              <path d="M4 6l4 4 4-4" />
            </svg>
          </span>
        </button>

        {/* Dropdown */}
        {open && !isDisabled && (
          <ul
            id="simulation-select-listbox"
            role="listbox"
            aria-label="Simulações do lead"
            className={cn(
              'absolute z-50 top-full mt-1 w-full',
              'bg-surface-1 rounded-md border border-border',
              'overflow-hidden overflow-y-auto max-h-64',
            )}
            style={{ boxShadow: 'var(--elev-3)' }}
          >
            {simulations.length > 0 ? (
              simulations.map((sim) => (
                <li
                  key={sim.id}
                  role="option"
                  aria-selected={sim.id === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(sim);
                  }}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 cursor-pointer',
                    'transition-colors duration-fast ease',
                    'hover:bg-surface-hover',
                    sim.id === value && 'bg-surface-2',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold text-ink">
                      {formatSimulationLabel(sim)}
                    </p>
                    <p className="font-sans text-xs text-ink-3 truncate">
                      {formatRelativeDate(sim.createdAt)} · {sim.productName}
                    </p>
                  </div>

                  {/* Checkmark se selecionado */}
                  {sim.id === value && (
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-4 h-4 shrink-0 text-azul"
                    >
                      <path d="M3 8l3.5 3.5L13 4" />
                    </svg>
                  )}
                </li>
              ))
            ) : !isLoading ? (
              <li className="px-4 py-3 font-sans text-sm text-ink-3 text-center">
                Nenhuma simulação encontrada para este lead
              </li>
            ) : (
              <li className="px-4 py-3 font-sans text-sm text-ink-3 text-center">
                Carregando simulações…
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Hint quando sem lead */}
      {!leadId && !hasError && (
        <p className="font-sans text-xs text-ink-4">Selecione um lead primeiro</p>
      )}

      {hasError && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}

      {/* Info da simulação selecionada */}
      {selectedSimulation && (
        <p className="font-sans text-xs text-ink-3">
          Selecionada:{' '}
          <span className="font-mono font-semibold text-ink">
            {formatSimulationLabel(selectedSimulation)}
          </span>
          {' · '}
          <Badge variant="neutral">{selectedSimulation.productName}</Badge>
        </p>
      )}
    </div>
  );
}
