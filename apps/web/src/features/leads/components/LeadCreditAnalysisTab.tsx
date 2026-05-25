// =============================================================================
// features/leads/components/LeadCreditAnalysisTab.tsx
//
// Tab "Análise" dentro da ficha do lead (/crm/:id).
// Mostra análise vigente + histórico paginado + CTA para criar nova.
//
// DS:
//   - Cards Spotlight (halo verde, DS §8)
//   - Badge de status via CreditAnalysisStatusBadge
//   - JetBrains Mono em valores monetários
//   - Loading skeleton, empty state com CTA, error state
//
// Integração: usa useLeadCreditAnalyses (hook) + CreditAnalysisModal.
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { useAuthStore } from '../../../lib/auth-store';
import { cn } from '../../../lib/cn';
import { CreditAnalysisModal } from '../../credit-analyses/components/CreditAnalysisForm';
import { CreditAnalysisStatusBadge } from '../../credit-analyses/components/CreditAnalysisStatusBadge';
import { useLeadCreditAnalyses } from '../../credit-analyses/hooks/useCreditAnalyses';
import type { CreditAnalysisResponse } from '../../credit-analyses/schemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: string | null): string {
  if (!value) return '—';
  return parseFloat(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Spotlight Card ───────────────────────────────────────────────────────────

function SpotlightCard({
  children,
  className,
}: {
  children: React.ReactNode;
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
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-surface-1',
        'transition-[transform,box-shadow] duration-[250ms] ease-out',
        'hover:-translate-y-0.5',
        '[--mx:-9999px] [--my:-9999px]',
        className,
      )}
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md"
        style={{
          background:
            'radial-gradient(300px circle at var(--mx) var(--my), rgba(46,155,62,0.06), transparent 60%)',
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function AnalysisCardSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-4 animate-pulse"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="h-4 w-32 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-5 w-20 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
      </div>
      <div className="h-3 w-full rounded-xs mb-2" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-3 w-4/5 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
    </div>
  );
}

// ─── Card de análise ──────────────────────────────────────────────────────────

function AnalysisCard({ analysis }: { analysis: CreditAnalysisResponse }): React.JSX.Element {
  return (
    <SpotlightCard>
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div>
            <Link
              to={`/credit-analyses/${analysis.id}`}
              className="font-mono text-sm text-azul hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
            >
              {analysis.id.slice(0, 8)}… ↗
            </Link>
            <p className="font-sans text-xs text-ink-4 mt-0.5">
              {formatDate(analysis.created_at)}
              {analysis.origin === 'import' && ' · Importação'}
            </p>
          </div>
          <CreditAnalysisStatusBadge status={analysis.status} />
        </div>

        {/* Parecer (truncado) */}
        {analysis.current_version?.parecer_text && (
          <p
            className="font-sans text-xs text-ink-3 leading-relaxed line-clamp-2"
            title={analysis.current_version.parecer_text}
          >
            {analysis.current_version.parecer_text}
          </p>
        )}

        {/* Valor aprovado */}
        {analysis.approved_amount && (
          <div className="mt-3 pt-3 border-t border-border-subtle">
            <p className="font-sans text-xs text-ink-4 mb-0.5">Valor aprovado</p>
            <p
              className="font-mono font-semibold text-verde"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9375rem',
                color: 'var(--brand-verde)',
              }}
            >
              {formatBRL(analysis.approved_amount)}
            </p>
          </div>
        )}
      </div>
    </SpotlightCard>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface LeadCreditAnalysisTabProps {
  leadId: string;
}

/**
 * Tab "Análise" na ficha do lead.
 * Mostra histórico de análises do lead com CTA para criar nova.
 */
export function LeadCreditAnalysisTab({ leadId }: LeadCreditAnalysisTabProps): React.JSX.Element {
  const { toast } = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission('credit_analyses:write');

  const [modalOpen, setModalOpen] = React.useState(false);

  const { data, isLoading, isError } = useLeadCreditAnalyses(leadId, { limit: 10 });
  const analyses = data?.data ?? [];

  if (isError) {
    return (
      <div
        className="rounded-md border border-border bg-surface-1 p-6 text-center"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        <p className="font-sans text-sm text-danger">Erro ao carregar análises.</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        {/* Header da seção */}
        <div className="flex items-center justify-between">
          <h3
            className="font-sans font-bold text-ink-3 uppercase"
            style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
          >
            Análises de crédito
          </h3>

          {canWrite && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(true)}
              leftIcon={
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  className="w-3.5 h-3.5"
                  aria-hidden="true"
                >
                  <path d="M8 2v12M2 8h12" />
                </svg>
              }
            >
              Nova análise
            </Button>
          )}
        </div>

        {/* Conteúdo */}
        {isLoading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <AnalysisCardSkeleton key={i} />
            ))}
          </div>
        ) : analyses.length === 0 ? (
          <div
            className="rounded-md border border-border bg-surface-1 p-6 text-center"
            style={{ boxShadow: 'var(--elev-2)' }}
          >
            <p className="font-sans text-sm text-ink-3 mb-3">
              Nenhuma análise de crédito para este lead.
            </p>
            {canWrite && (
              <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
                Criar análise
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {analyses.map((analysis) => (
              <AnalysisCard key={analysis.id} analysis={analysis} />
            ))}

            {/* Link para lista completa */}
            {(data?.pagination.totalPages ?? 1) > 1 && (
              <Link
                to={`/credit-analyses?lead_id=${leadId}`}
                className="font-sans text-xs text-azul hover:underline text-center py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
              >
                Ver todas as análises →
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Modal de criação */}
      <CreditAnalysisModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultLeadId={leadId}
        onSuccess={() => {
          toast('Análise criada!', 'success');
          setModalOpen(false);
        }}
        onError={(msg) => toast(msg, 'danger')}
      />
    </>
  );
}
