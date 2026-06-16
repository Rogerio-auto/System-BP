// =============================================================================
// features/contracts/ContractsPage.tsx — /contratos (F17-S05, F17-S11).
//
// Lista filtrável de contratos por status com paginação.
// Clicar na linha abre ContractDetail (drawer lateral).
// Botão "Novo Contrato" abre ContractCreateModal (gate: contracts:write).
//
// DS:
//   - Tabela densa §9.7: th caption-style, hover linha.
//   - Badges de status semânticos §9.5.
//   - JetBrains Mono em valores monetários e referências (--font-mono).
//   - Loading skeletons, empty state, error+retry.
//   - Paginação funcional.
//   - font-display para h1 (Bricolage Grotesque), font-sans para body (Geist).
//
// LGPD: listagem não expõe CPF ou contato do cliente — apenas dados do contrato.
//
// Permissões:
//   - contracts:read  — ver lista (verificado no backend, UI não oculta a rota).
//   - contracts:sign  — ação de assinatura (gate no drawer).
//   - contracts:write — botão "Novo Contrato" + modal de criação.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';
import { useAuthStore } from '../../lib/auth-store';

import { ContractCreateModal } from './ContractCreateModal';
import { ContractDetail } from './ContractDetail';
import { useContracts } from './hooks';
import { CONTRACT_STATUS_META, CONTRACT_STATUS_OPTIONS, type ContractsFilters } from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(parseFloat(value));
}

function formatDateOnly(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 7 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          {Array.from({ length: 6 }).map((__, j) => (
            <td key={j} className="px-4 py-3.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{
                  width: 48 + ((i * 11 + j * 17) % 100),
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
      <td colSpan={6}>
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <svg
            viewBox="0 0 80 80"
            fill="none"
            className="w-20 h-auto opacity-40"
            aria-hidden="true"
          >
            <rect
              x="16"
              y="10"
              width="48"
              height="60"
              rx="4"
              stroke="var(--border-strong)"
              strokeWidth="1.5"
            />
            <path
              d="M28 28h24M28 38h24M28 48h16"
              stroke="var(--border-strong)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-base)' }}>
            {hasFilters ? 'Nenhum contrato com esse status' : 'Nenhum contrato cadastrado'}
          </p>
          <p className="font-sans text-ink-3 max-w-xs" style={{ fontSize: 'var(--text-sm)' }}>
            {hasFilters
              ? 'Tente outro filtro ou limpe o status selecionado.'
              : 'Contratos são criados automaticamente quando uma análise de crédito é aprovada.'}
          </p>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Paginação
// ---------------------------------------------------------------------------

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (p: number) => void;
}

function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: PaginationProps): React.JSX.Element | null {
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
        {total} contratos · página {page} de {totalPages}
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
// Coluna de cabeçalho
// ---------------------------------------------------------------------------

const TABLE_COLUMNS = ['Referência', 'Status', 'Valor', 'Prazo', '1ª Parcela', 'Criado em'];

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export function ContractsPage(): React.JSX.Element {
  const [filters, setFilters] = React.useState<ContractsFilters>({ page: 1, per_page: 20 });
  const [statusFilter, setStatusFilter] = React.useState('');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate = hasPermission('contracts:write');

  const { data, isLoading, isError, refetch } = useContracts(filters);

  const contracts = data?.data ?? [];
  const pagination = data?.pagination;
  const hasFilters = Boolean(statusFilter);

  const handleStatusChange = (value: string): void => {
    setStatusFilter(value);
    if (value) {
      setFilters((f) => ({ ...f, status: value, page: 1 }));
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

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
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
              Contratos
            </h1>
            <p className="font-sans text-ink-3 mt-1" style={{ fontSize: 'var(--text-sm)' }}>
              Gerencie contratos de crédito e registre assinaturas.
            </p>
          </div>

          {/* Botão "Novo Contrato" — gate: contracts:write */}
          {canCreate && (
            <Button
              variant="primary"
              onClick={() => setCreateModalOpen(true)}
              leftIcon={
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M8 3v10M3 8h10" strokeLinecap="round" />
                </svg>
              }
            >
              Novo Contrato
            </Button>
          )}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 items-end">
          <Select
            id="filter-status"
            label="Status"
            value={statusFilter}
            options={CONTRACT_STATUS_OPTIONS}
            onChange={(e) => handleStatusChange(e.target.value)}
            wrapperClassName="w-52"
          />
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatusFilter('');
                setFilters({ page: 1, per_page: 20 });
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>

        {/* Barra de totais */}
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
            {statusFilter &&
              CONTRACT_STATUS_META[statusFilter as keyof typeof CONTRACT_STATUS_META] && (
                <>
                  <span className="text-border-strong mx-1">·</span>
                  <Badge
                    variant={
                      CONTRACT_STATUS_META[statusFilter as keyof typeof CONTRACT_STATUS_META]
                        .variant
                    }
                  >
                    {CONTRACT_STATUS_META[statusFilter as keyof typeof CONTRACT_STATUS_META].label}
                  </Badge>
                </>
              )}
          </div>
        )}

        {/* Tabela — DS §9.7 */}
        <div
          className="overflow-hidden rounded-md"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse" aria-label="Contratos de crédito">
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)' }}>
                  {TABLE_COLUMNS.map((col) => (
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
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && <TableSkeleton />}

                {!isLoading && isError && (
                  <tr>
                    <td colSpan={6}>
                      <div className="flex flex-col items-center gap-3 py-12 text-center">
                        <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
                          Erro ao carregar contratos.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => void refetch()}>
                          Tentar novamente
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}

                {!isLoading && !isError && contracts.length === 0 && (
                  <EmptyState hasFilters={hasFilters} />
                )}

                {!isLoading &&
                  !isError &&
                  contracts.map((contract) => {
                    const meta = CONTRACT_STATUS_META[contract.status] ?? {
                      label: contract.status,
                      variant: 'neutral' as const,
                    };

                    return (
                      <tr
                        key={contract.id}
                        className="transition-colors duration-fast cursor-pointer"
                        style={{ borderBottom: '1px solid var(--border-subtle)' }}
                        onClick={() => setSelectedId(contract.id)}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLTableRowElement).style.background =
                            'var(--surface-hover)';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`Ver contrato ${contract.contract_reference}`}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedId(contract.id);
                          }
                        }}
                      >
                        {/* Referência */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono font-semibold text-azul"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {contract.contract_reference}
                          </span>
                        </td>

                        {/* Status badge */}
                        <td className="px-4 py-3.5">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>

                        {/* Valor principal — JetBrains Mono §9.7 */}
                        <td className="px-4 py-3.5">
                          <span
                            className="font-mono font-semibold text-ink"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {formatCurrency(contract.principal_amount)}
                          </span>
                        </td>

                        {/* Prazo */}
                        <td className="px-4 py-3.5 hidden sm:table-cell">
                          <span
                            className="font-mono text-ink-2"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {contract.term_months}m
                          </span>
                        </td>

                        {/* 1ª parcela */}
                        <td className="px-4 py-3.5 hidden md:table-cell">
                          <span
                            className="font-mono text-ink-2"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {formatDateOnly(contract.first_due_date)}
                          </span>
                        </td>

                        {/* Criado em */}
                        <td className="px-4 py-3.5 hidden lg:table-cell">
                          <span
                            className="font-mono text-ink-3"
                            style={{ fontSize: 'var(--text-sm)' }}
                          >
                            {new Date(contract.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </td>
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
              totalPages={pagination.total_pages}
              total={pagination.total}
              onPageChange={handlePageChange}
            />
          )}
        </div>
      </div>

      {/* Drawer de detalhe */}
      {selectedId && <ContractDetail contractId={selectedId} onClose={() => setSelectedId(null)} />}

      {/* Modal de criação — gate contracts:write */}
      {createModalOpen && (
        <ContractCreateModal
          onClose={() => setCreateModalOpen(false)}
          onCreated={(contractId) => {
            setCreateModalOpen(false);
            // Abre o drawer de detalhe do contrato criado
            setSelectedId(contractId);
          }}
        />
      )}
    </>
  );
}
