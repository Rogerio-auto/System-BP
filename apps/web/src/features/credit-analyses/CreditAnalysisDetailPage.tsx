// =============================================================================
// features/credit-analyses/CreditAnalysisDetailPage.tsx — /credit-analyses/:id
//
// Detalhe de análise de crédito com timeline de versões + ações.
//
// DS:
//   - Header: badge de status + metadados
//   - Layout 2 colunas: detalhe (esq) + timeline imutável (dir)
//   - Botões de ação condicionados a permissões RBAC
//   - Loading skeletons nas duas colunas
//   - Error state com voltar
//   - Valores monetários em JetBrains Mono
//
// Permissões:
//   - "Nova versão": credit_analyses:write
//   - "Decidir": credit_analyses:decide + status em DECIDABLE_STATUSES
//   - "Pedir revisão": credit_analyses:request_review
//
// LGPD: lead_id é UUID opaco. Nenhum PII exibido.
// =============================================================================

import * as React from 'react';
import { Link, useParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { useAuthStore } from '../../lib/auth-store';
import { LinkedContractBadge } from '../contracts/LinkedContractBadge';

import { AddVersionModal, DecideModal, RequestReviewModal } from './components/CreditAnalysisForm';
import { CreditAnalysisStatusBadge } from './components/CreditAnalysisStatusBadge';
import { CreditAnalysisVersionTimeline } from './components/CreditAnalysisVersionTimeline';
import { useAnalysisVersions, useCreditAnalysis } from './hooks/useCreditAnalyses';
import { DECIDABLE_STATUSES } from './schemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBRL(value: string | null): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  } as Intl.DateTimeFormatOptions);
}

function formatRate(rate: string | null): string {
  if (!rate) return '—';
  const num = parseFloat(rate);
  return `${(num * 100).toFixed(2)}% a.m.`;
}

// ─── Skeletons ────────────────────────────────────────────────────────────────

function DetailSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5 animate-pulse">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="h-6 w-64 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-5 w-20 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
      </div>
      {/* Card */}
      <div
        className="rounded-md border border-border bg-surface-1 p-5"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="mb-4">
            <div
              className="h-3 w-20 rounded-xs mb-1.5"
              style={{ background: 'var(--surface-muted)' }}
            />
            <div
              className="h-4 rounded-xs"
              style={{ width: 80 + i * 30, background: 'var(--surface-muted)' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Card de metadados ────────────────────────────────────────────────────────

function MetaRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <p
        className="font-sans font-semibold text-ink-3 uppercase mb-1"
        style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
      >
        {label}
      </p>
      {mono ? (
        <p
          className="font-mono text-ink-2"
          style={{ fontFamily: 'var(--font-mono)', fontSize: '0.875rem', letterSpacing: '-0.01em' }}
        >
          {value}
        </p>
      ) : (
        <p className="font-sans text-sm text-ink-2">{value}</p>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * CreditAnalysisDetailPage — /credit-analyses/:id
 */
export function CreditAnalysisDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const analysisId = id ?? '';

  const { data: analysis, isLoading, isError, refetch } = useCreditAnalysis(analysisId);
  const { data: versionsData, isLoading: versionsLoading } = useAnalysisVersions(analysisId);
  const { toast } = useToast();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [addVersionOpen, setAddVersionOpen] = React.useState(false);
  const [decideOpen, setDecideOpen] = React.useState(false);
  const [reviewOpen, setReviewOpen] = React.useState(false);

  // Permissões derivadas
  const canWrite = hasPermission('credit_analyses:write');
  const canDecide = hasPermission('credit_analyses:decide');
  const canReview = hasPermission('credit_analyses:request_review');

  const isDecidable =
    canDecide &&
    analysis !== null &&
    analysis !== undefined &&
    DECIDABLE_STATUSES.includes(analysis.status);

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="font-sans text-sm text-danger">Erro ao carregar análise de crédito.</p>
        <div className="flex gap-3">
          <Link to="/credit-analyses">
            <Button variant="outline">← Voltar para lista</Button>
          </Link>
          <Button variant="ghost" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  // Histórico completo de versões via endpoint dedicado.
  // Fallback para current_version enquanto o fetch de versões não completa.
  const versions = React.useMemo(() => {
    if (versionsData && versionsData.length > 0) return versionsData;
    if (analysis?.current_version) return [analysis.current_version];
    return [];
  }, [versionsData, analysis]);

  return (
    <>
      <div
        className="flex flex-col gap-6"
        style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) both' }}
      >
        {/* Breadcrumb */}
        <div className="flex items-center gap-2">
          <Link
            to="/credit-analyses"
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
            Análises de crédito
          </Link>
          <span className="text-ink-4 text-sm">/</span>
          <span className="font-mono text-sm text-ink" style={{ fontFamily: 'var(--font-mono)' }}>
            {isLoading ? '...' : `${analysisId.slice(0, 8)}…`}
          </span>
        </div>

        {/* Header + ações */}
        {isLoading ? (
          <div
            className="h-10 w-48 rounded-xs animate-pulse"
            style={{ background: 'var(--surface-muted)' }}
          />
        ) : analysis ? (
          <div
            className="flex flex-wrap items-start justify-between gap-4"
            style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.05s both' }}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <h1
                className="font-display font-bold text-ink"
                style={{
                  fontSize: 'var(--text-2xl)',
                  letterSpacing: '-0.035em',
                  fontVariationSettings: "'opsz' 32",
                }}
              >
                Análise de crédito
              </h1>
              <CreditAnalysisStatusBadge status={analysis.status} />
            </div>

            {/* Botões de ação — condicionados a permissão */}
            <div className="flex flex-wrap gap-2">
              {canWrite && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAddVersionOpen(true)}
                  leftIcon={
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      className="w-4 h-4"
                      aria-hidden="true"
                    >
                      <path d="M8 2v12M2 8h12" />
                    </svg>
                  }
                >
                  Nova versão
                </Button>
              )}

              {isDecidable && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setDecideOpen(true)}
                  leftIcon={
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      className="w-4 h-4"
                      aria-hidden="true"
                    >
                      <path d="M3 8l3.5 3.5 6.5-7" />
                    </svg>
                  }
                >
                  Decidir
                </Button>
              )}

              {canReview && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setReviewOpen(true)}
                  leftIcon={
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      className="w-4 h-4"
                      aria-hidden="true"
                    >
                      <path d="M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2Z" />
                      <path d="M8 7v3M8 5.5v.5" />
                    </svg>
                  }
                >
                  Pedir revisão
                </Button>
              )}
            </div>
          </div>
        ) : null}

        {/* Layout 2 colunas */}
        <div
          className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-5"
          style={{ animation: 'fade-up var(--dur-slow) var(--ease-out) 0.1s both' }}
        >
          {/* Coluna esquerda: metadados */}
          {isLoading ? (
            <DetailSkeleton />
          ) : analysis ? (
            <div className="flex flex-col gap-5">
              {/* Card de metadados */}
              <div
                className="rounded-md border border-border bg-surface-1 p-5"
                style={{ boxShadow: 'var(--elev-2)' }}
              >
                <h2
                  className="font-sans font-bold text-ink-3 uppercase mb-4"
                  style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
                >
                  Dados da análise
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <MetaRow
                    label="ID da análise"
                    value={
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                        {analysis.id}
                      </span>
                    }
                  />
                  <MetaRow
                    label="Cliente"
                    value={
                      <Link
                        to={`/crm/${analysis.lead_id}`}
                        className="font-sans text-sm text-azul hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
                        title="Ver ficha do lead"
                      >
                        {analysis.lead_name ?? 'Ver ficha'} ↗
                      </Link>
                    }
                  />
                  <MetaRow
                    label="Origem"
                    value={analysis.origin === 'manual' ? 'Manual' : 'Importação'}
                  />
                  <MetaRow label="Criado em" value={formatDate(analysis.created_at)} />
                  <MetaRow label="Atualizado em" value={formatDate(analysis.updated_at)} />
                </div>

                {/* Campos de aprovação — exibidos quando aprovado */}
                {analysis.status === 'aprovado' && (
                  <>
                    <div className="mt-4 pt-4 border-t border-border-subtle grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <MetaRow
                        label="Valor aprovado"
                        value={formatBRL(analysis.approved_amount)}
                        mono
                      />
                      <MetaRow
                        label="Prazo"
                        value={
                          analysis.approved_term_months
                            ? `${analysis.approved_term_months} meses`
                            : '—'
                        }
                      />
                      <MetaRow
                        label="Taxa mensal"
                        value={formatRate(analysis.approved_rate_monthly)}
                        mono
                      />
                    </div>

                    {/* Contrato vinculado — gerado automaticamente pela aprovação (F17-S14) */}
                    <div className="mt-3 pt-3 border-t border-border-subtle flex items-center gap-3">
                      <p
                        className="font-sans font-semibold text-ink-3 uppercase shrink-0"
                        style={{ fontSize: '0.65rem', letterSpacing: '0.1em' }}
                      >
                        Contrato vinculado
                      </p>
                      <LinkedContractBadge analysisId={analysis.id} />
                    </div>
                  </>
                )}
              </div>

              {/* Card versão atual */}
              {analysis.current_version && (
                <div
                  className="rounded-md border border-border bg-surface-1 p-5"
                  style={{ boxShadow: 'var(--elev-2)' }}
                >
                  <h2
                    className="font-sans font-bold text-ink-3 uppercase mb-4"
                    style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
                  >
                    Parecer atual — v{analysis.current_version.version}
                  </h2>
                  <div
                    className="rounded-sm border border-border-subtle p-3"
                    style={{ background: 'var(--bg-elev-2)' }}
                  >
                    <pre
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.8125rem',
                        lineHeight: 1.65,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: 'var(--text-2)',
                        margin: 0,
                      }}
                    >
                      {analysis.current_version.parecer_text}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Coluna direita: timeline de versões */}
          <div className="flex flex-col gap-3">
            <h2
              className="font-sans font-bold text-ink-3 uppercase"
              style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
            >
              Histórico de versões
            </h2>

            <CreditAnalysisVersionTimeline
              versions={versions}
              isLoading={isLoading || versionsLoading}
            />
          </div>
        </div>
      </div>

      {/* Modais de ação */}
      {analysis && (
        <>
          <AddVersionModal
            open={addVersionOpen}
            onClose={() => setAddVersionOpen(false)}
            analysisId={analysisId}
            currentStatus={analysis.status}
            onSuccess={() => toast('Nova versão adicionada!', 'success')}
            onError={(msg) => toast(msg, 'danger')}
          />

          <DecideModal
            open={decideOpen}
            onClose={() => setDecideOpen(false)}
            analysisId={analysisId}
            simulationId={analysis.simulation_id}
            leadId={analysis.lead_id}
            onSuccess={(updated) => {
              const label =
                updated.status === 'aprovado' ? 'Análise aprovada!' : 'Análise recusada.';
              toast(label, updated.status === 'aprovado' ? 'success' : 'info');
            }}
            onError={(msg) => toast(msg, 'danger')}
          />

          <RequestReviewModal
            open={reviewOpen}
            onClose={() => setReviewOpen(false)}
            analysisId={analysisId}
            onSuccess={() => toast('Revisão solicitada!', 'info')}
            onError={(msg) => toast(msg, 'danger')}
          />
        </>
      )}
    </>
  );
}
