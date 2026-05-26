// =============================================================================
// components/comboboxes/CityCombobox.tsx — Combobox compartilhado de cidade.
//
// Busca live em GET /api/admin/cities?search=<termo>&limit=20.
// Debounce 300ms. Não dispara para queries < 2 chars.
//
// Exibe: nome (semibold) + state_uf + Badge "Inativa" quando is_active === false.
// LGPD: cidades não contêm PII (nome de município + UF). Sem redact necessário.
//
// DS: Input §9.2 + dropdown elev-3 + hover Spotlight + light-first + dark.
// =============================================================================

import type { CityResponse } from '@elemento/shared-schemas';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CityComboboxProps {
  value: string; // cityId selecionado
  onChange: (cityId: string, city: CityResponse | null) => void;
  error?: string | undefined;
  disabled?: boolean;
  label?: string;
  required?: boolean;
  placeholder?: string;
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function searchCities(search: string): Promise<CityResponse[]> {
  if (!search.trim()) return [];
  const qs = new URLSearchParams({ search: search.trim(), limit: '20' });
  try {
    const resp = await api.get<{ data: CityResponse[] }>(`/api/admin/cities?${qs.toString()}`);
    return resp.data;
  } catch {
    return [];
  }
}

// ─── Hook debounced ───────────────────────────────────────────────────────────

function useCitySearch(query: string) {
  const [debouncedQ, setDebouncedQ] = React.useState(query);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  return useQuery({
    queryKey: ['cities', 'search', debouncedQ],
    queryFn: () => searchCities(debouncedQ),
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Combobox de cidades com busca live.
 * Abre dropdown ao digitar >= 2 chars. Fecha ao selecionar ou perder foco.
 * Exibe: nome semibold + UF + badge "Inativa" quando is_active === false.
 */
export function CityCombobox({
  value,
  onChange,
  error,
  disabled,
  label = 'Cidade',
  required = false,
  placeholder = 'Buscar por nome da cidade…',
}: CityComboboxProps): React.JSX.Element {
  const [inputValue, setInputValue] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [selectedCity, setSelectedCity] = React.useState<CityResponse | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data: results, isFetching } = useCitySearch(inputValue);

  const hasError = Boolean(error);

  // Fecha ao clicar fora
  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (selectedCity) {
          setInputValue(selectedCity.name);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedCity]);

  // Sincroniza quando value é limpo externamente
  React.useEffect(() => {
    if (!value) {
      setSelectedCity(null);
      setInputValue('');
    }
  }, [value]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setInputValue(e.target.value);
    setOpen(true);
    if (!e.target.value) {
      setSelectedCity(null);
      onChange('', null);
    }
  }

  function handleSelect(city: CityResponse) {
    setSelectedCity(city);
    setInputValue(city.name);
    setOpen(false);
    onChange(city.id, city);
  }

  function handleInputFocus() {
    if (inputValue.length >= 2) setOpen(true);
  }

  const showDropdown = open && (results?.length || isFetching);

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="city-combobox"
        className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-3"
      >
        {label}
        {required && (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        )}
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
            id="city-combobox"
            role="combobox"
            aria-expanded={Boolean(showDropdown)}
            aria-autocomplete="list"
            aria-controls="city-combobox-listbox"
            aria-haspopup="listbox"
            type="text"
            autoComplete="off"
            disabled={disabled}
            value={inputValue}
            onChange={handleInputChange}
            onFocus={handleInputFocus}
            placeholder={placeholder}
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
            id="city-combobox-listbox"
            role="listbox"
            aria-label="Cidades encontradas"
            className={cn(
              'absolute z-50 top-full mt-1 w-full',
              'bg-surface-1 rounded-md border border-border',
              'overflow-hidden overflow-y-auto max-h-56',
            )}
            style={{ boxShadow: 'var(--elev-3)' }}
          >
            {results && results.length > 0
              ? results.map((city) => (
                  <li
                    key={city.id}
                    role="option"
                    aria-selected={city.id === value}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(city);
                    }}
                    className={cn(
                      'flex items-center gap-3 px-4 py-2.5 cursor-pointer',
                      'transition-colors duration-fast ease',
                      'hover:bg-surface-hover',
                      city.id === value && 'bg-surface-2',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-sans text-sm font-semibold text-ink truncate">
                        {city.name}
                      </p>
                      <p className="font-sans text-xs text-ink-3 truncate">{city.state_uf}</p>
                    </div>

                    {/* Badge inativa */}
                    {!city.is_active && <Badge variant="neutral">Inativa</Badge>}

                    {/* Checkmark se selecionado */}
                    {city.id === value && (
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
              : !isFetching && (
                  <li className="px-4 py-3 font-sans text-sm text-ink-3 text-center">
                    Nenhuma cidade encontrada
                  </li>
                )}
          </ul>
        )}
      </div>

      {/* Indicador da cidade selecionada */}
      {selectedCity && (
        <p className="font-sans text-xs text-ink-3">
          Selecionada:{' '}
          <span className="font-semibold text-ink">
            {selectedCity.name} — {selectedCity.state_uf}
          </span>
          {!selectedCity.is_active && (
            <>
              {' · '}
              <Badge variant="neutral">Inativa</Badge>
            </>
          )}
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
