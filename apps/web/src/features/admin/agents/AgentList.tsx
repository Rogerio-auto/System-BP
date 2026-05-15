// =============================================================================
// features/admin/agents/AgentList.tsx — Tabela de agentes de crédito (F8-S04).
//
// DS:
//   - Tabela canônica (§9.7): elev-2, th caption-style, hover de linha (Lift).
//   - Avatar com --grad-rondonia e iniciais.
//   - Badge para status ativo/inativo.
//   - Chip da cidade primária + "+N" para extras.
//   - JetBrains Mono para telefone.
//   - Filtros: busca (debounce 300ms), cidade, status.
//   - Loading: skeleton 5 linhas. Empty: CTA. Error: retry.
//   - Paginação server-side.
// =============================================================================

import * as React from 'react';

import { Avatar } from '../../../components/ui/Avatar';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { useDeactivateAgent, useReactivateAgent } from '../../../hooks/admin/useAgents';
import type { AgentResponse } from '../../../hooks/admin/useAgents.types';
import { useCities } from '../../../hooks/admin/useCities';
import { cn } from '../../../lib/cn';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusBadgeVariant(isActive: boolean): BadgeVariant {
  return isActive ? 'success' : 'neutral';
}

function getStatusLabel(isActive: boolean): string {
  return isActive ? 'Ativo' : 'Inativo';
}

// ---------------------------------------------------------------------------
// Filter options
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'true', label: 'Ativos' },
  { value: 'false', label: 'Inativos' },
];

// ---------------------------------------------------------------------------
// CityChips — chip da primária + "+N"
// ---------------------------------------------------------------------------

interface CityChipsProps {
  agent: AgentResponse;
  cityNameMap: Map<string, string>;
}

function CityChips({ agent, cityNameMap }: CityChipsProps): React.JSX.Element {
  const primaryName = agent.primary_city_id ? (cityNameMap.get(agent.primary_city_id) ?? '—') : '—';
  const extraCount = Math.max(0, agent.city_count - 1);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {agent.primary_city_id ? (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-sm font-sans text-xs font-semibold text-white"
          style={{ background: 'var(--grad-rondonia)', fontSize: '0.7rem' }}
        >
          {primaryName}
        </span>
      ) : (
        <span className="font-sans text-xs text-ink-4 italic">Sem cidade</span>
      )}
      {extraCount > 0 && (
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded-pill font-sans text-xs font-medium border border-border text-ink-3"
          style={{ fontSize: '0.65rem' }}
        >
          +{extraCount}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {/* Avatar + nome */}
          <td className="pl-5 pr-4 py-4">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-pill shrink-0 animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
              <div className="flex flex-col gap-1.5">
                <div
                  className="h-4 rounded-xs animate-pulse"
                  style={{ width: 100 + ((i * 41) % 80), background: 'var(--surface-muted)' }}
                />
                <div
                  className="h-3 w-28 rounded-xs animate-pulse"
                  style={{ background: 'var(--surface-muted)' }}
                />
              </div>
            </div>
          </td>
          {/* Telefone */}
          <td className="px-4 py-4 hidden md:table-cell">
            <div
              className="h-4 w-28 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* Cidades */}
          <td className="px-4 py-4">
            <div
              className="h-5 w-20 rounded-sm animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* User vinculado */}
          <td className="px-4 py-4 hidden lg:table-cell">
            <div
              className="h-4 w-24 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* Status */}
          <td className="px-4 py-4">
            <div
              className="h-5 w-14 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* Ações */}
          <td className="px-4 pr-5 py-4">
            <div
              className="h-7 w-7 rounded-sm animate-pulse ml-auto"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div
            className="w-16 h-16 rounded-md flex items-center justify-center"
            style={{ background: 'var(--info-bg)' }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-8 h-8"
              style={{ color: 'var(--info)' }}
              aria-hidden="true"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div>
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
            >
              Nenhum agente encontrado
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1 max-w-xs mx-auto">
              Cadastre o primeiro agente de crédito para começar.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={onAdd}
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
            Cadastrar primeiro agente
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Kebab menu de ações
// ---------------------------------------------------------------------------

interface KebabMenuProps {
  agent: AgentResponse;
  onEdit: () => void;
}

function KebabMenu({ agent, onEdit }: KebabMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const { deactivate: doDeactivate, isPending: isDeactivating } = useDeactivateAgent();
  const { reactivate: doReactivate, isPending: isReactivating } = useReactivateAgent();

  const isBusy = isDeactivating || isReactivating;
  const isActive = agent.is_active;

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  function handleDeactivate(): void {
    setOpen(false);
    if (
      window.confirm(
        `Desativar "${agent.display_name}"?\nSe for o único agente ativo em alguma cidade com leads abertos, a operação será bloqueada.`,
      )
    ) {
      doDeactivate(agent.id);
    }
  }

  function handleReactivate(): void {
    setOpen(false);
    doReactivate(agent.id);
  }

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Ações para ${agent.display_name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={isBusy}
        className={cn(
          'w-8 h-8 flex items-center justify-center rounded-sm',
          'text-ink-3 hover:text-ink hover:bg-surface-hover',
          'transition-all duration-fast ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
          'disabled:opacity-40',
        )}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 rounded-sm border border-border z-10"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className={cn(
              'flex items-center gap-2.5 w-full px-4 py-2.5',
              'font-sans text-sm text-ink-2 hover:text-ink',
              'hover:bg-surface-hover',
              'transition-colors duration-fast',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4 shrink-0"
              aria-hidden="true"
            >
              <path d="M11 2l3 3-8 8H3v-3L11 2Z" />
            </svg>
            Editar
          </button>

          <div className="border-t border-border-subtle" />

          {isActive ? (
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={handleDeactivate}
              className={cn(
                'flex items-center gap-2.5 w-full px-4 py-2.5',
                'font-sans text-sm text-danger',
                'hover:bg-danger/10',
                'transition-colors duration-fast',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4 shrink-0"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3M8 11h.01" />
              </svg>
              {isDeactivating ? 'Desativando...' : 'Desativar'}
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={isBusy}
              onClick={handleReactivate}
              className={cn(
                'flex items-center gap-2.5 w-full px-4 py-2.5',
                'font-sans text-sm',
                'hover:bg-surface-hover',
                'transition-colors duration-fast',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
              style={{ color: 'var(--success)' }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4 shrink-0"
                aria-hidden="true"
              >
                <path d="M4 8a4 4 0 1 0 4-4" />
                <path d="M4 4v4h4" />
              </svg>
              {isReactivating ? 'Reativando...' : 'Reativar'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AgentListProps {
  agents: AgentResponse[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onAdd: () => void;
  onEdit: (agent: AgentResponse) => void;
  // Filtros controlados pelo pai
  search: string;
  onSearchChange: (v: string) => void;
  cityFilter: string;
  onCityFilterChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  // Paginação
  pagination?:
    | {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      }
    | undefined;
  onPageChange: (page: number) => void;
}

/**
 * Tabela de agentes com filtros e paginação.
 */
export function AgentList({
  agents,
  isLoading,
  isError,
  onRefetch,
  onAdd,
  onEdit,
  search,
  onSearchChange,
  cityFilter,
  onCityFilterChange,
  statusFilter,
  onStatusFilterChange,
  pagination,
  onPageChange,
}: AgentListProps): React.JSX.Element {
  // Busca de cidades para labels (mapa cityId → name)
  const { data: citiesData } = useCities({ is_active: true as const, limit: 300 });
  const cityNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const city of citiesData?.data ?? []) {
      map.set(city.id, city.name);
    }
    return map;
  }, [citiesData]);

  // Opções de cidades para filtro
  const cityFilterOptions = React.useMemo(() => {
    const opts = [{ value: '', label: 'Todas as cidades' }];
    for (const city of citiesData?.data ?? []) {
      opts.push({ value: city.id, label: city.name });
    }
    return opts;
  }, [citiesData]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <Input
            id="agents-search"
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-[180px]">
          <Select
            id="agents-city"
            options={cityFilterOptions}
            value={cityFilter}
            onChange={(e) => onCityFilterChange(e.target.value)}
          />
        </div>
        <div className="w-[160px]">
          <Select
            id="agents-status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          />
        </div>
      </div>

      {/* Tabela */}
      <div
        className="rounded-md border border-border overflow-hidden"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: 'var(--bg-elev-2)' }}>
                {[
                  { label: 'Agente', className: 'pl-5 pr-4' },
                  { label: 'Telefone', className: 'px-4 hidden md:table-cell' },
                  { label: 'Cidades', className: 'px-4' },
                  { label: 'Usuário', className: 'px-4 hidden lg:table-cell' },
                  { label: 'Status', className: 'px-4' },
                  { label: 'Ações', className: 'px-4 pr-5 text-right' },
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
                        Erro ao carregar agentes.
                      </p>
                      <button
                        type="button"
                        onClick={onRefetch}
                        className="font-sans text-xs text-azul hover:underline focus-visible:outline-none focus-visible:underline"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  </td>
                </tr>
              ) : agents.length === 0 ? (
                <EmptyState onAdd={onAdd} />
              ) : (
                agents.map((agent) => (
                  <tr
                    key={agent.id}
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
                      el.style.background = 'var(--surface-hover)';
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget;
                      el.style.transform = '';
                      el.style.boxShadow = '';
                      el.style.position = '';
                      el.style.zIndex = '';
                      el.style.background = '';
                    }}
                  >
                    {/* Avatar + display_name */}
                    <td className="pl-5 pr-4 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={agent.display_name} variant="rondonia" size="md" />
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onEdit(agent)}
                            className="block font-sans text-sm font-semibold text-ink hover:text-azul transition-colors duration-fast focus-visible:outline-none focus-visible:underline truncate max-w-[160px]"
                          >
                            {agent.display_name}
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Telefone */}
                    <td className="px-4 py-4 hidden md:table-cell">
                      {agent.phone ? (
                        <code
                          className="font-mono text-xs"
                          style={{ color: 'var(--text-3)', letterSpacing: '-0.01em' }}
                        >
                          {agent.phone}
                        </code>
                      ) : (
                        <span className="font-sans text-xs text-ink-4 italic">—</span>
                      )}
                    </td>

                    {/* Cidades */}
                    <td className="px-4 py-4">
                      <CityChips agent={agent} cityNameMap={cityNameMap} />
                    </td>

                    {/* User vinculado */}
                    <td className="px-4 py-4 hidden lg:table-cell">
                      {agent.user_id ? (
                        <code
                          className="font-mono text-xs"
                          style={{ color: 'var(--text-3)', letterSpacing: '-0.01em', fontSize: '0.65rem' }}
                        >
                          {agent.user_id.slice(0, 8)}…
                        </code>
                      ) : (
                        <span className="font-sans text-xs text-ink-4 italic">—</span>
                      )}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-4">
                      <Badge variant={getStatusBadgeVariant(agent.is_active)}>
                        {getStatusLabel(agent.is_active)}
                      </Badge>
                    </td>

                    {/* Ações kebab */}
                    <td className="px-4 pr-5 py-4 text-right">
                      <KebabMenu agent={agent} onEdit={() => onEdit(agent)} />
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
              {Math.min(pagination.page * pagination.limit, pagination.total)} de {pagination.total}{' '}
              agente{pagination.total !== 1 ? 's' : ''}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => onPageChange(pagination.page - 1)}
                className={cn(
                  'px-3 py-1.5 rounded-sm font-sans text-xs font-medium',
                  'border border-border transition-all duration-fast',
                  'hover:bg-surface-hover hover:border-border-strong',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'focus-visible:ring-2 focus-visible:ring-azul/20',
                )}
              >
                ← Anterior
              </button>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => onPageChange(pagination.page + 1)}
                className={cn(
                  'px-3 py-1.5 rounded-sm font-sans text-xs font-medium',
                  'border border-border transition-all duration-fast',
                  'hover:bg-surface-hover hover:border-border-strong',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  'focus-visible:ring-2 focus-visible:ring-azul/20',
                )}
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
