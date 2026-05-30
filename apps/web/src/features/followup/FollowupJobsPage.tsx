// =============================================================================
// features/followup/FollowupJobsPage.tsx — /admin/followup/jobs
//
// Lista paginada de jobs agendados com filtros + ação de cancelamento manual.
//
// DS:
//   - Tabela densa §9.7: th caption-style, hover linha.
//   - Badges de status semânticos (§9.5).
//   - JetBrains Mono em datas agendadas e IDs.
//   - Loading skeletons, empty state, error+retry.
//   - Paginação funcional.
//   - Banner de módulo desligado.
//
// LGPD:
//   - lead_name: apenas primeiro nome (backend retorna split_part).
//   - Sem conteúdo de mensagem — apenas template_key.
//   - Sem phone, cpf, email na listagem.
//
// Permissões:
//   - followup:read       — ver lista.
//   - followup:cancel_job — ação de cancelar.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuthStore } from '../../lib/auth-store';

import { FollowupDisabledBanner } from './FollowupBanner';
import { useCancelFollowupJob, useFollowupJobs } from './hooks/useFollowup';
import type { FollowupJobStatus, FollowupJobsFilters } from './schemas';
import { CANCELLABLE_STATUSES, JOB_STATUS_META } from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatScheduledAt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 6 }).map((__, j) => (
            <td key={j} className="px-4 py-3.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{
                  width: 50 + ((i * 11 + j * 17) % 100),
                  background: 'var(--surface-muted)',
                }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ hasFilters }: { hasFilters: boolean }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={7}>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <svg
            viewBox="0 0 80 80"
            fill="none"
            className="w-20 h-auto opacity-40"
            aria-hidden="true"
          >
            <circle cx="40" cy="40" r="32" stroke="var(--border-strong)" strokeWidth="1.5" />
            <path
              d="M26 40h28M40 26v28"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="4 4"
            />
            <circle cx="40" cy="40" r="6" fill="var(--surface-muted)" />
          </svg>
          <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-base)' }}>
            {hasFilters ? 'Nenhum job encontrado com esses filtros' : 'Nenhum job agendado'}
          </p>
          <p className="font-sans text-ink-3 max-w-xs" style={{ fontSize: 'var(--text-sm)' }}>
            {hasFilters
              ? 'Tente ajustar os filtros aplicados.'
              : 'Jobs aparecem aqui quando réguas ativas disparam para leads inativos.'}
          </p>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

function Pagination({ page, totalPages, onPageChange }: PaginationProps): React.JSX.Element | null {
  if (totalPages <= 1) return null;

  return (
    <div
      className="px-4 py-3 flex items-center justify-between"
      style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elev-2)' }}
    >
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Anterior
      </Button>
      <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
        Página {page} de {totalPages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Próxima
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancel confirmation dialog
// ---------------------------------------------------------------------------

interface CancelDialogProps {
  jobId: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function CancelDialog({ onConfirm, onCancel, isPending }: CancelDialogProps): React.JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(14, 20, 40, 0.6)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar cancelamento"
    >
      <div
        className="w-full max-w-sm rounded-md flex flex-col gap-5 p-6"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          animation: 'fade-up 200ms var(--ease-out) both',
        }}
      >
        <div className="flex flex-col gap-1.5">
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
          >
            Cancelar job?
          </h2>
          <p className="font-sans text-ink-2" style={{ fontSize: 'var(--text-sm)' }}>
            O job será marcado como cancelado e não será enviado. Esta ação não pode ser desfeita.
          </p>
        </div>
        <div className="flex gap-3 justify-end">
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            Voltar
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={isPending}>
            {isPending ? 'Cancelando...' : 'Confirmar cancelamento'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'scheduled', label: 'Agendado' },
  { value: 'triggered', label: 'Em envio' },
  { value: 'sent', label: 'Enviado' },
  { value: 'failed', label: 'Falhou' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'customer_replied', label: 'Cliente respondeu' },
];

export function FollowupJobsPage(): React.JSX.Element {
  const { toast } = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCancel = hasPermission('followup:cancel_job');
  const { enabled: followupEnabled } = useFeatureFlag('followup.enabled');

  const [filters, setFilters] = React.useState<FollowupJobsFilters>({ page: 1, limit: 20 });
  const [statusFilter, setStatusFilter] = React.useState<FollowupJobStatus | ''>('');
  const [confirmingJobId, setConfirmingJobId] = React.useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useFollowupJobs(filters);
  const { mutate: cancelJob, isPending: isCancelling } = useCancelFollowupJob();

  const jobs = data?.data ?? [];
  const pagination = data?.pagination;
  const hasFilters = Boolean(statusFilter);

  const handleStatusChange = (value: string): void => {
    const status = value as FollowupJobStatus | '';
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

  const handlePageChange = (page: number): void => {
    setFilters((f) => ({ ...f, page }));
  };

  const handleCancelConfirm = (): void => {
    if (!confirmingJobId) return;

    cancelJob(confirmingJobId, {
      onSuccess: () => {
        toast('Job cancelado com sucesso', 'success');
        setConfirmingJobId(null);
      },
      onError: (err) => {
        toast(`Erro ao cancelar: ${err.message}`, 'danger');
        setConfirmingJobId(null);
      },
    });
  };

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* Banner módulo desligado */}
        {!followupEnabled && <FollowupDisabledBanner />}

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-3xl)',
                letterSpacing: '-0.04em',
                fontVariationSettings: "'opsz' 48",
              }}
            >
              Jobs Agendados
            </h1>
            <p className="font-sans text-ink-3 mt-1" style={{ fontSize: 'var(--text-sm)' }}>
              Monitorar e gerenciar envios de follow-up pendentes e históricos.
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-end">
          <Select
            id="filter-status"
            label="Status"
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(e) => handleStatusChange(e.target.value)}
            wrapperClassName="w-48"
          />
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter('');
                setFilters({ page: 1, limit: 20 });
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>

        {/* Stats quick bar */}
        {pagination && !isLoading && (
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-sm"
            style={{
              background: 'var(--bg-elev-2)',
              border: '1px solid var(--border)',
              boxShadow: 'var(--elev-1)',
            }}
          >
            <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Total:
            </span>
            <span
              className="font-mono font-semibold text-ink"
              style={{ fontSize: 'var(--text-sm)' }}
            >
              {pagination.total}
            </span>
            {statusFilter && (
              <>
                <span className="text-border-strong mx-1">·</span>
                <Badge variant={JOB_STATUS_META[statusFilter]?.variant ?? 'neutral'}>
                  {JOB_STATUS_META[statusFilter]?.label ?? statusFilter}
                </Badge>
              </>
            )}
          </div>
        )}

        {/* Tabela */}
        <div
          className="overflow-hidden rounded-md"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" aria-label="Jobs de follow-up">
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  {['Lead', 'Régua', 'Template', 'Agendado para', 'Tentativas', 'Status'].map(
                    (col) => (
                      <th
                        key={col}
                        className="px-4 py-2.5 text-left font-sans font-bold uppercase text-ink-3"
                        style={{
                          fontSize: '0.7rem',
                          letterSpacing: '0.08em',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        {col}
                      </th>
                    ),
                  )}
                  {canCancel && (
                    <th
                      className="px-4 py-2.5 text-right font-sans font-bold uppercase text-ink-3"
                      style={{
                        fontSize: '0.7rem',
                        letterSpacing: '0.08em',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      Ações
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading && <TableSkeleton />}

                {!isLoading && isError && (
                  <tr>
                    <td colSpan={canCancel ? 7 : 6}>
                      <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
                          Erro ao carregar jobs.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => void refetch()}>
                          Tentar novamente
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}

                {!isLoading && !isError && jobs.length === 0 && (
                  <EmptyState hasFilters={hasFilters} />
                )}

                {!isLoading &&
                  !isError &&
                  jobs.map((job) => {
                    const statusMeta = JOB_STATUS_META[job.status];
                    const isCancellable = CANCELLABLE_STATUSES.includes(job.status);

                    return (
                      <tr
                        key={job.id}
                        className="transition-colors duration-fast"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLTableRowElement).style.background =
                            'var(--surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                        }}
                      >
                        {/* Lead — nome curto (LGPD: primeiro nome apenas) */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-sans font-medium text-ink"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {job.lead_name ?? '—'}
                          </span>
                        </td>

                        {/* Régua */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono font-semibold text-azul"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {job.rule_key ?? '—'}
                          </span>
                        </td>

                        {/* Template — key apenas, sem body */}
                        <td className="px-4 py-3.5 hidden md:table-cell">
                          <span
                            className="font-mono text-ink-2"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {job.template_key ?? '—'}
                          </span>
                        </td>

                        {/* Data agendada */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono text-ink-2"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {formatScheduledAt(job.scheduled_at)}
                          </span>
                        </td>

                        {/* Tentativas */}
                        <td className="px-4 py-3.5 hidden lg:table-cell">
                          <span
                            className="font-mono text-ink-3"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {job.attempt_count}
                          </span>
                        </td>

                        {/* Status badge */}
                        <td className="px-4 py-3.5">
                          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                          {job.last_error && (
                            <p
                              className="font-sans text-danger mt-0.5 max-w-[200px] truncate"
                              style={{ fontSize: '0.65rem' }}
                              title={job.last_error}
                            >
                              {job.last_error}
                            </p>
                          )}
                        </td>

                        {/* Cancelar */}
                        {canCancel && (
                          <td className="px-4 py-3.5 text-right">
                            {isCancellable ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmingJobId(job.id)}
                                aria-label={`Cancelar job para ${job.lead_name ?? 'lead'}`}
                              >
                                Cancelar
                              </Button>
                            ) : (
                              <span
                                className="font-sans text-ink-4"
                                style={{ fontSize: 'var(--text-xs)' }}
                              >
                                —
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {pagination && (
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      </div>

      {/* Dialog de confirmação de cancelamento */}
      {confirmingJobId && (
        <CancelDialog
          jobId={confirmingJobId}
          onConfirm={handleCancelConfirm}
          onCancel={() => setConfirmingJobId(null)}
          isPending={isCancelling}
        />
      )}
    </>
  );
}
