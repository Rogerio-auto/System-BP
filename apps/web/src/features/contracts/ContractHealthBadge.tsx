// =============================================================================
// features/contracts/ContractHealthBadge.tsx — Badge de saúde de boletos (F17-S06).
//
// Exibe o indicador sintético de saúde de pagamento derivado das payment_dues.
// Consome GET /api/contracts/:id/health via useContractHealth.
//
// Estados de health:
//   healthy   → verde   (--success)
//   at_risk   → amarelo (--warning)
//   defaulted → vermelho (--danger)
//   settled   → cinza   (--text-3)
//
// DS:
//   - Cores semânticas: --success, --warning, --danger, --text-3.
//   - Sem hex hardcoded — tokens DS obrigatórios.
//   - Progresso visual: barra proporcional ao percent_paid.
//   - Skeleton no loading (nunca spinner sozinho).
//   - Tipografia: Geist para labels, Mono para valores numéricos.
//
// LGPD: retorna apenas agregados financeiros operacionais — sem PII.
// =============================================================================

import * as React from 'react';

import { useContractHealth } from './hooks';
import { HEALTH_META } from './schemas';
import type { BoletoHealth } from './schemas';

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

/** Retorna o token de cor de foreground para cada estado de saúde. */
function healthColor(health: BoletoHealth['health']): string {
  switch (health) {
    case 'healthy':
      return 'var(--success)';
    case 'at_risk':
      return 'var(--warning)';
    case 'defaulted':
      return 'var(--danger)';
    case 'settled':
      return 'var(--text-3)';
  }
}

/** Retorna o token de cor de fundo (bg) para cada estado de saúde. */
function healthBgColor(health: BoletoHealth['health']): string {
  switch (health) {
    case 'healthy':
      return 'var(--success-bg)';
    case 'at_risk':
      return 'var(--warning-bg)';
    case 'defaulted':
      return 'var(--danger-bg)';
    case 'settled':
      return 'var(--surface-muted)';
  }
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function HealthSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-sm animate-pulse"
      aria-hidden="true"
      style={{
        height: 80,
        background: 'var(--surface-muted)',
        borderRadius: 'var(--radius-sm)',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// ContractHealthBadge
// ---------------------------------------------------------------------------

interface ContractHealthBadgeProps {
  contractId: string;
}

export function ContractHealthBadge({ contractId }: ContractHealthBadgeProps): React.JSX.Element {
  const { data: health, isLoading, isError, refetch } = useContractHealth(contractId);

  if (isLoading) {
    return <HealthSkeleton />;
  }

  if (isError || !health) {
    return (
      <div
        className="flex items-center justify-between px-4 py-3 rounded-sm"
        style={{
          background: 'var(--danger-bg)',
          border: '1px solid var(--danger)',
        }}
        role="alert"
      >
        <span className="font-sans text-danger" style={{ fontSize: 'var(--text-xs)' }}>
          Erro ao carregar saúde do contrato.
        </span>
        <button
          type="button"
          onClick={() => void refetch()}
          className="font-sans font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/20 rounded-xs"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const meta = HEALTH_META[health.health];
  const fg = healthColor(health.health);
  const bg = healthBgColor(health.health);
  const paidPercent = Math.min(100, Math.max(0, health.percent_paid));

  return (
    <div
      className="flex flex-col gap-3 rounded-sm px-4 py-3"
      style={{
        background: bg,
        border: `1px solid ${fg}`,
        borderLeft: `3px solid ${fg}`,
      }}
      aria-label={`Saúde do contrato: ${meta.label}`}
    >
      {/* Linha principal: status + contagens */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Indicador colorido */}
          <span
            className="inline-block shrink-0 rounded-full"
            style={{ width: 8, height: 8, background: fg }}
            aria-hidden="true"
          />
          <span
            className="font-sans font-semibold"
            style={{ fontSize: 'var(--text-sm)', color: fg }}
          >
            {meta.label}
          </span>
          <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
            — {meta.description}
          </span>
        </div>

        {/* Contagem compacta */}
        <span
          className="font-mono font-medium text-ink-2 shrink-0"
          style={{ fontSize: 'var(--text-xs)' }}
        >
          {health.paid_count}/{health.total_installments} pagas
        </span>
      </div>

      {/* Barra de progresso */}
      <div
        className="rounded-full overflow-hidden"
        style={{ height: 4, background: 'var(--surface-muted)' }}
        role="progressbar"
        aria-valuenow={paidPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${paidPercent.toFixed(0)}% pago`}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${paidPercent}%`, background: fg }}
        />
      </div>

      {/* Linha de valores */}
      <div className="flex items-center gap-4 flex-wrap">
        <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
          Pago:{' '}
          <span className="font-mono font-medium text-ink-2">
            {formatCurrency(health.paid_amount)}
          </span>
        </span>

        {parseFloat(health.overdue_amount) > 0 && (
          <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
            Em atraso:{' '}
            <span className="font-mono font-medium" style={{ color: 'var(--danger)' }}>
              {formatCurrency(health.overdue_amount)}
            </span>
          </span>
        )}

        {parseFloat(health.pending_amount) > 0 && (
          <span className="font-sans text-ink-3" style={{ fontSize: 'var(--text-xs)' }}>
            Pendente:{' '}
            <span className="font-mono font-medium text-ink-2">
              {formatCurrency(health.pending_amount)}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
