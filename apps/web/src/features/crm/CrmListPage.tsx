// =============================================================================
// features/crm/CrmListPage.tsx — Tela /crm: lista de leads.
//
// DS:
//   - Tabela densa (DS §9.7): th caption-style, hover de linha, avatares com
//     --grad-rondonia, coluna de valor em JetBrains Mono (td-amount).
//   - Filtros: Input + Select primitivos do DS.
//   - Stats row: 4 KPIs em Stat primitivos (DS §9.8).
//   - Paginação server-side (page/limit).
//   - Loading: skeletons que respeitam layout final.
//   - Empty: SVG inline + CTA "Adicionar primeiro lead".
//
// LGPD:
//   - Telefone: SEMPRE maskPhone() — nunca raw.
//   - Email: SEMPRE truncateEmail() em listagens.
//   - CPF: nunca exibido.
//   - Sem console.log(lead).
// =============================================================================

import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import type { AvatarVariant } from '../../components/ui/Avatar';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Stat } from '../../components/ui/Stat';
import type { LeadFilters, LeadStatus } from '../../hooks/crm/types';
import {
  STATUS_META,
  SOURCE_LABEL,
  maskPhone,
  truncateEmail,
  formatDate,
} from '../../hooks/crm/types';
import { useLeads } from '../../hooks/crm/useLeads';
import { cn } from '../../lib/cn';
import { KanbanPage } from '../../pages/kanban/KanbanPage';

import { NewLeadModal } from './NewLeadModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AVATAR_VARIANTS: AvatarVariant[] = ['rondonia', 'azul', 'verde', 'amarelo'];

function avatarVariantForName(name: string): AvatarVariant {
  // Determinístico: hash simples da primeira letra para variedade
  const code = name.charCodeAt(0) % AVATAR_VARIANTS.length;
  return AVATAR_VARIANTS[code] ?? 'rondonia';
}

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'new', label: 'Novo' },
  { value: 'qualifying', label: 'Qualificando' },
  { value: 'simulation', label: 'Simulação' },
  { value: 'closed_won', label: 'Convertido' },
  { value: 'closed_lost', label: 'Perdido' },
  { value: 'archived', label: 'Arquivado' },
];

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {/* Avatar + nome */}
          <td className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-pill shrink-0 animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{ width: 120 + ((i * 17) % 60), background: 'var(--surface-muted)' }}
              />
            </div>
          </td>
          {/* Status */}
          <td className="px-4 py-3.5">
            <div
              className="h-5 w-20 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* Telefone */}
          <td className="px-4 py-3.5">
            <div
              className="h-4 w-32 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* Email */}
          <td className="px-4 py-3.5 hidden lg:table-cell">
            <div
              className="h-4 w-40 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* Canal */}
          <td className="px-4 py-3.5 hidden md:table-cell">
            <div
              className="h-4 w-20 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          {/* Data */}
          <td className="px-4 py-3.5 hidden xl:table-cell">
            <div
              className="h-4 w-24 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

function StatsSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border bg-surface-1 p-5 animate-pulse"
          style={{ boxShadow: 'var(--elev-2)', height: 96 }}
          aria-hidden="true"
        >
          <div
            className="h-3 w-20 rounded-xs mb-3"
            style={{ background: 'var(--surface-muted)' }}
          />
          <div className="h-8 w-16 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          {/* Ilustração SVG inline */}
          <svg
            viewBox="0 0 120 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-32 h-auto opacity-40"
            aria-hidden="true"
          >
            {/* Fundo de mesa */}
            <ellipse cx="60" cy="85" rx="50" ry="8" fill="var(--surface-muted)" />
            {/* Pasta / arquivo */}
            <rect
              x="25"
              y="20"
              width="70"
              height="55"
              rx="6"
              fill="var(--bg-elev-2)"
              stroke="var(--border-strong)"
              strokeWidth="1.5"
            />
            <rect x="25" y="20" width="70" height="12" rx="6" fill="var(--surface-muted)" />
            {/* Linhas de conteúdo */}
            <rect x="35" y="42" width="30" height="3" rx="1.5" fill="var(--border-strong)" />
            <rect x="35" y="50" width="50" height="3" rx="1.5" fill="var(--border-strong)" />
            <rect x="35" y="58" width="40" height="3" rx="1.5" fill="var(--border-strong)" />
            {/* Símbolo + */}
            <circle cx="88" cy="28" r="12" fill="var(--brand-verde)" />
            <path d="M88 23v10M83 28h10" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>

          <div className="flex flex-col gap-1">
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
            >
              Nenhum lead encontrado
            </p>
            <p className="font-sans text-sm text-ink-3 max-w-xs">
              Ainda não há leads cadastrados. Comece adicionando o primeiro.
            </p>
          </div>

          <Button variant="primary" onClick={onAdd}>
            Adicionar primeiro lead
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * CrmListPage — /crm
 * Lista paginada de leads com filtros, stats row e tabela densa.
 */
export function CrmListPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get('view') ?? 'lista';

  const [filters, setFilters] = React.useState<LeadFilters>({
    page: 1,
    limit: 20,
  });
  const [search, setSearch] = React.useState('');
  const [modalOpen, setModalOpen] = React.useState(false);

  // Debounce da busca: 300ms
  const searchRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string): void => {
    setSearch(value);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      if (value) {
        setFilters((f) => ({ ...f, search: value, page: 1 }));
      } else {
        setFilters((f) => {
          const { search: _s, ...rest } = f;
          return { ...rest, page: 1 };
        });
      }
    }, 300);
  };

  React.useEffect(() => {
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, []);

  const { data, isLoading, isError } = useLeads(filters);

  const leads = data?.data ?? [];
  const pagination = data?.pagination;

  // ── Computar stats a partir dos dados (simplificado — idealmente vem da API)
  const stats = React.useMemo(() => {
    if (!data?.data) return null;
    const total = pagination?.total ?? leads.length;
    const newThisMonth = leads.filter((l) => {
      const created = new Date(l.created_at);
      const now = new Date();
      return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
    }).length;
    const qualifying = leads.filter((l) => l.status === 'qualifying').length;
    const closedWon = leads.filter((l) => l.status === 'closed_won').length;
    const conversionRate = total > 0 ? Math.round((closedWon / total) * 100) : 0;

    return { total, newThisMonth, qualifying, conversionRate };
  }, [data, leads, pagination]);

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* ── Page header ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* Segmented control Lista | Kanban */}
          <div
            className="inline-flex items-center gap-0.5 rounded-md border border-border-subtle p-0.5"
            style={{ background: 'var(--bg-elev-2)' }}
            role="group"
            aria-label="Modo de visualização"
          >
            <button
              type="button"
              onClick={() => setSearchParams({}, { replace: true })}
              aria-pressed={activeView === 'lista'}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px]',
                'font-sans text-sm font-medium',
                'transition-all duration-[200ms] ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
                activeView === 'lista'
                  ? 'bg-surface-1 text-ink shadow-e1'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-hover',
              )}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="w-3.5 h-3.5"
                aria-hidden="true"
              >
                <path d="M2 4h12M2 8h12M2 12h12" />
              </svg>
              Lista
            </button>
            <button
              type="button"
              onClick={() => setSearchParams({ view: 'kanban' }, { replace: true })}
              aria-pressed={activeView === 'kanban'}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[5px]',
                'font-sans text-sm font-medium',
                'transition-all duration-[200ms] ease-out',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
                activeView === 'kanban'
                  ? 'bg-surface-1 text-ink shadow-e1'
                  : 'text-ink-3 hover:text-ink hover:bg-surface-hover',
              )}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="w-3.5 h-3.5"
                aria-hidden="true"
              >
                <rect x="1" y="2" width="4" height="12" rx="1" />
                <rect x="6" y="2" width="4" height="8" rx="1" />
                <rect x="11" y="2" width="4" height="10" rx="1" />
              </svg>
              Kanban
            </button>
          </div>

          {/* Ações: Importar + Novo Lead */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={() => navigate('/imports/leads/new')}
              leftIcon={
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M8 2v8" />
                  <path d="M5 7l3 3 3-3" />
                  <path d="M2 12v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1" />
                </svg>
              }
            >
              Importar leads
            </Button>
            <Button
              variant="primary"
              onClick={() => setModalOpen(true)}
              leftIcon={
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M8 2v12M2 8h12" />
                </svg>
              }
            >
              Novo lead
            </Button>
          </div>
        </div>

        {/* ── Título da página ──────────────────────────────────────────────── */}
        <div className="-mt-2">
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            CRM
          </h1>
          <p className="font-sans text-sm text-ink-3 mt-1">Gerencie seus leads</p>
        </div>

        {/* ── Conteúdo dependente do modo de visualização ───────────────────── */}
        {activeView === 'kanban' ? (
          <KanbanPage hideHeader />
        ) : (
          <>
            {/* ── Stats row ─────────────────────────────────────────────────────── */}
            {isLoading && !data ? (
              <StatsSkeleton />
            ) : stats ? (
              <div
                className="grid grid-cols-2 lg:grid-cols-4 gap-4"
                style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
              >
                <Stat
                  label="Total de leads"
                  value={stats.total}
                  description="Todos os leads ativos"
                />
                <Stat
                  label="Novos no mês"
                  value={stats.newThisMonth}
                  {...(stats.newThisMonth > 0
                    ? { trend: { value: `+${stats.newThisMonth}`, direction: 'up' as const } }
                    : {})}
                />
                <Stat
                  label="Em análise"
                  value={stats.qualifying}
                  description="Status: qualificando"
                />
                <Stat
                  label="Conversão"
                  value={`${stats.conversionRate}%`}
                  trend={
                    stats.conversionRate >= 10
                      ? { value: `${stats.conversionRate}%`, direction: 'up' }
                      : { value: `${stats.conversionRate}%`, direction: 'down' }
                  }
                  description="Leads convertidos"
                />
              </div>
            ) : null}

            {/* ── Filtros ───────────────────────────────────────────────────────── */}
            <div
              className="flex flex-wrap gap-3 items-end"
              style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
            >
              {/* Busca */}
              <div className="flex-1 min-w-[200px]">
                <Input
                  id="crm-search"
                  placeholder="Buscar por nome..."
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  wrapperClassName="w-full"
                />
              </div>

              {/* Status */}
              <div className="w-[160px]">
                <Select
                  id="crm-status"
                  options={STATUS_OPTIONS}
                  value={filters.status ?? ''}
                  onChange={(e) => {
                    const val = e.target.value as LeadStatus | '';
                    setFilters((f) => {
                      if (val) {
                        return { ...f, status: val, page: 1 };
                      }
                      const { status: _s, ...rest } = f;
                      return { ...rest, page: 1 };
                    });
                  }}
                />
              </div>
            </div>

            {/* ── Tabela ────────────────────────────────────────────────────────── */}
            <div
              className="rounded-md border border-border overflow-hidden"
              style={{
                background: 'var(--bg-elev-1)',
                boxShadow: 'var(--elev-2)',
                animation: 'fade-up var(--dur-slow) var(--ease-out) 0.15s both',
              }}
            >
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  {/* Thead */}
                  <thead>
                    <tr style={{ background: 'var(--bg-elev-2)' }}>
                      {[
                        { label: 'Lead', className: 'pl-4 pr-4 w-[260px]' },
                        { label: 'Status', className: 'px-4 w-[130px]' },
                        { label: 'Telefone', className: 'px-4 w-[150px]' },
                        { label: 'E-mail', className: 'px-4 hidden lg:table-cell' },
                        { label: 'Canal', className: 'px-4 hidden md:table-cell w-[110px]' },
                        {
                          label: 'Criado',
                          className: 'px-4 hidden xl:table-cell w-[110px] text-right pr-4',
                        },
                      ].map((col) => (
                        <th
                          key={col.label}
                          scope="col"
                          className={cn(
                            'py-3 font-sans font-bold text-ink-3 text-left',
                            col.className,
                          )}
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

                  {/* Tbody */}
                  <tbody>
                    {isLoading ? (
                      <TableSkeleton />
                    ) : isError ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-12 text-center">
                          <p className="font-sans text-sm text-danger">Erro ao carregar leads.</p>
                          <button
                            type="button"
                            className="mt-2 font-sans text-xs text-azul hover:underline"
                            onClick={() => setFilters((f) => ({ ...f }))}
                          >
                            Tentar novamente
                          </button>
                        </td>
                      </tr>
                    ) : leads.length === 0 ? (
                      <EmptyState onAdd={() => setModalOpen(true)} />
                    ) : (
                      leads.map((lead, idx) => {
                        const statusMeta = STATUS_META[lead.status];
                        // LGPD: mascarar PII antes de qualquer uso em template
                        const phoneMasked = maskPhone(lead.phone_e164);
                        const emailTrunc = lead.email ? truncateEmail(lead.email) : null;

                        return (
                          <tr
                            key={lead.id}
                            className="group border-t border-border-subtle transition-colors duration-fast"
                            style={{
                              animationDelay: `${idx * 30}ms`,
                            }}
                          >
                            {/* Lead: avatar + nome */}
                            <td className="px-4 py-3.5">
                              <Link
                                to={`/crm/${lead.id}`}
                                className="flex items-center gap-3 hover:text-azul transition-colors group/link"
                                title={`Ver detalhes de ${lead.name}`}
                              >
                                <Avatar
                                  name={lead.name}
                                  variant={avatarVariantForName(lead.name)}
                                  size="md"
                                  className="shrink-0 transition-transform group-hover/link:scale-105 duration-fast"
                                />
                                <div className="min-w-0">
                                  <p
                                    className="font-sans font-semibold text-sm text-ink truncate group-hover/link:text-azul transition-colors"
                                    style={{ maxWidth: 180 }}
                                  >
                                    {lead.name}
                                  </p>
                                  {lead.agent_id && (
                                    <p className="font-sans text-xs text-ink-4 truncate">
                                      Agente atribuído
                                    </p>
                                  )}
                                </div>
                              </Link>
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3.5">
                              <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                            </td>

                            {/* Telefone — LGPD mascarado */}
                            <td className="px-4 py-3.5">
                              <span
                                className="font-mono text-sm text-ink-2"
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '0.8125rem',
                                  letterSpacing: '-0.01em',
                                }}
                              >
                                {phoneMasked}
                              </span>
                            </td>

                            {/* Email — LGPD truncado */}
                            <td className="px-4 py-3.5 hidden lg:table-cell">
                              {emailTrunc ? (
                                <span className="font-sans text-sm text-ink-3">{emailTrunc}</span>
                              ) : (
                                <span className="text-ink-4 text-sm">—</span>
                              )}
                            </td>

                            {/* Canal de origem */}
                            <td className="px-4 py-3.5 hidden md:table-cell">
                              <span className="font-sans text-xs text-ink-3">
                                {SOURCE_LABEL[lead.source] ?? lead.source}
                              </span>
                            </td>

                            {/* Data de criação */}
                            <td className="px-4 py-3.5 hidden xl:table-cell text-right pr-4">
                              <span className="font-sans text-xs text-ink-4">
                                {formatDate(lead.created_at)}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border-subtle">
                  <p className="font-sans text-xs text-ink-3">
                    {(pagination.page - 1) * pagination.limit + 1}–
                    {Math.min(pagination.page * pagination.limit, pagination.total)} de{' '}
                    {pagination.total} leads
                  </p>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pagination.page <= 1}
                      onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
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
                      onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
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
          </>
        )}
      </div>

      {/* Modal de criação */}
      <NewLeadModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
