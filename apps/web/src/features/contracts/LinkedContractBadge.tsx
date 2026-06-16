// =============================================================================
// features/contracts/LinkedContractBadge.tsx — Badge de contrato vinculado (F17-S14).
//
// Exibe uma pill clicável com o status e referência do contrato draft criado
// automaticamente quando uma análise de crédito é aprovada (F17-S13).
//
// Comportamento:
//   - Loading: skeleton pill animado
//   - Contrato encontrado: pill [status • referência →] que abre o ContractDetail drawer
//   - Sem contrato: null (não renderiza nada — ex: análise recém-aprovada aguarda propagação)
//
// DS:
//   - Tokens de cor por status do contrato (var(--success), var(--info), var(--neutral))
//   - Elevação var(--elev-1) na pill
//   - Tipografia font-mono para a referência (JetBrains Mono)
//   - Hover: border + background shift com transição 150ms (padrão DS)
//   - Focus ring: ring-2 ring-azul/15 (acessibilidade WCAG AA)
//   - Sem hex hardcoded
//
// LGPD: exibe apenas contract_reference e status — sem PII do cliente.
// =============================================================================

import * as React from 'react';

import { ContractDetail } from './ContractDetail';
import { useContractByAnalysis } from './hooks';
import { CONTRACT_STATUS_META } from './schemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ícone de documento (outline, 14×14) — representa o contrato. */
function DocumentIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5 shrink-0"
      aria-hidden="true"
    >
      <rect x="2" y="1" width="10" height="12" rx="1.5" />
      <path d="M4.5 4.5h5M4.5 7h5M4.5 9.5h3" />
    </svg>
  );
}

/** Ícone de seta direita (chevron, 12×12) — indica navegação. */
function ChevronRightIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3 h-3 shrink-0 opacity-60"
      aria-hidden="true"
    >
      <path d="M4.5 2.5l3 3.5-3 3.5" />
    </svg>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LinkedContractSkeleton(): React.JSX.Element {
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill animate-pulse"
      style={{
        background: 'var(--surface-muted)',
        boxShadow: 'var(--elev-1)',
        height: 28,
        width: 180,
      }}
      aria-label="Carregando contrato vinculado"
    />
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface LinkedContractBadgeProps {
  analysisId: string;
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * LinkedContractBadge — exibe o contrato draft vinculado a uma análise aprovada.
 *
 * Fica no aguardo enquanto busca (skeleton), desaparece quando não há contrato,
 * e renderiza uma pill interativa quando encontra o contrato.
 *
 * Clicar abre o ContractDetail drawer inline — sem navegar para /contratos.
 */
export function LinkedContractBadge({
  analysisId,
}: LinkedContractBadgeProps): React.JSX.Element | null {
  const { contract, isLoading } = useContractByAnalysis(analysisId);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  if (isLoading) return <LinkedContractSkeleton />;
  if (!contract) return null;

  const statusMeta = CONTRACT_STATUS_META[contract.status] ?? {
    label: contract.status,
    variant: 'neutral' as const,
  };

  // Mapeamento de variant → CSS token para a pill (fundo + texto + dot).
  // Chave é BadgeVariant — todos os casos cobertos + fallback explícito.
  type PillColors = { bg: string; text: string; dot: string };
  const colorMap: Record<string, PillColors> = {
    success: {
      bg: 'var(--success-bg)',
      text: 'var(--success)',
      dot: 'var(--success)',
    },
    info: {
      bg: 'var(--info-bg)',
      text: 'var(--info)',
      dot: 'var(--info)',
    },
    warning: {
      bg: 'var(--warning-bg)',
      text: 'var(--warning)',
      dot: 'var(--warning)',
    },
    danger: {
      bg: 'var(--danger-bg)',
      text: 'var(--danger)',
      dot: 'var(--danger)',
    },
    neutral: {
      bg: 'var(--surface-muted)',
      text: 'var(--text-3)',
      dot: 'var(--text-3)',
    },
  };

  const fallbackColors: PillColors = {
    bg: 'var(--surface-muted)',
    text: 'var(--text-3)',
    dot: 'var(--text-3)',
  };

  const colors: PillColors = colorMap[statusMeta.variant] ?? fallbackColors;

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/15"
        style={{
          background: colors.bg,
          color: colors.text,
          boxShadow: 'var(--elev-1)',
          border: `1px solid color-mix(in srgb, ${colors.dot} 25%, transparent)`,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--elev-2)';
          (e.currentTarget as HTMLButtonElement).style.background =
            `color-mix(in srgb, ${colors.bg} 80%, ${colors.dot} 12%)`;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--elev-1)';
          (e.currentTarget as HTMLButtonElement).style.background = colors.bg;
        }}
        aria-label={`Abrir contrato vinculado ${contract.contract_reference}`}
      >
        {/* Ícone de documento */}
        <DocumentIcon />

        {/* Status dot */}
        <span
          aria-hidden="true"
          className="shrink-0 rounded-pill"
          style={{
            width: 5,
            height: 5,
            background: colors.dot,
            boxShadow: `0 0 4px ${colors.dot}`,
          }}
        />

        {/* Status label */}
        <span
          className="font-sans font-bold uppercase"
          style={{ fontSize: '0.65rem', letterSpacing: '0.07em' }}
        >
          {statusMeta.label}
        </span>

        {/* Separador */}
        <span aria-hidden="true" style={{ opacity: 0.35, fontSize: '0.75rem' }}>
          ·
        </span>

        {/* Referência do contrato em Mono */}
        <span
          className="font-mono font-semibold"
          style={{ fontSize: '0.75rem', letterSpacing: '-0.01em' }}
        >
          {contract.contract_reference}
        </span>

        {/* Chevron de navegação */}
        <ChevronRightIcon />
      </button>

      {/* Drawer de detalhe inline — sem navegar para /contratos */}
      {drawerOpen && (
        <ContractDetail contractId={contract.id} onClose={() => setDrawerOpen(false)} />
      )}
    </>
  );
}
