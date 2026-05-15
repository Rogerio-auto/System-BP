// =============================================================================
// features/admin/users/UserList.tsx — Tabela de usuários (F8-S02).
//
// DS:
//   - Tabela canônica (§9.7): elev-2, th caption-style, hover de linha (Lift).
//   - Bricolage no header (renderizado pelo pai).
//   - JetBrains Mono para email, datas.
//   - Badge para status ativo/inativo/pending.
//   - Avatar com --grad-rondonia e iniciais.
//   - Kebab menu de ações (editar, desativar/reativar).
//   - Filtros: busca (debounce 300ms), role, status.
//   - Loading: skeleton 5 linhas. Empty: CTA. Error: retry.
//   - Paginação server-side.
// =============================================================================

import * as React from 'react';

import { Avatar } from '../../../components/ui/Avatar';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { useDeactivateUser, useReactivateUser } from '../../../hooks/admin/useUsers';
import type { UserResponse } from '../../../hooks/admin/useUsers.types';
import { cn } from '../../../lib/cn';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeDate(iso: string | null): string {
  if (!iso) return 'Nunca';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `${diffDays}d atrás`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}sem atrás`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}m atrás`;
  return `${Math.floor(diffDays / 365)}a atrás`;
}

function getStatusBadgeVariant(status: UserResponse['status']): BadgeVariant {
  if (status === 'active') return 'success';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

function getStatusLabel(status: UserResponse['status']): string {
  if (status === 'active') return 'Ativo';
  if (status === 'pending') return 'Pendente';
  return 'Inativo';
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
                  style={{
                    width: 100 + ((i * 41) % 80),
                    background: 'var(--surface-muted)',
                  }}
                />
                <div
                  className="h-3 w-36 rounded-xs animate-pulse"
                  style={{ background: 'var(--surface-muted)' }}
                />
              </div>
            </div>
          </td>
          {/* Roles */}
          <td className="px-4 py-4 hidden md:table-cell">
            <div
              className="h-5 w-16 rounded-pill animate-pulse"
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
          {/* Último login */}
          <td className="px-4 py-4 hidden lg:table-cell">
            <div
              className="h-4 w-20 rounded-xs animate-pulse"
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
      <td colSpan={5}>
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
              Nenhum usuário encontrado
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1 max-w-xs mx-auto">
              Crie o primeiro usuário para dar acesso ao sistema.
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
            Criar primeiro usuário
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
  user: UserResponse;
  onEdit: () => void;
}

function KebabMenu({ user, onEdit }: KebabMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  const { deactivate: doDeactivate, isPending: isDeactivating } = useDeactivateUser();
  const { reactivate: doReactivate, isPending: isReactivating } = useReactivateUser();

  const isBusy = isDeactivating || isReactivating;
  const isActive = user.status === 'active';

  // Fechar ao clicar fora
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
      window.confirm(`Desativar "${user.fullName}"?\nO usuário não conseguirá mais fazer login.`)
    ) {
      doDeactivate(user.id);
    }
  }

  function handleReactivate(): void {
    setOpen(false);
    doReactivate(user.id);
  }

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Ações para ${user.fullName}`}
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

interface UserListProps {
  users: UserResponse[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onAdd: () => void;
  onEdit: (user: UserResponse) => void;
  // Filtros controlados pelo pai
  search: string;
  onSearchChange: (v: string) => void;
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
 * Tabela de usuários com filtros e paginação.
 * Os filtros são controlados pelo pai (Users.tsx).
 */
export function UserList({
  users,
  isLoading,
  isError,
  onRefetch,
  onAdd,
  onEdit,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  pagination,
  onPageChange,
}: UserListProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <Input
            id="users-search"
            placeholder="Buscar por nome ou email..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-[160px]">
          <Select
            id="users-status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          />
        </div>
      </div>

      {/* Tabela */}
      <div
        className="rounded-md border border-border overflow-hidden"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-2)',
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: 'var(--bg-elev-2)' }}>
                {[
                  { label: 'Usuário', className: 'pl-5 pr-4' },
                  { label: 'Roles', className: 'px-4 hidden md:table-cell' },
                  { label: 'Status', className: 'px-4' },
                  { label: 'Último login', className: 'px-4 hidden lg:table-cell' },
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
                  <td colSpan={5} className="px-5 py-12 text-center">
                    <div
                      className="inline-flex flex-col items-center gap-2 px-6 py-4 rounded-md"
                      style={{ background: 'var(--danger-bg)' }}
                    >
                      <p className="font-sans text-sm font-medium text-danger">
                        Erro ao carregar usuários.
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
              ) : users.length === 0 ? (
                <EmptyState onAdd={onAdd} />
              ) : (
                users.map((user) => (
                  <tr
                    key={user.id}
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
                    {/* Avatar + nome + email */}
                    <td className="pl-5 pr-4 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={user.fullName} variant="rondonia" size="md" />
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onEdit(user)}
                            className="block font-sans text-sm font-semibold text-ink hover:text-azul transition-colors duration-fast focus-visible:outline-none focus-visible:underline truncate max-w-[180px]"
                          >
                            {user.fullName}
                          </button>
                          <code
                            className="font-mono text-xs mt-0.5 block truncate max-w-[180px]"
                            style={{ color: 'var(--text-3)', letterSpacing: '-0.01em' }}
                          >
                            {user.email}
                          </code>
                        </div>
                      </div>
                    </td>

                    {/* Roles — nota: o backend não retorna roles na lista,
                         apenas o status. Mostramos placeholder. */}
                    <td className="px-4 py-4 hidden md:table-cell">
                      <span className="font-sans text-xs text-ink-4 italic">—</span>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-4">
                      <Badge variant={getStatusBadgeVariant(user.status)}>
                        {getStatusLabel(user.status)}
                      </Badge>
                    </td>

                    {/* Último login */}
                    <td className="px-4 py-4 hidden lg:table-cell">
                      <span
                        className="font-mono text-xs"
                        style={{ color: 'var(--text-3)', letterSpacing: '-0.01em' }}
                      >
                        {formatRelativeDate(user.lastLoginAt)}
                      </span>
                    </td>

                    {/* Ações kebab */}
                    <td className="px-4 pr-5 py-4 text-right">
                      <KebabMenu user={user} onEdit={() => onEdit(user)} />
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
              usuário{pagination.total !== 1 ? 's' : ''}
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
