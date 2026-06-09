// =============================================================================
// features/credit-analyses/CreditAnalysesListPage.tsx — /credit-analyses
//
// Lista paginada de análises de crédito com filtros (status, analista, período).
//
// DS:
//   - Tabela densa (§9.7): th caption-style, hover de linha, JetBrains Mono
//     em valores monetários.
//   - Filtros: Input + Select canônicos.
//   - Stats KPI no topo: 3 cards Stat.
//   - Loading skeletons (não spinner sozinho).
//   - Empty state com CTA.
//   - Error state com retry.
//   - Badge de cidade com city-scope (backend filtra, UI exibe como info).
//
// LGPD: nenhum PII de lead é exibido nesta tela (apenas IDs opacos).
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../lib/auth-store';
import { cn } from '../../lib/cn';
import { ContextualHelp } from '../help/contextual';

import { CreditAnalysisModal } from './components/CreditAnalysisForm';
import { CreditAnalysisStatusBadge } from './components/CreditAnalysisStatusBadge';
import { useCreditAnalysesList } from './hooks/useCreditAnalyses';
import type {
  CreditAnalysisFilters,
  CreditAnalysisResponse,
  CreditAnalysisStatus,
} from './schemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: string | null): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'recusado', label: 'Recusado' },
  { value: 'cancelado', label: 'Cancelado' },
];

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          <td className="px-4 py-3.5">
            <div
              className="h-4 rounded-xs animate-pulse"
              style={{ width: 120 + ((i * 13) % 80), background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-3.5">
            <div
              className="h-5 w-20 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-3.5 hidden md:table-cell">
            <div
              className="h-4 w-24 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-3.5 hidden lg:table-cell">
            <div
              className="h-4 w-20 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-3.5 hidden xl:table-cell text-right">
            <div
              className="h-4 w-24 rounded-xs animate-pulse ml-auto"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={5}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <svg
            viewBox="0 0 120 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-28 h-auto opacity-40"
            aria-hidden="true"
          >
            <ellipse cx="60" cy="88" rx="48" ry="7" fill="var(--surface-muted)" />
            <rect
              x="20"
              y="18"
              width="80"
              height="62"
              rx="7"
              fill="var(--bg-elev-2)"
              stroke="var(--border-strong)"
              strokeWidth="1.5"
            />
            <rect x="20" y="18" width="80" height="14" rx="7" fill="var(--surface-muted)" />
            <rect x="30" y="44" width="28" height="3" rx="1.5" fill="var(--border-strong)" />
            <rect x="30" y="52" width="60" height="3" rx="1.5" fill="var(--border-strong)" />
            <rect x="30" y="60" width="44" height="3" rx="1.5" fill="var(--border-strong)" />
            <circle cx="92" cy="26" r="13" fill="var(--brand-azul)" />
            <path d="M92 20v12M86 26h12" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
          <div className="flex flex-col gap-1">
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
            >
              Nenhuma análise encontrada
            </p>
            <p className="font-sans text-sm text-ink-3 max-w-xs">
              Crie a primeira análise de crédito para um lead.
            </p>
          </div>
          <Button
            variant="primary"
            onClick={onNew}
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
            Nova análise
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ─── Linha da tabela ──────────────────────────────────────────────────────────

function AnalysisRow({
  analysis,
  idx,
}: {
  analysis: CreditAnalysisResponse;
  idx: number;
}): React.JSX.Element {
  return (
    <tr
      key={analysis.id}
      className="group border-t border-border-subtle transition-colors duration-fast hover:bg-surface-hover"
      style={{ animationDelay: `${idx * 25}ms` }}
    >
      {/* ID opaco com link */}
      <td className="px-4 py-3.5">
        <Link
          to={`/credit-analyses/${analysis.id}`}
          className="font-mono text-sm text-azul hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
          title={`Ver análise ${analysis.id}`}
        >
          {analysis.id.slice(0, 8)}…
        </Link>
        <p className="font-sans text-xs text-ink-4 mt-0.5">Lead: {analysis.lead_id.slice(0, 8)}…</p>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <CreditAnalysisStatusBadge status={analysis.status} />
      </td>

      {/* Valor aprovado */}
      <td className="px-4 py-3.5 hidden md:table-cell">
        <span
          className="font-mono text-sm text-ink-2"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8125rem',
            letterSpacing: '-0.01em',
          }}
        >
          {formatBRL(analysis.approved_amount)}
        </span>
      </td>

      {/* Origem */}
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <Badge variant="neutral">{analysis.origin === 'manual' ? 'Manual' : 'Importação'}</Badge>
      </td>

      {/* Data */}
      <td className="px-4 py-3.5 hidden xl:table-cell text-right pr-4">
        <span className="font-sans text-xs text-ink-4">{formatDate(analysis.created_at)}</span>
      </td>
    </tr>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * CreditAnalysesListPage — /credit-analyses
 * Lista paginada de análises de crédito com filtros e paginação server-side.
 */
export function CreditAnalysesListPage(): React.JSX.Element {
  const { toast } = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('credit_analyses:write');

  const [modalOpen, setModalOpen] = React.useState(false);
  const [filters, setFilters] = React.useState<CreditAnalysisFilters>({
    page: 1,
    limit: 20,
  });
  const [statusFilter, setStatusFilter] = React.useState<CreditAnalysisStatus | ''>('');

  const { data, isLoading, isError, refetch } = useCreditAnalysesList(filters);

  const analyses = data?.data ?? [];
  const pagination = data?.pagination;

  // Stats rápidas derivadas dos dados carregados
  const stats = React.useMemo(() => {
    if (!data) return null;
    const total = pagination?.total ?? 0;
    const aprovadas = analyses.filter((a) => a.status === 'aprovado').length;
    const emAnalise = analyses.filter((a) => a.status === 'em_analise').length;
    return { total, aprovadas, emAnalise };
  }, [data, analyses, pagination]);

  const handleStatusChange = (value: string): void => {
    const status = value as CreditAnalysisStatus | '';
    setStatusFilter(status);
    if (status) {
      setFilters((f) => ({ ...f, status, page: 1 }));
    } else {
      setFilters((f) => {
        const { status: _s, ...rest } = f;
        return { ...rest, page: 1 };
      });
    }
  };

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* Header da página */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-1">
              <h1
                className="font-display font-bold text-ink"
                style={{
                  fontSize: 'var(--text-3xl)',
                  letterSpacing: '-0.04em',
                  fontVariationSettings: "'opsz' 48",
                }}
              >
                Análises de crédito
              </h1>
              {/* ⓘ tutorial de análise de crédito — norma 21 §7 */}
              <ContextualHelp featureKey="credit.analysis.create" className="ml-0.5" />
            </div>
            <p className="font-sans text-sm text-ink-3 mt-1">
              Gerencie pareceres e decisões de crédito
            </p>
          </div>

          {canWrite && (
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
              Nova análise
            </Button>
          )}
        </div>

        {/* Stats row */}
        {stats && (
          <div
            className="grid grid-cols-1 sm:grid-cols-3 gap-4"
            style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
          >
            {[
              { label: 'Total', value: stats.total, description: 'Análises na cidade' },
              { label: 'Em análise', value: stats.emAnalise, description: 'Aguardando parecer' },
              { label: 'Aprovadas', value: stats.aprovadas, description: 'Nesta página' },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-md border border-border bg-surface-1 p-5"
                style={{ boxShadow: 'var(--elev-2)' }}
              >
                <p
                  className="font-sans font-bold text-ink-3 uppercase mb-2"
                  style={{ fontSize: '0.7rem', letterSpacing: '0.1em' }}
                >
                  {stat.label}
                </p>
                <p
                  className="font-display font-bold text-ink"
                  style={{
                    fontSize: 'var(--text-2xl)',
                    letterSpacing: '-0.04em',
                    fontVariationSettings: "'opsz' 32",
                  }}
                >
                  {stat.value}
                </p>
                <p className="font-sans text-xs text-ink-4 mt-1">{stat.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div
          className="flex flex-wrap gap-3 items-end"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
        >
          <div className="w-[180px]">
            <Select
              id="ca-status-filter"
              options={STATUS_FILTER_OPTIONS}
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              aria-label="Filtrar por status"
            />
          </div>
        </div>

        {/* Tabela */}
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
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  {[
                    { label: 'Análise / Lead', className: 'pl-4 pr-4' },
                    { label: 'Status', className: 'px-4 w-[130px]' },
                    { label: 'Valor aprovado', className: 'px-4 hidden md:table-cell w-[140px]' },
                    { label: 'Origem', className: 'px-4 hidden lg:table-cell w-[110px]' },
                    {
                      label: 'Criado em',
                      className: 'px-4 hidden xl:table-cell w-[120px] text-right pr-4',
                    },
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
                    <td colSpan={5} className="px-4 py-12 text-center">
                      <p className="font-sans text-sm text-danger">Erro ao carregar análises.</p>
                      <button
                        type="button"
                        className="mt-2 font-sans text-xs text-azul hover:underline"
                        onClick={() => void refetch()}
                      >
                        Tentar novamente
                      </button>
                    </td>
                  </tr>
                ) : analyses.length === 0 ? (
                  <EmptyState onNew={() => setModalOpen(true)} />
                ) : (
                  analyses.map((analysis, idx) => (
                    <AnalysisRow key={analysis.id} analysis={analysis} idx={idx} />
                  ))
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
                {pagination.total}
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
      </div>

      {/* Modal de criação */}
      <CreditAnalysisModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          toast('Análise criada com sucesso!', 'success');
          setModalOpen(false);
        }}
        onError={(msg) => toast(msg, 'danger')}
      />
    </>
  );
}
