// =============================================================================
// features/crm/components/SimulationHistory.tsx
//
// Seção "Simulações" da ficha do lead (/crm/:id).
//
// DS:
//   - Cards compactos: Card elev-2, hover Spotlight (DS §9.3)
//   - JetBrains Mono nos valores financeiros
//   - Badge de origem (IA/Manual/Import) no canto direito
//   - Bricolage no header section
//   - Loading: skeleton de 2 cards
//   - Empty: caption discreto + CTA
//   - Erro: card retry
//   - Funciona em light + dark
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import type { LeadSimulation } from '../../../hooks/crm/types';
import { formatRelativeDate } from '../../../hooks/crm/types';
import { useLeadSimulations } from '../../../hooks/crm/useLeadSimulations';
import { cn } from '../../../lib/cn';

import { SimulationDetailModal } from './SimulationDetailModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

const ORIGIN_BADGE: Record<
  LeadSimulation['origin'],
  { label: string; variant: 'info' | 'success' | 'neutral' }
> = {
  ai: { label: 'IA', variant: 'info' },
  manual: { label: 'Manual', variant: 'neutral' },
  import: { label: 'Import', variant: 'success' },
};

const METHOD_SHORT: Record<string, string> = {
  price: 'Price',
  sac: 'SAC',
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SimulationCardSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-4 animate-pulse"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 flex flex-col gap-2">
          <div className="h-4 w-48 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
          <div className="h-3 w-64 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        </div>
        <div className="h-5 w-16 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
      </div>
    </div>
  );
}

// ─── Spotlight Card wrapper ───────────────────────────────────────────────────

function SpotlightCard({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}): React.JSX.Element {
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
    <div
      ref={cardRef}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? 'Ver detalhe da simulação' : undefined}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-surface-1',
        'transition-[transform,box-shadow] duration-[250ms] ease-out',
        onClick &&
          'cursor-pointer hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-azul/15',
        '[--mx:-9999px] [--my:-9999px]',
        className,
      )}
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      {/* Spotlight halo verde */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{
          background:
            'radial-gradient(350px circle at var(--mx) var(--my), rgba(46,155,62,0.07), transparent 60%)',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ─── Card de simulação ────────────────────────────────────────────────────────

function SimulationCard({
  simulation,
  onClick,
}: {
  simulation: LeadSimulation;
  onClick: () => void;
}): React.JSX.Element {
  const originMeta = ORIGIN_BADGE[simulation.origin];

  return (
    <SpotlightCard onClick={onClick} className="p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Conteúdo principal */}
        <div className="flex flex-col gap-1 min-w-0">
          {/* Linha 1: valor principal em Mono */}
          <p
            className="font-medium leading-tight"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.9rem',
              letterSpacing: '-0.02em',
              color: 'var(--text-1)',
            }}
          >
            {formatBRL(simulation.amount)} em {simulation.termMonths}x de{' '}
            <span style={{ color: 'var(--brand-azul)', fontWeight: 700 }}>
              {formatBRL(simulation.monthlyPayment)}
            </span>
          </p>

          {/* Linha 2: meta */}
          <p
            className="font-sans truncate"
            style={{ fontSize: '0.72rem', color: 'var(--text-3)', letterSpacing: '0.01em' }}
          >
            {simulation.productName}
            {' · '}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
              v{simulation.ruleVersion}
            </span>
            {' · '}
            {METHOD_SHORT[simulation.amortizationMethod] ?? simulation.amortizationMethod}
            {' · '}
            {formatRelativeDate(simulation.createdAt)}
          </p>
        </div>

        {/* Badge de origem */}
        {originMeta && (
          <div className="shrink-0">
            <Badge variant={originMeta.variant}>{originMeta.label}</Badge>
          </div>
        )}
      </div>
    </SpotlightCard>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SimulationHistoryProps {
  leadId: string;
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * Seção de histórico de simulações de crédito na ficha do lead.
 * Integra ao CrmDetailPage na coluna esquerda, abaixo dos dados de contato.
 */
export function SimulationHistory({ leadId }: SimulationHistoryProps): React.JSX.Element {
  const { simulations, isLoading, isError } = useLeadSimulations(leadId);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const selectedSimulation = selectedId
    ? (simulations.find((s) => s.id === selectedId) ?? null)
    : null;

  return (
    <>
      {/* ── Seção ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-base)',
                letterSpacing: '-0.025em',
                fontVariationSettings: "'opsz' 16",
              }}
            >
              Simulações
            </h2>
            {!isLoading && !isError && simulations.length > 0 && (
              <span
                className="font-sans font-semibold rounded-pill px-2 py-0.5"
                style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.06em',
                  color: 'var(--text-3)',
                  background: 'var(--surface-muted)',
                  boxShadow: 'var(--elev-1)',
                }}
              >
                {simulations.length}
              </span>
            )}
          </div>

          {/* Botão Nova Simulação */}
          <Link to={`/simulator?leadId=${leadId}`}>
            <Button
              variant="outline"
              size="sm"
              leftIcon={
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  className="w-3.5 h-3.5"
                >
                  <path d="M8 3v10M3 8h10" />
                </svg>
              }
            >
              Nova simulação
            </Button>
          </Link>
        </div>

        {/* Loading: skeleton de 2 cards */}
        {isLoading && (
          <div className="flex flex-col gap-2">
            <SimulationCardSkeleton />
            <SimulationCardSkeleton />
          </div>
        )}

        {/* Erro */}
        {isError && !isLoading && (
          <SpotlightCard className="p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="font-sans text-sm" style={{ color: 'var(--danger)' }}>
                Erro ao carregar simulações.
              </p>
              <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
                Tentar novamente
              </Button>
            </div>
          </SpotlightCard>
        )}

        {/* Empty state */}
        {!isLoading && !isError && simulations.length === 0 && (
          <SpotlightCard className="p-6">
            <div className="flex flex-col items-center gap-3 text-center">
              <div
                className="w-10 h-10 rounded-md flex items-center justify-center"
                style={{ background: 'var(--surface-muted)', color: 'var(--text-3)' }}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.4}
                  className="w-5 h-5"
                >
                  <path d="M10 3v14M3 10h14" strokeLinecap="round" />
                </svg>
              </div>
              <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
                Nenhuma simulação ainda.{' '}
                <Link
                  to={`/simulator?leadId=${leadId}`}
                  className="font-semibold transition-colors"
                  style={{ color: 'var(--brand-azul)' }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.opacity = '0.8';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLAnchorElement).style.opacity = '1';
                  }}
                >
                  Clique em Nova simulação para começar.
                </Link>
              </p>
            </div>
          </SpotlightCard>
        )}

        {/* Lista de cards */}
        {!isLoading && !isError && simulations.length > 0 && (
          <div className="flex flex-col gap-2">
            {simulations.map((simulation, idx) => (
              <div
                key={simulation.id}
                style={{ animationDelay: `${idx * 40}ms` } as React.CSSProperties}
              >
                <SimulationCard
                  simulation={simulation}
                  onClick={() => setSelectedId(simulation.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modal de detalhe ─────────────────────────────────────────────── */}
      {selectedSimulation && (
        <SimulationDetailModal
          simulation={selectedSimulation}
          leadId={leadId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
