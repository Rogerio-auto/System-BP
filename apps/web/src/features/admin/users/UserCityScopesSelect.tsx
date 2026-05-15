// =============================================================================
// features/admin/users/UserCityScopesSelect.tsx — Multi-select de cidades.
//
// DS:
//   - Chips de cidades selecionadas (Badge neutral)
//   - Busca com debounce 300ms
//   - Se user tem role global → mostra caption "Acesso global" + desabilita
//   - Elev-3 no dropdown
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import { useCities } from '../../../hooks/admin/useCities';
import { cn } from '../../../lib/cn';

interface UserCityScopesSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  isGlobal?: boolean;
  error?: string;
}

/**
 * Multi-select de cidades para escopo do usuário.
 * Quando isGlobal=true, desabilita e mostra aviso.
 */
export function UserCityScopesSelect({
  value,
  onChange,
  disabled = false,
  isGlobal = false,
  error,
}: UserCityScopesSelectProps): React.JSX.Element {
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

  const allCities = citiesData?.data ?? [];
  const availableCities = allCities.filter((c) => !value.includes(c.id));

  // Também buscar cidades selecionadas (que podem não estar na busca atual)
  const { data: selectedCitiesData } = useCities({
    limit: 100,
    is_active: true,
  });

  const allCitiesForLabels = selectedCitiesData?.data ?? [];

  function getCityLabel(id: string): string {
    const city = allCitiesForLabels.find((c) => c.id === id);
    return city ? `${city.name}` : id.slice(0, 8) + '…';
  }

  if (isGlobal) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2.5 rounded-sm border border-border"
        style={{ background: 'var(--info-bg)' }}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="w-4 h-4 shrink-0"
          style={{ color: 'var(--info)' }}
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c-1.5 2-2.5 3.8-2.5 6s1 4 2.5 6M8 2c1.5 2 2.5 3.8 2.5 6s-1 4-2.5 6" />
        </svg>
        <p className="font-sans text-sm text-ink-2">
          Esta role tem <strong>acesso global</strong> — escopo de cidades não aplicável.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {/* Chips das cidades selecionadas */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((cityId) => (
            <span key={cityId} className="inline-flex items-center gap-1">
              <Badge variant="neutral">{getCityLabel(cityId)}</Badge>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((id) => id !== cityId))}
                  aria-label={`Remover cidade ${getCityLabel(cityId)}`}
                  className={cn(
                    'w-4 h-4 flex items-center justify-center rounded-pill',
                    'text-ink-3 hover:text-danger hover:bg-danger/10',
                    'transition-colors duration-fast',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-azul/30',
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
            </span>
          ))}
        </div>
      )}

      {/* Trigger + busca */}
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
                      onClick={() => {
                        onChange([...value, city.id]);
                        setSearch('');
                        setSearchDebounced('');
                      }}
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

      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
