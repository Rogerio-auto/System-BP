// =============================================================================
// features/contracts/ContractDetail.tsx — Drawer de ficha do contrato (F17-S05, F17-S06).
//
// Exibe todos os campos do ContractSchema.
// Botão "Marcar como assinado" visível apenas quando:
//   - status === 'draft'
//   - usuário tem permissão contracts:sign
//
// F17-S06: adiciona seção "Saúde" (ContractHealthBadge) e seção "Parcelas" (ContractDuesList).
//
// DS:
//   - Drawer lateral: elev-5, border, bg-elev-1 (DS §9 modal).
//   - Overlay translúcido à esquerda.
//   - Bricolage Grotesque para heading, Geist para labels, Mono para valores.
//   - Badge de status §9.5.
//   - Animação: slide da direita (translate-x).
//
// LGPD: exibe apenas dados do contrato — sem CPF do cliente.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../lib/auth-store';

import { ContractDuesList } from './ContractDuesList';
import { ContractHealthBadge } from './ContractHealthBadge';
import { ContractSignModal } from './ContractSignModal';
import { useContract, useSignContract } from './hooks';
import { CONTRACT_STATUS_META } from './schemas';

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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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
// Campo de detalhe
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="flex items-start justify-between gap-4 py-2.5"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <span
        className="font-sans text-ink-3 shrink-0"
        style={{ fontSize: 'var(--text-xs)', paddingTop: 1 }}
      >
        {label}
      </span>
      <span className="font-sans text-ink text-right" style={{ fontSize: 'var(--text-sm)' }}>
        {children}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton de carregamento
// ---------------------------------------------------------------------------

function DrawerSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 mt-6" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-5 rounded-xs animate-pulse"
          style={{
            width: `${50 + ((i * 13) % 40)}%`,
            background: 'var(--surface-muted)',
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ContractDetailProps {
  contractId: string;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function ContractDetail({ contractId, onClose }: ContractDetailProps): React.JSX.Element {
  const { toast } = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canSign = hasPermission('contracts:sign');

  const [showSignModal, setShowSignModal] = React.useState(false);

  const { data: contract, isLoading, isError, refetch } = useContract(contractId);
  const { mutate: signContract, isPending: isSigning } = useSignContract();

  // Fechar com Escape (quando o modal de assinatura não estiver aberto)
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !showSignModal) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showSignModal, onClose]);

  const handleSign = (): void => {
    if (!contract) return;
    signContract(
      { id: contract.id },
      {
        onSuccess: () => {
          toast('Contrato marcado como assinado', 'success');
          setShowSignModal(false);
        },
        onError: (err) => {
          toast(`Erro ao assinar: ${err.message}`, 'danger');
          setShowSignModal(false);
        },
      },
    );
  };

  const statusMeta = contract
    ? (CONTRACT_STATUS_META[contract.status] ?? {
        label: contract.status,
        variant: 'neutral' as const,
      })
    : null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'color-mix(in srgb, var(--text) 40%, transparent)' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        role="complementary"
        aria-label="Detalhes do contrato"
        className="fixed inset-y-0 right-0 z-40 flex flex-col w-full max-w-md"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          borderLeft: '1px solid var(--border)',
          animation: 'slide-in-right 250ms var(--ease-out) both',
        }}
      >
        {/* Header do drawer */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.03em' }}
          >
            Contrato
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-sm text-ink-3 hover:text-ink hover:bg-surface-hover transition-colors"
            aria-label="Fechar detalhes"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && <DrawerSkeleton />}

          {!isLoading && isError && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
                Erro ao carregar o contrato.
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Tentar novamente
              </Button>
            </div>
          )}

          {!isLoading && !isError && contract && (
            <div className="flex flex-col gap-0">
              {/* Badge de status em destaque */}
              <div className="flex items-center gap-2 mb-4">
                {statusMeta && <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>}
                <span
                  className="font-mono font-semibold text-azul"
                  style={{ fontSize: 'var(--text-base)' }}
                >
                  {contract.contract_reference}
                </span>
              </div>

              {/* Seção: Valores */}
              <p
                className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] mb-1 mt-2"
                style={{ fontSize: '0.68rem' }}
              >
                Valores
              </p>

              <DetailRow label="Valor principal">
                <span
                  className="font-mono font-bold text-ink"
                  style={{ fontSize: 'var(--text-base)' }}
                >
                  {formatCurrency(contract.principal_amount)}
                </span>
              </DetailRow>

              <DetailRow label="Prazo">
                <span className="font-mono text-ink-2">
                  {contract.term_months} {contract.term_months === 1 ? 'mês' : 'meses'}
                </span>
              </DetailRow>

              {contract.monthly_rate_snapshot && (
                <DetailRow label="Taxa mensal">
                  <span className="font-mono text-ink-2">
                    {(parseFloat(contract.monthly_rate_snapshot) * 100).toFixed(4)}%
                  </span>
                </DetailRow>
              )}

              {/* Seção: Datas */}
              <p
                className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] mb-1 mt-4"
                style={{ fontSize: '0.68rem' }}
              >
                Datas
              </p>

              <DetailRow label="Criado em">
                <span className="font-mono text-ink-2">{formatDate(contract.created_at)}</span>
              </DetailRow>

              {contract.signed_at && (
                <DetailRow label="Assinado em">
                  <span className="font-mono text-ink-2">{formatDate(contract.signed_at)}</span>
                </DetailRow>
              )}

              <DetailRow label="1ª parcela">
                <span className="font-mono text-ink-2">
                  {formatDateOnly(contract.first_due_date)}
                </span>
              </DetailRow>

              <DetailRow label="Última parcela">
                <span className="font-mono text-ink-2">
                  {formatDateOnly(contract.last_due_date)}
                </span>
              </DetailRow>

              <DetailRow label="Atualizado em">
                <span className="font-mono text-ink-2">{formatDate(contract.updated_at)}</span>
              </DetailRow>

              {/* Seção: Identificadores */}
              <p
                className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] mb-1 mt-4"
                style={{ fontSize: '0.68rem' }}
              >
                Identificadores
              </p>

              <DetailRow label="ID interno">
                <span
                  className="font-mono text-ink-3"
                  style={{ fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}
                >
                  {contract.id}
                </span>
              </DetailRow>

              {/* Seção: Saúde (F17-S06) */}
              <p
                className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] mb-1 mt-4"
                style={{ fontSize: '0.68rem' }}
              >
                Saúde
              </p>
              <ContractHealthBadge contractId={contract.id} />

              {/* Seção: Parcelas (F17-S06) */}
              <p
                className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] mb-1 mt-4"
                style={{ fontSize: '0.68rem' }}
              >
                Parcelas
              </p>
              <ContractDuesList
                contractId={contract.id}
                customerId={contract.customer_id}
                contractReference={contract.contract_reference}
              />
            </div>
          )}
        </div>

        {/* Footer com ação de assinatura */}
        {!isLoading && !isError && contract?.status === 'draft' && canSign && (
          <div
            className="shrink-0 px-6 py-4"
            style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elev-2)' }}
          >
            <Button
              variant="primary"
              onClick={() => setShowSignModal(true)}
              disabled={isSigning}
              className="w-full justify-center"
              leftIcon={
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M2 12l3-1 7-7-2-2-7 7-1 3Z" strokeLinejoin="round" />
                  <path d="M12 2l2 2" strokeLinecap="round" />
                </svg>
              }
            >
              Marcar como assinado
            </Button>
          </div>
        )}
      </aside>

      {/* Modal de confirmação de assinatura */}
      {showSignModal && contract && (
        <ContractSignModal
          contract={contract}
          onConfirm={handleSign}
          onCancel={() => setShowSignModal(false)}
          isPending={isSigning}
        />
      )}
    </>
  );
}
