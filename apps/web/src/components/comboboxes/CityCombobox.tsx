// =============================================================================
// components/comboboxes/CityCombobox.tsx — Combobox compartilhado de cidade.
//
// Fonte: GET /api/cities (endpoint PÚBLICO — qualquer usuário autenticado).
// Antes batia em /api/admin/cities (cities:manage) e dava 403 para
// gestor_regional/agente no painel de contato do live chat. O catálogo é
// pequeno (municípios da org) → busca client-side sobre a lista pública.
//
// Exibe: nome (semibold) + state_uf. O endpoint público só retorna cidades
// ativas, então não há badge "Inativa".
// LGPD: cidades não contêm PII (nome de município + UF). Sem redact necessário.
//
// DS: Input §9.2 + dropdown elev-3 + hover Spotlight + light-first + dark.
// =============================================================================

import * as React from 'react';

import type { CityPublic } from '../../hooks/useCitiesList';
import { useCitiesList } from '../../hooks/useCitiesList';
import { cn } from '../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface CityComboboxProps {
  value: string; // cityId selecionado
  onChange: (cityId: string, city: CityPublic | null) => void;
  error?: string | undefined;
  disabled?: boolean;
  label?: string;
  required?: boolean;
  placeholder?: string;
}

// ─── Normalização para busca (case/acento-insensível) ──────────────────────────

function normalize(s: string): string {
  // Decompõe acentos (NFD) e remove os combining marks (U+0300–U+036F).
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Combobox de cidades com busca local sobre a lista pública.
 * Abre dropdown ao focar/digitar. Fecha ao selecionar ou perder foco.
 * Exibe: nome semibold + UF.
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
  const [selectedCity, setSelectedCity] = React.useState<CityPublic | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { cities, isLoading } = useCitiesList();

  const hasError = Boolean(error);

  // Filtro client-side: a lista pública é pequena (municípios da org).
  const results = React.useMemo(() => {
    const q = normalize(inputValue.trim());
    const base = q ? cities.filter((c) => normalize(c.name).includes(q)) : cities;
    return base.slice(0, 50);
  }, [cities, inputValue]);

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

  function handleSelect(city: CityPublic) {
    setSelectedCity(city);
    setInputValue(city.name);
    setOpen(false);
    onChange(city.id, city);
  }

  function handleInputFocus() {
    setOpen(true);
  }

  const showDropdown = open && (results.length > 0 || isLoading);

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
          {isLoading && (
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
            {results.length > 0
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
              : !isLoading && (
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
