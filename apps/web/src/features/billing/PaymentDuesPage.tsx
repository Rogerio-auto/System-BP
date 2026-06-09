// =============================================================================
// features/billing/PaymentDuesPage.tsx — /admin/billing/dues
//
// Lista paginada de parcelas de crédito com filtros + ações de marcação manual.
//
// DS:
//   - Tabela densa §9.7: th caption-style, hover linha.
//   - Badges de status semânticos (§9.5).
//   - JetBrains Mono em valores monetários e referências.
//   - Loading skeletons, empty state, error+retry.
//   - Paginação funcional.
//   - Banner de módulo desligado quando billing.enabled=disabled.
//
// LGPD:
//   - customer_name: apenas primeiro nome (backend retorna split_part).
//   - Sem CPF, telefone, email na listagem.
//
// Permissões:
//   - billing:read      — ver lista.
//   - billing:mark_paid — modal de marcação.
// =============================================================================
import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuthStore } from '../../lib/auth-store';
import { ContextualHelp } from '../help/contextual';

import { BillingGatedBanner } from './components/BillingGatedBanner';
import { MarkPaidModal } from './components/MarkPaidModal';
import {
  useMarkPaymentDuePaid,
  usePaymentDues,
  useRenegotiatePaymentDue,
} from './hooks/useBilling';
import type { PaymentDueResponse, PaymentDueStatus, PaymentDuesFilters } from './schemas';
import { DUE_STATUS_META, MARKABLE_DUE_STATUSES } from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatAmount(amount: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(parseFloat(amount));
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 7 }).map((__, j) => (
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
      <td colSpan={8}>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <svg
            viewBox="0 0 80 80"
            fill="none"
            className="w-20 h-auto opacity-40"
            aria-hidden="true"
          >
            <circle cx="40" cy="40" r="32" stroke="var(--border-strong)" strokeWidth="1.5" />
            <path
              d="M28 40h24M40 28v24"
              stroke="var(--border-strong)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="4 4"
            />
          </svg>
          <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-base)' }}>
            {hasFilters ? 'Nenhuma parcela com esses filtros' : 'Nenhuma parcela cadastrada'}
          </p>
          <p className="font-sans text-ink-3 max-w-xs" style={{ fontSize: 'var(--text-sm)' }}>
            {hasFilters
              ? 'Tente ajustar os filtros aplicados.'
              : 'Importe parcelas via pipeline de importação ou aguarde o sistema de crédito cadastrar.'}
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
// Status filter options
// ---------------------------------------------------------------------------

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendente' },
  { value: 'overdue', label: 'Vencida' },
  { value: 'paid', label: 'Paga' },
  { value: 'renegotiated', label: 'Renegociada' },
  { value: 'cancelled', label: 'Cancelada' },
];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function PaymentDuesPage(): React.JSX.Element {
  const { toast } = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canMarkPaid = hasPermission('billing:mark_paid');
  const { enabled: billingEnabled } = useFeatureFlag('billing.enabled');

  const [filters, setFilters] = React.useState<PaymentDuesFilters>({ page: 1, limit: 20 });
  const [statusFilter, setStatusFilter] = React.useState<PaymentDueStatus | ''>('');
  const [selectedDue, setSelectedDue] = React.useState<PaymentDueResponse | null>(null);

  const { data, isLoading, isError, refetch } = usePaymentDues(filters);
  const { mutate: markPaid, isPending: isMarkingPaid } = useMarkPaymentDuePaid();
  const { mutate: renegotiate, isPending: isRenegotiating } = useRenegotiatePaymentDue();

  const dues = data?.data ?? [];
  const pagination = data?.pagination;
  const hasFilters = Boolean(statusFilter);
  const isPending = isMarkingPaid || isRenegotiating;

  const handleStatusChange = (value: string): void => {
    const status = value as PaymentDueStatus | '';
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

  const handleMarkPaid = (): void => {
    if (!selectedDue) return;
    markPaid(selectedDue.id, {
      onSuccess: () => {
        toast('Parcela marcada como paga', 'success');
        setSelectedDue(null);
      },
      onError: (err) => {
        toast(`Erro: ${err.message}`, 'danger');
        setSelectedDue(null);
      },
    });
  };

  const handleRenegotiate = (): void => {
    if (!selectedDue) return;
    renegotiate(selectedDue.id, {
      onSuccess: () => {
        toast('Parcela marcada como renegociada', 'success');
        setSelectedDue(null);
      },
      onError: (err) => {
        toast(`Erro: ${err.message}`, 'danger');
        setSelectedDue(null);
      },
    });
  };

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <Link
            to="/configuracoes"
            className="font-sans text-sm text-ink-3 hover:text-azul transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M10 4l-4 4 4 4" />
            </svg>
            Configurações
          </Link>
          <span className="text-ink-4 text-sm">/</span>
          <span className="font-sans text-sm text-ink">Cobrança — Parcelas</span>
        </div>

        {/* Banner módulo desligado */}
        {!billingEnabled && <BillingGatedBanner />}

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
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
                Parcelas
              </h1>
              {/* ⓘ tutorial de parcelas — norma 21 §7 */}
              <ContextualHelp
                featureKey="billing.due.register"
                permission="billing:read"
                className="ml-0.5"
              />
            </div>
            <p className="font-sans text-ink-3 mt-1" style={{ fontSize: 'var(--text-sm)' }}>
              Gestão de parcelas de crédito e registro de pagamentos.
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
                <Badge variant={DUE_STATUS_META[statusFilter]?.variant ?? 'neutral'}>
                  {DUE_STATUS_META[statusFilter]?.label ?? statusFilter}
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
            <table className="w-full border-collapse" aria-label="Parcelas de crédito">
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  {['Cliente', 'Contrato', 'Parcela', 'Vencimento', 'Valor', 'Status'].map(
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
                  {canMarkPaid && (
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
                    <td colSpan={canMarkPaid ? 7 : 6}>
                      <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
                          Erro ao carregar parcelas.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => void refetch()}>
                          Tentar novamente
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}

                {!isLoading && !isError && dues.length === 0 && (
                  <EmptyState hasFilters={hasFilters} />
                )}

                {!isLoading &&
                  !isError &&
                  dues.map((due) => {
                    const statusMeta = DUE_STATUS_META[due.status];
                    const isMarkable = MARKABLE_DUE_STATUSES.includes(due.status);

                    return (
                      <tr
                        key={due.id}
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
                        {/* Cliente — primeiro nome (LGPD) */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-sans font-medium text-ink"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {due.customer_name ?? '—'}
                          </span>
                        </td>

                        {/* Contrato */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono font-semibold text-azul"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {due.contract_reference}
                          </span>
                        </td>

                        {/* Número da parcela */}
                        <td className="px-4 py-3.5 hidden md:table-cell">
                          <span
                            className="font-mono text-ink-3"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            #{due.installment_number}
                          </span>
                        </td>

                        {/* Vencimento */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono text-ink-2"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {formatDate(due.due_date)}
                          </span>
                        </td>

                        {/* Valor — JetBrains Mono para dado monetário */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono font-semibold text-ink"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {formatAmount(due.amount)}
                          </span>
                        </td>

                        {/* Status badge */}
                        <td className="px-4 py-3.5">
                          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                        </td>

                        {/* Ações */}
                        {canMarkPaid && (
                          <td className="px-4 py-3.5 text-right">
                            {isMarkable ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSelectedDue(due)}
                                aria-label={`Registrar pagamento para ${due.customer_name ?? 'cliente'}`}
                              >
                                Registrar
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

      {/* Modal de marcação manual */}
      {selectedDue && (
        <MarkPaidModal
          due={selectedDue}
          onMarkPaid={handleMarkPaid}
          onRenegotiate={handleRenegotiate}
          onCancel={() => setSelectedDue(null)}
          isPending={isPending}
        />
      )}
    </>
  );
}
