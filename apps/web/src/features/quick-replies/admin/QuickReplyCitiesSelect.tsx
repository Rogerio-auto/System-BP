// =============================================================================
// features/quick-replies/admin/QuickReplyCitiesSelect.tsx — Multi-select de
// cidades para o cadastro de resposta rápida (F28-S07).
//
// Variante simplificada de features/admin/agents/AgentCitiesSelect.tsx (sem
// "cidade primária" — aqui `cityIds` vazio já tem semântica própria: visível
// em todas as cidades, doc 25 §4 D6). Não importa o componente de agentes
// diretamente — arquivo fora de `files_allowed` deste slot.
// =============================================================================

import * as React from 'react';

import { useCities } from '../../../hooks/admin/useCities';
import { cn } from '../../../lib/cn';

interface QuickReplyCitiesSelectProps {
  value: string[];
  onChange: (cityIds: string[]) => void;
  disabled?: boolean;
}

/**
 * Multi-select de cidades. Vazio = visível em todas as cidades (doc 25 §4 D6)
 * — o helper text deixa isso explícito para não parecer um campo obrigatório.
 */
export function QuickReplyCitiesSelect({
  value,
  onChange,
  disabled = false,
}: QuickReplyCitiesSelectProps): React.JSX.Element {
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

  const citiesParams = searchDebounced
    ? { search: searchDebounced, is_active: true as const, limit: 50 }
    : { is_active: true as const, limit: 50 };

  const { data: citiesData, isLoading: citiesLoading } = useCities(citiesParams);
  // Busca fixa para labels das já selecionadas — pode não estar no resultado de busca.
  const { data: allCitiesData } = useCities({ is_active: true as const, limit: 300 });

  const availableCities = (citiesData?.data ?? []).filter((c) => !value.includes(c.id));
  const allCitiesForLabels = allCitiesData?.data ?? [];

  function getCityName(id: string): string {
    const city = allCitiesForLabels.find((c) => c.id === id);
    return city ? city.name : id.slice(0, 8) + '…';
  }

  function addCity(cityId: string): void {
    onChange([...value, cityId]);
    setSearch('');
    setSearchDebounced('');
  }

  function removeCity(cityId: string): void {
    onChange(value.filter((id) => id !== cityId));
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((cityId) => (
            <div
              key={cityId}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm',
                'font-sans text-xs font-semibold',
                'border border-border text-ink-2 bg-surface-hover',
              )}
            >
              <span>{getCityName(cityId)}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeCity(cityId)}
                  aria-label={`Remover cidade ${getCityName(cityId)}`}
                  className={cn(
                    'flex items-center justify-center w-4 h-4 rounded-pill',
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
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2 rounded-sm text-sm text-left',
              'border border-border-strong text-ink-3 hover:border-ink-3 hover:text-ink',
              'font-sans font-medium transition-[border-color,box-shadow] duration-fast ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
            style={{
              background: 'var(--bg-elev-1)',
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
            <span>Restringir a uma cidade</span>
          </button>

          {open && (
            <div
              role="listbox"
              aria-label="Cidades disponíveis"
              className="absolute top-full left-0 mt-1 w-full rounded-sm border border-border z-20"
              style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
            >
              <div className="px-3 py-2 border-b border-border-subtle">
                <input
                  type="text"
                  placeholder="Buscar cidade..."
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="w-full font-sans text-sm text-ink bg-transparent focus:outline-none placeholder:text-ink-4"
                  autoFocus
                />
              </div>
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
                        'font-sans text-sm text-ink-2 hover:text-ink hover:bg-surface-hover',
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

      <p className="font-sans text-xs text-ink-4">
        {value.length === 0
          ? 'Sem restrição: visível em todas as cidades.'
          : 'Visível apenas nas cidades selecionadas.'}
      </p>
    </div>
  );
}
