// =============================================================================
// pages/admin/Cities.tsx — Administração de cidades (/admin/cities).
//
// DS:
//   - Tabela densa: elev-1, hover de linha (translateY -1px + elev-2 discreto).
//   - Tipografia: Bricolage (header), Geist (body), JetBrains Mono (ibge_code, slug).
//   - Cores: --brand-azul (primário), --brand-verde (ativo), --danger (delete).
//   - Modal: CityFormModal (Portal, elev-5, fade-up).
//   - Loading: skeleton de 5 linhas (nunca spinner solitário).
//   - Empty: SVG inline + mensagem.
//   - Erro: card vermelho + retry.
//   - Paginação: mesmo padrão do CrmListPage.
//
// RBAC: rota protegida em App.tsx (AuthGuard); o backend valida admin:cities:write.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { CityFormModal } from '../../features/admin/cities/CityFormModal';
import { useCities } from '../../hooks/admin/useCities';
import { useDeleteCity, useUpdateCity } from '../../hooks/admin/useCityMutations';
import { cn } from '../../lib/cn';

// ─── Constantes ───────────────────────────────────────────────────────────────

const UF_FILTER_OPTIONS = [
  { value: '', label: 'Todos os estados' },
  { value: 'RO', label: 'RO — Rondônia' },
  { value: 'AC', label: 'AC — Acre' },
  { value: 'AM', label: 'AM — Amazonas' },
  { value: 'PA', label: 'PA — Pará' },
  { value: 'MT', label: 'MT — Mato Grosso' },
  { value: 'MS', label: 'MS — Mato Grosso do Sul' },
  { value: 'GO', label: 'GO — Goiás' },
  { value: 'TO', label: 'TO — Tocantins' },
  { value: 'MA', label: 'MA — Maranhão' },
  { value: 'PI', label: 'PI — Piauí' },
  { value: 'CE', label: 'CE — Ceará' },
  { value: 'RN', label: 'RN — Rio Grande do Norte' },
  { value: 'PB', label: 'PB — Paraíba' },
  { value: 'PE', label: 'PE — Pernambuco' },
  { value: 'AL', label: 'AL — Alagoas' },
  { value: 'SE', label: 'SE — Sergipe' },
  { value: 'BA', label: 'BA — Bahia' },
  { value: 'MG', label: 'MG — Minas Gerais' },
  { value: 'ES', label: 'ES — Espírito Santo' },
  { value: 'RJ', label: 'RJ — Rio de Janeiro' },
  { value: 'SP', label: 'SP — São Paulo' },
  { value: 'PR', label: 'PR — Paraná' },
  { value: 'SC', label: 'SC — Santa Catarina' },
  { value: 'RS', label: 'RS — Rio Grande do Sul' },
  { value: 'AP', label: 'AP — Amapá' },
  { value: 'RR', label: 'RR — Roraima' },
  { value: 'DF', label: 'DF — Distrito Federal' },
];

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'true', label: 'Ativas' },
  { value: 'false', label: 'Inativas' },
];

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          <td className="pl-5 pr-4 py-4">
            <div
              className="h-4 rounded-xs animate-pulse"
              style={{ width: 120 + ((i * 23) % 80), background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4">
            <div
              className="h-4 w-8 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4 hidden md:table-cell">
            <div
              className="h-4 w-20 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4 hidden lg:table-cell">
            <div
              className="h-4 w-32 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4">
            <div
              className="h-5 w-14 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 pr-5 py-4">
            <div className="flex gap-2 justify-end">
              <div
                className="h-5 w-9 rounded-full animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
              <div
                className="h-8 w-8 rounded-sm animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <svg
            viewBox="0 0 120 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-28 h-auto opacity-40"
            aria-hidden="true"
          >
            <ellipse cx="60" cy="88" rx="46" ry="7" fill="var(--surface-muted)" />
            <path
              d="M60 15 L90 35 L85 70 L60 80 L35 70 L30 35 Z"
              fill="var(--bg-elev-2)"
              stroke="var(--border-strong)"
              strokeWidth="1.5"
            />
            <path
              d="M60 15 L90 35 L85 70"
              stroke="var(--border-strong)"
              strokeWidth="1"
              strokeDasharray="4 3"
            />
            <circle cx="60" cy="48" r="7" fill="var(--brand-azul)" opacity="0.3" />
            <circle cx="60" cy="48" r="3" fill="var(--brand-azul)" />
          </svg>

          <div className="flex flex-col gap-1">
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
            >
              Nenhuma cidade encontrada
            </p>
            <p className="font-sans text-sm text-ink-3 max-w-xs">
              Cadastre as cidades atendidas pelo programa para associá-las aos leads.
            </p>
          </div>

          <Button variant="primary" onClick={onAdd}>
            Cadastrar primeira cidade
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * CitiesPage — /admin/cities
 * Lista paginada de cidades com busca, filtros, toggle de status e soft-delete.
 * Criação/edição via CityFormModal.
 *
 * Requer role `admin` com permissão `admin:cities:write` (verificada no backend).
 */
export function CitiesPage(): React.JSX.Element {
  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [stateUf, setStateUf] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | undefined>(undefined);

  // Debounce da busca — 300ms
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string): void => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchDebounced(value);
      setPage(1);
    }, 300);
  };

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Construir params tipados corretamente (exactOptionalPropertyTypes: true).
  // Propriedades opcionais não podem receber `undefined` explicitamente —
  // precisam ser omitidas ou ter valor concreto.
  const citiesParams = React.useMemo(() => {
    const p: Parameters<typeof useCities>[0] = { page, limit: 20 };
    if (searchDebounced) p.search = searchDebounced;
    if (stateUf) p.state_uf = stateUf;
    if (statusFilter === 'true') p.is_active = true;
    else if (statusFilter === 'false') p.is_active = false;
    return p;
  }, [page, searchDebounced, stateUf, statusFilter]);

  const { data, isLoading, isError, refetch } = useCities(citiesParams);

  // Mutations — instanciadas aqui e passadas via props para manter 1 instância.
  const { updateCity } = useUpdateCity();
  const { deleteCity, isPending: isDeletePending, pendingId: deletePendingId } = useDeleteCity();

  const cities = data?.data ?? [];
  const pagination = data?.pagination;

  function openCreate(): void {
    setEditId(undefined);
    setModalOpen(true);
  }

  function openEdit(id: string): void {
    setEditId(id);
    setModalOpen(true);
  }

  function handleToggleStatus(cityId: string, current: boolean): void {
    updateCity(cityId, { is_active: !current });
  }

  function handleDelete(cityId: string, cityName: string): void {
    if (
      window.confirm(
        `Remover "${cityName}"?\n\nEsta ação é reversível (soft-delete) mas a cidade não aparecerá mais nos atendimentos.`,
      )
    ) {
      deleteCity(cityId);
    }
  }

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-3xl)',
                letterSpacing: '-0.04em',
                fontVariationSettings: "'opsz' 48",
              }}
            >
              Cidades
            </h1>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Gerencie os municípios atendidos pelo programa.
            </p>
          </div>

          <Button
            variant="primary"
            onClick={openCreate}
            leftIcon={
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
            }
          >
            Nova cidade
          </Button>
        </div>

        {/* ── Filtros ─────────────────────────────────────────────────────────── */}
        <div
          className="flex flex-wrap gap-3 items-end"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
        >
          <div className="flex-1 min-w-[200px]">
            <Input
              id="cities-search"
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              wrapperClassName="w-full"
            />
          </div>

          <div className="w-[180px]">
            <Select
              id="cities-uf"
              options={UF_FILTER_OPTIONS}
              value={stateUf}
              onChange={(e) => {
                setStateUf(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="w-[160px]">
            <Select
              id="cities-status"
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {/* ── Tabela ──────────────────────────────────────────────────────────── */}
        <div
          className="rounded-md border border-border overflow-hidden"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-1)',
            animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both',
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  {[
                    { label: 'Nome', className: 'pl-5 pr-4 w-[240px]' },
                    { label: 'UF', className: 'px-4 w-[60px]' },
                    { label: 'IBGE', className: 'px-4 w-[120px] hidden md:table-cell' },
                    { label: 'Slug', className: 'px-4 hidden lg:table-cell' },
                    { label: 'Status', className: 'px-4 w-[100px]' },
                    { label: 'Ações', className: 'px-4 w-[100px] text-right pr-5' },
                  ].map((col) => (
                    <th
                      key={col.label}
                      scope="col"
                      className={cn('py-3 font-sans font-bold text-ink-3 text-left', col.className)}
                      style={{
                        fontSize: '0.7rem',
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {isLoading ? (
                  <TableSkeleton />
                ) : isError ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center">
                      <div
                        className="inline-flex flex-col items-center gap-2 px-6 py-4 rounded-md"
                        style={{ background: 'var(--danger-bg)' }}
                      >
                        <p className="font-sans text-sm font-medium text-danger">
                          Erro ao carregar cidades.
                        </p>
                        <button
                          type="button"
                          onClick={() => refetch()}
                          className="font-sans text-xs text-azul hover:underline focus-visible:outline-none focus-visible:underline"
                        >
                          Tentar novamente
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : cities.length === 0 ? (
                  <EmptyState onAdd={openCreate} />
                ) : (
                  cities.map((city) => (
                    <tr
                      key={city.id}
                      className="group border-t border-border-subtle"
                      style={{
                        transition:
                          'background-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)',
                      }}
                      onMouseEnter={(e) => {
                        const el = e.currentTarget;
                        el.style.transform = 'translateY(-1px)';
                        el.style.boxShadow = 'var(--elev-2)';
                        el.style.position = 'relative';
                        el.style.zIndex = '1';
                      }}
                      onMouseLeave={(e) => {
                        const el = e.currentTarget;
                        el.style.transform = '';
                        el.style.boxShadow = '';
                        el.style.position = '';
                        el.style.zIndex = '';
                      }}
                    >
                      {/* Nome — clicável para editar */}
                      <td className="pl-5 pr-4 py-4">
                        <button
                          type="button"
                          onClick={() => openEdit(city.id)}
                          className="font-sans text-sm font-semibold text-ink hover:text-azul transition-colors duration-fast text-left focus-visible:outline-none focus-visible:underline"
                          title={`Editar ${city.name}`}
                        >
                          {city.name}
                        </button>
                      </td>

                      {/* UF */}
                      <td className="px-4 py-4">
                        <span className="font-sans text-sm font-medium text-ink-2">
                          {city.state_uf}
                        </span>
                      </td>

                      {/* IBGE code — JetBrains Mono */}
                      <td className="px-4 py-4 hidden md:table-cell">
                        {city.ibge_code ? (
                          <code
                            className="font-mono text-xs"
                            style={{ color: 'var(--brand-azul)' }}
                          >
                            {city.ibge_code}
                          </code>
                        ) : (
                          <span className="font-sans text-xs text-ink-4">—</span>
                        )}
                      </td>

                      {/* Slug — JetBrains Mono, subtil */}
                      <td className="px-4 py-4 hidden lg:table-cell">
                        <code className="font-mono text-xs text-ink-3">{city.slug}</code>
                      </td>

                      {/* Status badge */}
                      <td className="px-4 py-4">
                        <Badge variant={city.is_active ? 'success' : 'neutral'}>
                          {city.is_active ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </td>

                      {/* Ações: toggle + delete */}
                      <td className="px-4 py-4 pr-5">
                        <div className="flex items-center justify-end gap-3">
                          {/* Toggle ativo/inativo */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={city.is_active}
                            aria-label={city.is_active ? 'Desativar cidade' : 'Ativar cidade'}
                            disabled={isDeletePending && deletePendingId === city.id}
                            onClick={() => handleToggleStatus(city.id, city.is_active)}
                            className={cn(
                              'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
                              'border-2 border-transparent',
                              'transition-colors duration-fast ease',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
                              'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
                              'disabled:opacity-50 disabled:cursor-not-allowed',
                            )}
                            style={{
                              backgroundColor: city.is_active
                                ? 'var(--brand-verde)'
                                : 'var(--surface-muted)',
                            }}
                          >
                            <span
                              className="pointer-events-none block h-4 w-4 rounded-full bg-white transition-transform duration-fast ease"
                              style={{
                                boxShadow: 'var(--elev-1)',
                                transform: city.is_active ? 'translateX(16px)' : 'translateX(0)',
                              }}
                              aria-hidden="true"
                            />
                          </button>

                          {/* Delete */}
                          <button
                            type="button"
                            onClick={() => handleDelete(city.id, city.name)}
                            disabled={isDeletePending && deletePendingId === city.id}
                            aria-label={`Remover cidade ${city.name}`}
                            title="Remover cidade"
                            className={cn(
                              'w-8 h-8 flex items-center justify-center rounded-sm',
                              'text-ink-3 hover:text-danger hover:bg-danger/10',
                              'transition-all duration-fast ease',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30',
                              'disabled:opacity-40 disabled:cursor-not-allowed',
                            )}
                          >
                            <svg
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={1.6}
                              className="w-4 h-4"
                              aria-hidden="true"
                            >
                              <path d="M4 6h12M7 6V4h6v2M8 9v6M12 9v6M5 6l.9 11.1A1 1 0 0 0 6.9 18h6.2a1 1 0 0 0 1-.9L15 6" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-border-subtle">
              <p className="font-sans text-xs text-ink-3">
                {(pagination.page - 1) * pagination.limit + 1}–
                {Math.min(pagination.page * pagination.limit, pagination.total)} de{' '}
                {pagination.total} cidades
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className={cn(
                    'px-3 py-1.5 rounded-sm font-sans text-xs font-medium',
                    'border border-border transition-all duration-fast',
                    'hover:bg-surface-hover hover:border-border-strong',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'focus-visible:ring-2 focus-visible:ring-azul/20',
                  )}
                  aria-label="Página anterior"
                >
                  ← Anterior
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className={cn(
                    'px-3 py-1.5 rounded-sm font-sans text-xs font-medium',
                    'border border-border transition-all duration-fast',
                    'hover:bg-surface-hover hover:border-border-strong',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    'focus-visible:ring-2 focus-visible:ring-azul/20',
                  )}
                  aria-label="Próxima página"
                >
                  Próxima →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal create / edit */}
      <CityFormModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditId(undefined);
        }}
        cityId={editId}
      />
    </>
  );
}
