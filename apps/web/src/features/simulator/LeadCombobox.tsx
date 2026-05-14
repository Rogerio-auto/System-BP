// =============================================================================
// features/simulator/LeadCombobox.tsx — Combobox de seleção de lead (F2-S06).
//
// Busca live em GET /api/leads?q=<search>&limit=20.
// Debounce 300ms para evitar flood de requests.
// Mostra: nome + cidade (se disponível) + badge de status.
// DS: Input §9.2 + dropdown com elev-3, hover Spotlight.
// LGPD: não exibe CPF nem telefone completo — apenas nome + status.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import type { LeadResponse } from '../../hooks/crm/types';
import { STATUS_META } from '../../hooks/crm/types';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface LeadComboboxProps {
  value: string; // lead_id selecionado
  onChange: (leadId: string, lead: LeadResponse | null) => void;
  error?: string | undefined;
  disabled?: boolean;
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function searchLeads(q: string): Promise<LeadResponse[]> {
  if (!q.trim()) return [];
  const qs = new URLSearchParams({ q: q.trim(), limit: '20' });
  try {
    const resp = await api.get<{ data: LeadResponse[] }>(`/api/leads?${qs.toString()}`);
    return resp.data;
  } catch {
    return [];
  }
}

// ─── Hook debounced ───────────────────────────────────────────────────────────

function useLeadSearch(query: string) {
  const [debouncedQ, setDebouncedQ] = React.useState(query);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  return useQuery({
    queryKey: ['leads', 'search', debouncedQ],
    queryFn: () => searchLeads(debouncedQ),
    enabled: debouncedQ.length >= 2,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Combobox de leads com busca live.
 * Abre dropdown ao digitar ≥2 chars. Fecha ao selecionar ou perder foco.
 */
export function LeadCombobox({
  value,
  onChange,
  error,
  disabled,
}: LeadComboboxProps): React.JSX.Element {
  const [inputValue, setInputValue] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [selectedLead, setSelectedLead] = React.useState<LeadResponse | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data: results, isFetching } = useLeadSearch(inputValue);

  const hasError = Boolean(error);

  // Fecha ao clicar fora
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        // Restaura o label do lead selecionado se houver
        if (selectedLead) {
          setInputValue(selectedLead.name);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedLead]);

  // Sincroniza quando value é limpo externamente
  React.useEffect(() => {
    if (!value) {
      setSelectedLead(null);
      setInputValue('');
    }
  }, [value]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
    setOpen(true);
    if (!e.target.value) {
      setSelectedLead(null);
      onChange('', null);
    }
  }

  function handleSelect(lead: LeadResponse) {
    setSelectedLead(lead);
    setInputValue(lead.name);
    setOpen(false);
    onChange(lead.id, lead);
  }

  function handleInputFocus() {
    if (inputValue.length >= 2) setOpen(true);
  }

  const showDropdown = open && (results?.length || isFetching);
  const statusMeta = selectedLead ? STATUS_META[selectedLead.status] : null;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="lead-combobox"
        className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-3"
      >
        Lead
        <span className="ml-1 text-danger" aria-hidden="true">
          *
        </span>
      </label>

      <div ref={containerRef} className="relative">
        <div className="relative">
          {/* Ícone de busca */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 L14 14" />
            </svg>
          </span>

          <input
            ref={inputRef}
            id="lead-combobox"
            role="combobox"
            aria-expanded={Boolean(showDropdown)}
            aria-autocomplete="list"
            aria-controls="lead-combobox-listbox"
            aria-haspopup="listbox"
            type="text"
            autoComplete="off"
            disabled={disabled}
            value={inputValue}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            placeholder="Buscar lead por nome…"
            className={cn(
              'w-full font-sans text-sm font-medium text-ink',
              'bg-surface-1 rounded-sm pl-9 pr-[14px] py-[11px]',
              'border border-border-strong',
              'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
              'transition-[border-color,box-shadow,background] duration-fast ease',
              'placeholder:text-ink-4',
              'hover:border-ink-3 hover:bg-surface-hover',
              'focus:outline-none focus:border-azul',
              'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              'focus:bg-surface-1',
              hasError &&
                'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          />

          {/* Indicador de loading */}
          {isFetching && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
            >
              <span className="block w-3.5 h-3.5 rounded-full border-2 border-border-strong border-t-azul animate-spin" />
            </span>
          )}
        </div>

        {/* Dropdown */}
        {Boolean(showDropdown) && (
          <ul
            id="lead-combobox-listbox"
            role="listbox"
            aria-label="Leads encontrados"
            className={cn(
              'absolute z-50 top-full mt-1 w-full',
              'bg-surface-1 rounded-md border border-border',
              'overflow-hidden overflow-y-auto max-h-56',
            )}
            style={{ boxShadow: 'var(--elev-3)' }}
          >
            {results && results.length > 0
              ? results.map((lead) => {
                  const meta = STATUS_META[lead.status];
                  return (
                    <li
                      key={lead.id}
                      role="option"
                      aria-selected={lead.id === value}
                      onMouseDown={(e) => {
                        e.preventDefault(); // evita blur no input
                        handleSelect(lead);
                      }}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 cursor-pointer',
                        'transition-colors duration-fast ease',
                        'hover:bg-surface-hover',
                        lead.id === value && 'bg-surface-2',
                      )}
                    >
                      {/* Avatar inicial */}
                      <span
                        className="shrink-0 w-7 h-7 rounded-pill flex items-center justify-center font-sans font-bold text-[10px] text-white"
                        style={{ background: 'var(--grad-rondonia)', boxShadow: 'var(--elev-1)' }}
                        aria-hidden="true"
                      >
                        {lead.name.charAt(0).toUpperCase()}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="font-sans text-sm font-medium text-ink truncate">
                          {lead.name}
                        </p>
                        <p className="font-sans text-xs text-ink-3 truncate">{meta.label}</p>
                      </div>

                      {/* Checkmark se selecionado */}
                      {lead.id === value && (
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
                  );
                })
              : !isFetching && (
                  <li className="px-4 py-3 font-sans text-sm text-ink-3 text-center">
                    Nenhum lead encontrado
                  </li>
                )}
          </ul>
        )}
      </div>

      {/* Badge do lead selecionado */}
      {selectedLead && statusMeta && (
        <p className="font-sans text-xs text-ink-3">
          Selecionado: <span className="font-semibold text-ink">{selectedLead.name}</span>
          {' · '}
          <span
            style={{
              color: `var(--${statusMeta.variant === 'neutral' ? 'text-3' : statusMeta.variant})`,
            }}
          >
            {statusMeta.label}
          </span>
        </p>
      )}

      {hasError && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
