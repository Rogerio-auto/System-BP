// =============================================================================
// features/simulator/SimulatorResult.tsx — Resultado da simulação (F2-S06).
//
// Estados:
//   empty    → ilustração + call-to-action
//   loading  → skeleton da área de stats + tabela
//   error    → banner colorido por código (422/409/503/403)
//   success  → Stats row (Bricolage) + Card elev-3 com AmortizationTable
//
// DS §9.8 Stat, §9.3 Card, §9.6 Alert.
// Parcela mensal em Bricolage 800 text-3xl com --brand-azul (primary da bandeira).
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { Stat } from '../../components/ui/Stat';
import type { SimulationResult } from '../../hooks/simulator/types';
import { formatBRL, formatRate } from '../../hooks/simulator/types';
import type { SimulationError } from '../../hooks/simulator/useSimulate';
import { cn } from '../../lib/cn';

import { AmortizationTable } from './AmortizationTable';

// ─── Props ────────────────────────────────────────────────────────────────────

interface SimulatorResultProps {
  isPending: boolean;
  result: SimulationResult | undefined | null;
  simulationError: SimulationError | null;
  leadId: string | null;
  onReset: () => void;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function ResultSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-4 animate-pulse"
      aria-busy="true"
      aria-label="Calculando simulação…"
    >
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="rounded-md border border-border bg-surface-1 p-5 h-24"
            style={{ boxShadow: 'var(--elev-1)' }}
          >
            <div className="h-2 w-16 rounded bg-surface-2 mb-3" />
            <div className="h-7 w-24 rounded bg-surface-2" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div
        className="rounded-md border border-border bg-surface-1 h-64"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-4 rounded bg-surface-2 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Estado vazio ─────────────────────────────────────────────────────────────

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-16 text-center">
      {/* Ilustração minimalista — calculadora com estrela */}
      <div
        className="w-16 h-16 rounded-xl flex items-center justify-center"
        style={{ background: 'var(--bg-elev-2)', boxShadow: 'var(--elev-2)' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
          <rect
            x="6"
            y="4"
            width="20"
            height="24"
            rx="3"
            stroke="var(--brand-azul)"
            strokeWidth="1.5"
          />
          <rect
            x="10"
            y="8"
            width="12"
            height="5"
            rx="1.5"
            fill="var(--brand-azul)"
            opacity="0.15"
            stroke="var(--brand-azul)"
            strokeWidth="1.2"
          />
          <circle cx="11" cy="18" r="1.5" fill="var(--brand-verde)" />
          <circle cx="16" cy="18" r="1.5" fill="var(--brand-verde)" />
          <circle cx="21" cy="18" r="1.5" fill="var(--brand-verde)" />
          <circle cx="11" cy="23" r="1.5" fill="var(--text-4)" />
          <circle cx="16" cy="23" r="1.5" fill="var(--text-4)" />
          <circle cx="21" cy="23" r="1.5" fill="var(--brand-amarelo)" />
        </svg>
      </div>

      <div className="flex flex-col gap-2 max-w-xs">
        <h3
          className="font-display font-bold text-ink"
          style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.025em' }}
        >
          Pronto para simular
        </h3>
        <p className="font-sans text-sm text-ink-3 leading-relaxed">
          Preencha o formulário ao lado com o lead, produto, valor e prazo, então clique em{' '}
          <strong className="font-semibold text-ink-2">Simular</strong>.
        </p>
      </div>
    </div>
  );
}

// ─── Banner de erro ───────────────────────────────────────────────────────────

function ErrorBanner({ error }: { error: SimulationError }): React.JSX.Element {
  if (error.code === 'FLAG_DISABLED' || error.code === 'FORBIDDEN') {
    return (
      <div
        role="alert"
        className="rounded-sm border-l-[3px] p-4"
        style={{
          borderColor: 'var(--danger)',
          background: 'var(--danger-bg)',
        }}
      >
        <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
          Módulo de simulação desativado
        </p>
        <p className="font-sans text-xs text-ink-2 mt-1">{error.message}</p>
      </div>
    );
  }

  if (error.code === 'NO_RULE_FOR_CITY') {
    return (
      <div
        role="alert"
        className="rounded-sm border-l-[3px] p-4"
        style={{
          borderColor: 'var(--warning)',
          background: 'var(--warning-bg)',
        }}
      >
        <p className="font-sans font-semibold text-sm" style={{ color: 'var(--warning)' }}>
          Sem regra de crédito para esta cidade
        </p>
        <p className="font-sans text-xs text-ink-2 mt-1">
          O produto selecionado não tem regra ativa para a cidade deste lead.{' '}
          <Link
            to="/admin/credit-products"
            className="underline font-medium hover:text-ink"
            style={{ color: 'var(--warning)' }}
          >
            Gerir produtos de crédito
          </Link>
        </p>
      </div>
    );
  }

  if (error.code === 'VALIDATION_ERROR') {
    return (
      <div
        role="alert"
        className="rounded-sm border-l-[3px] p-4"
        style={{
          borderColor: 'var(--danger)',
          background: 'var(--danger-bg)',
        }}
      >
        <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
          Parâmetros fora dos limites
        </p>
        <p className="font-sans text-xs text-ink-2 mt-1">{error.message}</p>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="rounded-sm border-l-[3px] p-4"
      style={{
        borderColor: 'var(--danger)',
        background: 'var(--danger-bg)',
      }}
    >
      <p className="font-sans font-semibold text-sm" style={{ color: 'var(--danger)' }}>
        Erro ao calcular simulação
      </p>
      <p className="font-sans text-xs text-ink-2 mt-1">{error.message}</p>
    </div>
  );
}

// ─── Resultado principal ──────────────────────────────────────────────────────

function ResultSuccess({
  result,
  leadId,
  onReset,
}: {
  result: SimulationResult;
  leadId: string | null;
  onReset: () => void;
}): React.JSX.Element {
  // Stat de destaque: parcela mensal
  // DS: Bricolage + --brand-azul, valor mais largo
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--mx', '-9999px');
    el.style.setProperty('--my', '-9999px');
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Parcela mensal — stat de destaque */}
        <div
          ref={cardRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={cn(
            'relative overflow-hidden col-span-2 sm:col-span-1',
            'rounded-md border p-5',
            'transition-[transform,box-shadow] duration-[250ms] ease-out',
            'hover:-translate-y-0.5',
            '[--mx:-9999px] [--my:-9999px]',
          )}
          style={{
            background: 'var(--grad-azul)',
            borderColor: 'var(--brand-azul)',
            boxShadow: 'var(--elev-3), var(--glow-azul)',
          }}
        >
          {/* Spotlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-md"
            style={{
              background:
                'radial-gradient(300px circle at var(--mx) var(--my), rgba(255,255,255,0.08), transparent 60%)',
            }}
          />
          <div className="relative z-10 flex flex-col gap-2">
            <p
              className="font-sans font-semibold uppercase"
              style={{
                fontSize: '0.7rem',
                letterSpacing: '0.12em',
                color: 'rgba(255,255,255,0.6)',
              }}
            >
              Parcela mensal
            </p>
            <span
              className="font-display font-extrabold leading-none"
              style={{
                fontSize: 'var(--text-3xl)',
                letterSpacing: '-0.04em',
                fontVariationSettings: "'opsz' 48",
                color: 'white',
                textShadow: '0 2px 12px rgba(0,0,0,0.2)',
              }}
            >
              {formatBRL(result.installment_amount)}
            </span>
            <p className="font-sans text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
              por {result.term_months} meses
            </p>
          </div>
        </div>

        {/* Total a pagar */}
        <Stat
          label="Total a pagar"
          value={formatBRL(result.total_amount)}
          description={`${result.term_months} parcelas`}
        />

        {/* Total de juros */}
        <Stat
          label="Total de juros"
          value={formatBRL(result.total_interest)}
          trend={{
            value: `${((result.total_interest / result.requested_amount) * 100).toFixed(1)}%`,
            direction: 'neutral',
          }}
        />

        {/* Taxa aplicada */}
        <Stat
          label="Taxa aplicada"
          value={formatRate(result.interest_rate_monthly)}
          description="ao mês"
        />
      </div>

      {/* Tabela de amortização */}
      <div>
        <h3
          className="font-display font-bold text-ink mb-3"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Tabela de amortização (Price)
        </h3>
        <AmortizationTable rows={result.amortization_table} />
      </div>

      {/* Ações */}
      <div className="flex flex-wrap gap-3 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          leftIcon={
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-4 h-4"
            >
              <path d="M2 8a6 6 0 1 1 1.2 3.6" />
              <path d="M2 12V8h4" />
            </svg>
          }
        >
          Nova simulação
        </Button>

        {leadId && (
          <Button
            variant="outline"
            size="sm"
            leftIcon={
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4"
              >
                <path d="M13 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                <path d="M7 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
                <path d="M1 15c0-2.8 2.69-5 6-5h6c3.31 0 6 2.2 6 5" />
              </svg>
            }
          >
            <Link to={`/crm/${leadId}`} className="no-underline text-inherit">
              Ver no CRM
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * Painel de resultado da simulação.
 * Gerencia os 4 estados: empty, loading, error, success.
 */
export function SimulatorResult({
  isPending,
  result,
  simulationError,
  leadId,
  onReset,
}: SimulatorResultProps): React.JSX.Element {
  if (isPending) {
    return <ResultSkeleton />;
  }

  if (simulationError && !result) {
    return <ErrorBanner error={simulationError} />;
  }

  if (result) {
    return <ResultSuccess result={result} leadId={leadId} onReset={onReset} />;
  }

  return <EmptyState />;
}
