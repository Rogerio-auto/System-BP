// =============================================================================
// features/crm/components/SimulationDetailModal.tsx
//
// Modal de detalhe de uma simulação de crédito.
//
// DS:
//   - Modal com elev-5 (DS §9 — modal/popover obrigatório elev-5)
//   - AmortizationTable compartilhada (DS §9.7)
//   - Backdrop semi-transparente, fecha ao clicar fora ou pressionar Esc
//   - JetBrains Mono nos valores financeiros
//   - Funciona em light + dark
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { AmortizationTable } from '../../../components/credit/AmortizationTable';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import type { LeadSimulation } from '../../../hooks/crm/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(decimal: number): string {
  return `${(decimal * 100).toFixed(2)}% a.m.`;
}

const METHOD_LABEL: Record<string, string> = {
  price: 'Price (parcela fixa)',
  sac: 'SAC (amortização constante)',
};

const ORIGIN_BADGE: Record<
  LeadSimulation['origin'],
  { label: string; variant: 'info' | 'success' | 'neutral' }
> = {
  ai: { label: 'IA', variant: 'info' },
  manual: { label: 'Manual', variant: 'neutral' },
  import: { label: 'Import', variant: 'success' },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface SimulationDetailModalProps {
  simulation: LeadSimulation;
  leadId: string;
  onClose: () => void;
}

// ─── Modal ────────────────────────────────────────────────────────────────────

/**
 * Modal de detalhe de simulação (DS §9, elev-5).
 * Mostra stats de resumo + tabela de amortização completa.
 */
export function SimulationDetailModal({
  simulation,
  leadId,
  onClose,
}: SimulationDetailModalProps): React.JSX.Element {
  const originMeta = ORIGIN_BADGE[simulation.origin];

  // Fechar ao pressionar Esc
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Bloquear scroll do body enquanto modal está aberto
  React.useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sim-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div
        className="relative w-full max-w-2xl rounded-lg overflow-hidden flex flex-col"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          maxHeight: '90vh',
          animation: 'fade-up var(--dur-slow) var(--ease-out) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2
                id="sim-modal-title"
                className="font-display font-bold text-ink"
                style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.028em' }}
              >
                {simulation.productName}
              </h2>
              {originMeta && <Badge variant={originMeta.variant}>{originMeta.label}</Badge>}
            </div>
            <p
              className="font-sans text-xs"
              style={{ color: 'var(--text-3)', letterSpacing: '0.02em' }}
            >
              v{simulation.ruleVersion} ·{' '}
              {METHOD_LABEL[simulation.amortizationMethod] ?? simulation.amortizationMethod}
            </p>
          </div>

          {/* Fechar */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar detalhe da simulação"
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-xs transition-all duration-fast"
            style={{ color: 'var(--text-3)' }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-1)';
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* ── Resumo de valor ─────────────────────────────────────────────── */}
        <div className="px-5 py-4 shrink-0">
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-2xl)',
              fontWeight: 700,
              letterSpacing: '-0.04em',
              color: 'var(--brand-azul)',
            }}
          >
            {formatBRL(simulation.amount)}{' '}
            <span
              style={{
                fontSize: 'var(--text-base)',
                fontWeight: 400,
                color: 'var(--text-2)',
              }}
            >
              em {simulation.termMonths}x de{' '}
              <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>
                {formatBRL(simulation.monthlyPayment)}
              </span>
            </span>
          </p>
          <p className="font-sans text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            Taxa {formatPercent(simulation.rateMonthlySnapshot)} · Total{' '}
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
              {formatBRL(simulation.totalAmount)}
            </span>{' '}
            · Juros{' '}
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-2)' }}>
              {formatBRL(simulation.totalInterest)}
            </span>
          </p>
        </div>

        {/* ── Tabela de amortização ────────────────────────────────────────── */}
        {simulation.amortizationTable && simulation.amortizationTable.installments.length > 0 ? (
          <div className="px-5 pb-4 overflow-y-auto flex-1" style={{ minHeight: 0 }}>
            <AmortizationTable data={simulation.amortizationTable} />
          </div>
        ) : (
          <div className="px-5 pb-4 flex-1 flex items-center justify-center py-8">
            <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
              Tabela de amortização não disponível.
            </p>
          </div>
        )}

        {/* ── Rodapé com ações ─────────────────────────────────────────────── */}
        <div
          className="flex gap-2 px-5 py-4 shrink-0"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <Button type="button" variant="ghost" onClick={onClose} className="flex-1">
            Fechar
          </Button>
          <Link to={`/simulator?leadId=${leadId}`} className="flex-1">
            <Button
              type="button"
              variant="primary"
              className="w-full"
              leftIcon={
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  className="w-4 h-4"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
              }
            >
              Nova simulação
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
