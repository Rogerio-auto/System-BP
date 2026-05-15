// =============================================================================
// features/admin/agents/AgentCitiesSelect.tsx — Multi-select de cidades para agente.
//
// DS:
//   - Chips com botão "star" para definir como primária (--grad-rondonia destacado).
//   - Chip primária com borda azul + gradiente suave.
//   - Busca com debounce 300ms no dropdown.
//   - Elev-3 no dropdown.
//   - Validação: ≥1 cidade obrigatória.
// =============================================================================

import * as React from 'react';

import { useCities } from '../../../hooks/admin/useCities';
import { cn } from '../../../lib/cn';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface AgentCitiesValue {
  cityIds: string[];
  primaryCityId: string | null;
}

interface AgentCitiesSelectProps {
  value: AgentCitiesValue;
  onChange: (value: AgentCitiesValue) => void;
  disabled?: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Ícone estrela
// ---------------------------------------------------------------------------

function StarIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <path d="M8 1L9.9 5.8 15 6.3 11.2 9.8 12.4 15 8 12.3 3.6 15 4.8 9.8 1 6.3 6.1 5.8Z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * Multi-select de cidades para agente.
 * Cada chip tem botão star para definir como primária.
 * A primária fica destacada com border azul + --grad-rondonia.
 */
export function AgentCitiesSelect({
  value,
  onChange,
  disabled = false,
  error,
}: AgentCitiesSelectProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = (v: string): void => {
    setSearch(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchDebounced(v), 300);
  };

  React.useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // Fechar ao clicar fora
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fechar com Escape
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const citiesParams = searchDebounced
    ? { search: searchDebounced, is_active: true as const, limit: 50 }
    : { is_active: true as const, limit: 50 };

  const { data: citiesData, isLoading: citiesLoading } = useCities(citiesParams);

  // Busca fixa para labels das selecionadas (pode não estar no resultado de busca)
  const { data: allCitiesData } = useCities({ is_active: true as const, limit: 300 });

  const allCities = citiesData?.data ?? [];
  const allCitiesForLabels = allCitiesData?.data ?? [];

  const availableCities = allCities.filter((c) => !value.cityIds.includes(c.id));

  function getCityName(id: string): string {
    const city = allCitiesForLabels.find((c) => c.id === id);
    return city ? city.name : id.slice(0, 8) + '…';
  }

  function addCity(cityId: string): void {
    const newCityIds = [...value.cityIds, cityId];
    // Se for a primeira cidade, torna primária automaticamente
    const newPrimary = value.primaryCityId ?? cityId;
    onChange({ cityIds: newCityIds, primaryCityId: newPrimary });
    setSearch('');
    setSearchDebounced('');
  }

  function removeCity(cityId: string): void {
    const newCityIds = value.cityIds.filter((id) => id !== cityId);
    // Se a primária foi removida, assume a primeira restante (ou null se vazio)
    const newPrimary =
      value.primaryCityId === cityId ? (newCityIds[0] ?? null) : value.primaryCityId;
    onChange({ cityIds: newCityIds, primaryCityId: newPrimary });
  }

  function setPrimary(cityId: string): void {
    onChange({ cityIds: value.cityIds, primaryCityId: cityId });
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {/* Chips das cidades selecionadas */}
      {value.cityIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.cityIds.map((cityId) => {
            const isPrimary = value.primaryCityId === cityId;
            return (
              <div
                key={cityId}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm',
                  'font-sans text-xs font-semibold',
                  'border transition-all duration-fast',
                  isPrimary
                    ? 'text-white border-azul/50'
                    : 'border-border text-ink-2 bg-surface-hover',
                )}
                style={
                  isPrimary
                    ? { background: 'var(--grad-rondonia)', boxShadow: 'var(--elev-1)' }
                    : undefined
                }
              >
                {/* Star — definir como primária */}
                {!disabled && (
                  <button
                    type="button"
                    title={isPrimary ? 'Cidade primária' : 'Definir como primária'}
                    aria-label={
                      isPrimary
                        ? `${getCityName(cityId)} — cidade primária`
                        : `Definir ${getCityName(cityId)} como primária`
                    }
                    onClick={() => setPrimary(cityId)}
                    className={cn(
                      'flex items-center justify-center w-4 h-4 rounded-pill',
                      'transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-azul/40',
                      isPrimary
                        ? 'text-amarelo'
                        : 'text-ink-4 hover:text-amarelo',
                    )}
                  >
                    <StarIcon filled={isPrimary} />
                  </button>
                )}

                <span>{getCityName(cityId)}</span>

                {/* Remover cidade */}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeCity(cityId)}
                    aria-label={`Remover cidade ${getCityName(cityId)}`}
                    className={cn(
                      'flex items-center justify-center w-4 h-4 rounded-pill',
                      'transition-colors duration-fast',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-azul/30',
                      isPrimary
                        ? 'text-white/70 hover:text-white'
                        : 'text-ink-3 hover:text-danger hover:bg-danger/10',
                    )}
                  >
                    <svg
                      viewBox="0 0 12 12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      className="w-2.5 h-2.5"
                      aria-hidden="true"
                    >
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Trigger + dropdown */}
      {!disabled && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm text-left',
              'border transition-[border-color,box-shadow] duration-fast ease',
              'font-sans font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              error
                ? 'border-danger text-danger'
                : 'border-border-strong text-ink-3 hover:border-ink-3 hover:text-ink',
            )}
            style={{
              background: 'var(--surface-1)',
              boxShadow: 'inset 0 1px 2px var(--border-inner-dark)',
            }}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4 shrink-0"
              aria-hidden="true"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            <span>Adicionar cidade</span>
          </button>

          {open && (
            <div
              role="listbox"
              aria-label="Cidades disponíveis"
              className="absolute top-full left-0 mt-1 w-full rounded-sm border border-border z-20"
              style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
            >
              {/* Busca inline */}
              <div className="px-3 py-2 border-b border-border-subtle">
                <input
                  type="text"
                  placeholder="Buscar cidade..."
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className={cn(
                    'w-full font-sans text-sm text-ink bg-transparent',
                    'focus:outline-none placeholder:text-ink-4',
                  )}
                  autoFocus
                />
              </div>

              {/* Lista */}
              <div className="max-h-48 overflow-y-auto">
                {citiesLoading ? (
                  <div className="px-4 py-3 text-xs text-ink-3 font-sans">Carregando...</div>
                ) : availableCities.length === 0 ? (
                  <div className="px-4 py-3 text-xs text-ink-4 font-sans italic">
                    {searchDebounced ? 'Nenhuma cidade encontrada' : 'Todas as cidades adicionadas'}
                  </div>
                ) : (
                  availableCities.map((city) => (
                    <button
                      key={city.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => addCity(city.id)}
                      className={cn(
                        'flex items-center w-full px-4 py-2.5',
                        'font-sans text-sm text-ink-2 hover:text-ink',
                        'hover:bg-surface-hover',
                        'transition-colors duration-fast text-left',
                        'focus-visible:outline-none focus-visible:bg-surface-hover',
                      )}
                    >
                      <span className="flex-1">{city.name}</span>
                      <span className="text-xs text-ink-4 ml-2">{city.state_uf}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Helper text */}
      {value.cityIds.length > 0 && !disabled && (
        <p className="font-sans text-xs text-ink-4">
          Clique na estrela para definir a cidade primária do agente.
        </p>
      )}

      {error && <span className="text-xs text-danger font-sans">{error}</span>}
    </div>
  );
}
