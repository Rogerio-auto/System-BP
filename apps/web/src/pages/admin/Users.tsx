// =============================================================================
// pages/admin/Users.tsx — /admin/users
//
// Lista de usuários do sistema com:
//   - Header Bricolage + botão "Novo usuário"
//   - Stats row: total, ativos, inativos, último cadastro
//   - Tabela de usuários (UserList)
//   - Drawer create/edit (UserDrawer)
//
// Acesso: users:manage (verificado no backend; UI usa hasPermission para ocultar
// o botão de criação se o usuário não tiver a permissão).
// =============================================================================

import * as React from 'react';

import { UserDrawer } from '../../features/admin/users/UserDrawer';
import { UserList } from '../../features/admin/users/UserList';
import { useUsers } from '../../hooks/admin/useUsers';
import type { UserResponse } from '../../hooks/admin/useUsers.types';
import { useAuth } from '../../lib/auth-store';

// ---------------------------------------------------------------------------
// Stat card (DS §9.6)
// ---------------------------------------------------------------------------

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  isLoading?: boolean;
}

function StatCard({ label, value, sub, isLoading }: StatCardProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-1 px-5 py-4 rounded-md border border-border"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
    >
      <p
        className="font-sans font-bold uppercase text-ink-3"
        style={{ fontSize: '0.7rem', letterSpacing: '0.1em' }}
      >
        {label}
      </p>
      {isLoading ? (
        <div
          className="h-7 w-12 rounded-xs animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
          aria-hidden="true"
        />
      ) : (
        <p
          className="font-display font-bold text-ink"
          style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.035em' }}
        >
          {value}
        </p>
      )}
      {sub && <p className="font-sans text-xs text-ink-4">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

/**
 * Página de administração de usuários (/admin/users).
 * Acesso controlado por users:manage.
 */
export function UsersPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('users:manage');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');

  // Drawer states
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<UserResponse | undefined>(undefined);

  // Debounce da busca
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

  // Query params
  const queryParams = React.useMemo(() => {
    const p: Parameters<typeof useUsers>[0] = { page, limit: 20 };
    if (searchDebounced) p.search = searchDebounced;
    if (statusFilter === 'true') p.active = 'true';
    else if (statusFilter === 'false') p.active = 'false';
    return p;
  }, [page, searchDebounced, statusFilter]);

  const { data, isLoading, isError, refetch } = useUsers(queryParams);

  const users = data?.data ?? [];
  const pagination = data?.pagination;

  // Stats derivados
  const totalAtivos = users.filter((u) => u.status === 'active').length;
  const totalInativos = users.filter((u) => u.status === 'disabled').length;
  const totalPendente = users.filter((u) => u.status === 'pending').length;

  function openCreate(): void {
    setEditUser(undefined);
    setDrawerOpen(true);
  }

  function openEdit(user: UserResponse): void {
    setEditUser(user);
    setDrawerOpen(true);
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
              Usuários
            </h1>
            <p className="font-sans text-sm text-ink-3 mt-1">Gerencie os acessos ao sistema.</p>
          </div>

          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 px-[22px] py-3 rounded-sm font-sans font-semibold text-sm text-white transition-[transform,box-shadow] duration-fast ease focus-visible:ring-2 focus-visible:ring-azul/40 focus-visible:outline-none hover:-translate-y-0.5 active:translate-y-0"
              style={{
                background: 'var(--grad-azul)',
                boxShadow: 'var(--elev-2),inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  'var(--glow-azul),inset 0 1px 0 rgba(255,255,255,0.2)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.boxShadow =
                  'var(--elev-2),inset 0 1px 0 rgba(255,255,255,0.15)';
              }}
            >
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
              Novo usuário
            </button>
          )}
        </div>

        {/* ── Stats row ───────────────────────────────────────────────────────── */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-3"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
        >
          <StatCard
            label="Total"
            value={isLoading ? '—' : (pagination?.total ?? users.length)}
            sub="usuários cadastrados"
            isLoading={isLoading}
          />
          <StatCard
            label="Ativos"
            value={isLoading ? '—' : totalAtivos}
            sub="com acesso ativo"
            isLoading={isLoading}
          />
          <StatCard
            label="Inativos"
            value={isLoading ? '—' : totalInativos}
            sub="acesso revogado"
            isLoading={isLoading}
          />
          <StatCard
            label="Pendentes"
            value={isLoading ? '—' : totalPendente}
            sub="aguardando primeiro acesso"
            isLoading={isLoading}
          />
        </div>

        {/* ── Tabela ──────────────────────────────────────────────────────────── */}
        <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}>
          <UserList
            users={users}
            isLoading={isLoading}
            isError={isError}
            onRefetch={() => void refetch()}
            onAdd={openCreate}
            onEdit={openEdit}
            search={search}
            onSearchChange={handleSearchChange}
            statusFilter={statusFilter}
            onStatusFilterChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            pagination={pagination}
            onPageChange={(p) => setPage(p)}
          />
        </div>
      </div>

      {/* ── Drawer ────────────────────────────────────────────────────────────── */}
      <UserDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditUser(undefined);
        }}
        userId={editUser?.id}
        user={editUser}
      />
    </>
  );
}
