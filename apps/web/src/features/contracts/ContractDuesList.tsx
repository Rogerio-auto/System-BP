// =============================================================================
// features/contracts/ContractDuesList.tsx — Lista de parcelas do contrato (F17-S06).
//
// Lista as payment_dues vinculadas a um contrato específico.
// Reutiliza BoletoModal de billing (importado, nunca duplicado).
//
// Layout de cada parcela:
//   [#N]  [vencimento]  [valor]  [status badge]  [botão boleto]
//
// Estados:
//   loading → skeleton (3 linhas)
//   empty   → mensagem com ícone
//   error   → mensagem + retry
//   data    → lista de parcelas
//
// DS:
//   - Tokens DS — sem hex hardcoded.
//   - Hover de linha: background var(--surface-hover).
//   - Badge de status via DUE_STATUS_META de billing.
//   - Tipografia: Geist para labels, Mono para números e valores.
//   - Elevação: var(--elev-1) no card container.
//
// LGPD: exibe apenas dados da parcela — customer_name é primeiro nome (vem da API).
//       Não exibe CPF ou telefone.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../components/ui/Badge';
import type { BadgeVariant } from '../../components/ui/Badge';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useAuthStore } from '../../lib/auth-store';
// BoletoModal importado diretamente — não está no barrel do billing
import { DUE_STATUS_META } from '../billing';
import type { PaymentDueResponse } from '../billing';
import { BoletoModal } from '../billing/components/BoletoModal';

import { useContractDues } from './hooks';

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

function formatDateOnly(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function DuesListSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0" aria-hidden="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3 animate-pulse"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div
            className="h-4 rounded-xs"
            style={{ width: 24, background: 'var(--surface-muted)' }}
          />
          <div
            className="h-4 rounded-xs flex-1"
            style={{ width: '30%', background: 'var(--surface-muted)' }}
          />
          <div
            className="h-4 rounded-xs"
            style={{ width: 64, background: 'var(--surface-muted)' }}
          />
          <div
            className="h-5 rounded-full"
            style={{ width: 60, background: 'var(--surface-muted)' }}
          />
          <div
            className="h-6 rounded-xs"
            style={{ width: 72, background: 'var(--surface-muted)' }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha da parcela
// ---------------------------------------------------------------------------

interface DueRowProps {
  due: PaymentDueResponse;
  onBoletoClick: (due: PaymentDueResponse) => void;
  showBoletoAction: boolean;
}

function DueRow({ due, onBoletoClick, showBoletoAction }: DueRowProps): React.JSX.Element {
  const rawMeta = DUE_STATUS_META[due.status] ?? {
    label: due.status,
    variant: 'neutral' as BadgeVariant,
  };
  // `as` justificado: DUE_STATUS_META usa BadgeVariant local de billing/schemas que
  // tem os mesmos valores literais que BadgeVariant do componente Badge — são tipos estruturalmente
  // equivalentes mas nominalmente distintos.
  const statusMeta = { label: rawMeta.label, variant: rawMeta.variant as BadgeVariant };

  const isOverdue = due.status === 'overdue';

  return (
    <div
      className="group flex items-center gap-3 px-4 py-3 transition-colors"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {/* Número da parcela */}
      <span
        className="font-mono font-semibold text-ink-3 shrink-0"
        style={{ fontSize: 'var(--text-xs)', minWidth: 28 }}
      >
        #{due.installment_number}
      </span>

      {/* Data de vencimento */}
      <span
        className="font-mono text-ink-2 shrink-0"
        style={{
          fontSize: 'var(--text-xs)',
          color: isOverdue ? 'var(--danger)' : undefined,
          minWidth: 88,
        }}
      >
        {formatDateOnly(due.due_date)}
      </span>

      {/* Valor */}
      <span
        className="font-mono font-semibold text-ink flex-1"
        style={{ fontSize: 'var(--text-sm)' }}
      >
        {formatCurrency(due.amount)}
      </span>

      {/* Status badge */}
      <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>

      {/* Boleto — botão de ação (visível apenas com permissão billing:boleto:write + flag billing.boleto.enabled) */}
      {showBoletoAction && (
        <button
          type="button"
          onClick={() => onBoletoClick(due)}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xs font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
          style={{
            fontSize: 'var(--text-xs)',
            color: due.has_boleto ? 'var(--brand-azul)' : 'var(--text-3)',
            background: due.has_boleto ? 'var(--info-bg)' : 'var(--surface-muted)',
            border: due.has_boleto
              ? '1px solid color-mix(in srgb, var(--brand-azul) 30%, transparent)'
              : '1px solid var(--border)',
          }}
          aria-label={
            due.has_boleto
              ? `Ver boleto da parcela ${due.installment_number}`
              : `Anexar boleto da parcela ${due.installment_number}`
          }
        >
          {/* Ícone de documento */}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className="w-3.5 h-3.5 shrink-0"
            aria-hidden="true"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <rect x="3" y="2" width="10" height="12" rx="1.5" />
            <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" strokeLinecap="round" />
          </svg>
          {due.has_boleto ? 'Boleto' : 'Anexar'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContractDuesList
// ---------------------------------------------------------------------------

interface ContractDuesListProps {
  customerId: string;
  contractReference: string;
}

export function ContractDuesList({
  customerId,
  contractReference,
}: ContractDuesListProps): React.JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canBoleto = hasPermission('billing:boleto:write');
  const { enabled: boletoEnabled } = useFeatureFlag('billing.boleto.enabled');
  // Gate: botão de boleto visível somente com permissão + feature flag habilitados
  const showBoletoAction = canBoleto && boletoEnabled;

  const [selectedDue, setSelectedDue] = React.useState<PaymentDueResponse | null>(null);

  const { dues, isLoading, isError, refetch } = useContractDues(customerId, contractReference);

  return (
    <>
      {/* Container da lista */}
      <div
        className="rounded-sm overflow-hidden"
        style={{
          boxShadow: 'var(--elev-1)',
          border: '1px solid var(--border)',
          background: 'var(--bg-elev-1)',
        }}
      >
        {/* Header da tabela */}
        <div
          className="flex items-center gap-3 px-4 py-2.5"
          style={{
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-elev-2)',
          }}
        >
          <span
            className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em]"
            style={{ fontSize: '0.65rem', minWidth: 28 }}
          >
            #
          </span>
          <span
            className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] shrink-0"
            style={{ fontSize: '0.65rem', minWidth: 88 }}
          >
            Vencimento
          </span>
          <span
            className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] flex-1"
            style={{ fontSize: '0.65rem' }}
          >
            Valor
          </span>
          <span
            className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] shrink-0"
            style={{ fontSize: '0.65rem', minWidth: 60 }}
          >
            Status
          </span>
          {showBoletoAction && (
            <span
              className="font-sans font-semibold uppercase text-ink-3 tracking-[0.08em] shrink-0"
              style={{ fontSize: '0.65rem', minWidth: 72 }}
            >
              Boleto
            </span>
          )}
        </div>

        {/* Estados: loading */}
        {isLoading && <DuesListSkeleton />}

        {/* Estados: erro */}
        {!isLoading && isError && (
          <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
            <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
              Erro ao carregar parcelas.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs px-3 py-1.5"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--brand-azul)',
                border: '1px solid color-mix(in srgb, var(--brand-azul) 30%, transparent)',
                background: 'var(--info-bg)',
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Estados: vazio */}
        {!isLoading && !isError && dues !== null && dues.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center px-4">
            <svg
              viewBox="0 0 40 40"
              fill="none"
              className="w-10 h-10 opacity-30"
              aria-hidden="true"
            >
              <rect
                x="6"
                y="8"
                width="28"
                height="24"
                rx="2.5"
                stroke="var(--border-strong)"
                strokeWidth="1.5"
              />
              <path
                d="M12 16h16M12 20h10M12 24h6"
                stroke="var(--border-strong)"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <p className="font-sans font-semibold text-ink" style={{ fontSize: 'var(--text-sm)' }}>
              Nenhuma parcela encontrada
            </p>
            <p className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
              Não há parcelas registradas para {contractReference}.
            </p>
          </div>
        )}

        {/* Lista de parcelas */}
        {!isLoading && !isError && dues !== null && dues.length > 0 && (
          <div>
            {dues
              .sort((a, b) => a.installment_number - b.installment_number)
              .map((due) => (
                <DueRow
                  key={due.id}
                  due={due}
                  onBoletoClick={(d: PaymentDueResponse) => setSelectedDue(d)}
                  showBoletoAction={showBoletoAction}
                />
              ))}
          </div>
        )}
      </div>

      {/* Modal de boleto (reutiliza BoletoModal de billing — nunca duplicado).
          Gate duplo: showBoletoAction garante que o modal só monta se a permissão
          e a feature flag estiverem ativas. */}
      {showBoletoAction && selectedDue && (
        <BoletoModal due={selectedDue} onClose={() => setSelectedDue(null)} />
      )}
    </>
  );
}
