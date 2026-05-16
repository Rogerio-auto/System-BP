// =============================================================================
// pages/admin/Agents.tsx — /admin/agents
//
// Tela de gestão de agentes de crédito.
//   - Header Bricolage + botão "Novo agente"
//   - Stats row: total ativos, cidades cobertas, agentes inativos
//   - Tabela de agentes (AgentList)
//   - Drawer create/edit (AgentDrawer)
//
// Acesso: agents:manage (verificado no backend; UI usa hasPermission para o botão).
// =============================================================================

import * as React from 'react';

import { AgentDrawer } from '../../features/admin/agents/AgentDrawer';
import { AgentList } from '../../features/admin/agents/AgentList';
import { useAgents } from '../../hooks/admin/useAgents';
import type { AgentResponse } from '../../hooks/admin/useAgents.types';
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
 * Página de administração de agentes de crédito (/admin/agents).
 * Acesso controlado por agents:manage.
 */
export function AgentsPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('agents:manage');

  const [page, setPage] = React.useState(1);
  const [search, setSearch] = React.useState('');
  const [searchDebounced, setSearchDebounced] = React.useState('');
  const [cityFilter, setCityFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');

  // Drawer state
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [editAgent, setEditAgent] = React.useState<AgentResponse | undefined>(undefined);

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

  // Query params alinhados ao backend AgentListQuerySchema
  const queryParams = React.useMemo(() => {
    const p: Parameters<typeof useAgents>[0] = { page, limit: 20 };
    if (searchDebounced) p.q = searchDebounced;
    if (cityFilter) p.cityId = cityFilter;
    if (statusFilter === 'true') p.isActive = true;
    else if (statusFilter === 'false') p.isActive = false;
    return p;
  }, [page, searchDebounced, cityFilter, statusFilter]);

  const { data, isLoading, isError, refetch } = useAgents(queryParams);

  const agents = data?.data ?? [];
  const pagination = data?.pagination;

  // Stats derivados
  const totalAtivos = agents.filter((a) => a.is_active).length;
  const totalInativos = agents.filter((a) => !a.is_active).length;
  const cidadesCobertas = React.useMemo(() => {
    const citySet = new Set<string>();
    for (const agent of agents) {
      if (agent.is_active) {
        for (const c of agent.cities) citySet.add(c.city_id);
      }
    }
    return citySet.size;
  }, [agents]);

  function openCreate(): void {
    setEditAgent(undefined);
    setDrawerOpen(true);
  }

  function openEdit(agent: AgentResponse): void {
    setEditAgent(agent);
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
              Agentes
            </h1>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Gerencie os agentes de crédito do Banco do Povo.
            </p>
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
              Novo agente
            </button>
          )}
        </div>

        {/* ── Stats row ───────────────────────────────────────────────────────── */}
        <div
          className="grid grid-cols-2 sm:grid-cols-3 gap-3"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
        >
          <StatCard
            label="Ativos"
            value={isLoading ? '—' : totalAtivos}
            sub="agentes em operação"
            isLoading={isLoading}
          />
          <StatCard
            label="Cidades cobertas"
            value={isLoading ? '—' : cidadesCobertas}
            sub="por agentes ativos"
            isLoading={isLoading}
          />
          <StatCard
            label="Inativos"
            value={isLoading ? '—' : totalInativos}
            sub="acesso revogado"
            isLoading={isLoading}
          />
        </div>

        {/* ── Tabela ──────────────────────────────────────────────────────────── */}
        <div style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}>
          <AgentList
            agents={agents}
            isLoading={isLoading}
            isError={isError}
            onRefetch={() => void refetch()}
            onAdd={openCreate}
            onEdit={openEdit}
            search={search}
            onSearchChange={handleSearchChange}
            cityFilter={cityFilter}
            onCityFilterChange={(v) => {
              setCityFilter(v);
              setPage(1);
            }}
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
      <AgentDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setEditAgent(undefined);
        }}
        agentId={editAgent?.id}
        agent={editAgent}
      />
    </>
  );
}
