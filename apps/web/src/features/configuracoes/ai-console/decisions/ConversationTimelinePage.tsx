// =============================================================================
// features/configuracoes/ai-console/decisions/ConversationTimelinePage.tsx
//
// Timeline cronológica de decisões de uma conversa específica.
// Rota: /configuracoes/ia/decisoes/conversa/:conversationId
//
// Cada card mostra:
//   - Header: node_name, timestamp, latência, model, tokens in/out
//   - Body: intent, prompt_version (link → F9-S05 quando disponível), output
//     (decision jsonb mascarado — só exibido se não-null), erro se houver
//   - Custo: cost_usd + cost_brl (null → "—")
//   - Link "Abrir no Chatwoot" quando chatwoot_conversation_id presente
//
// Banner LGPD discreto no topo (idêntico à lista).
// RBAC: ai_decisions:read → 404 sem permissão.
//
// DS: cards elev-2, hover Lift, profundidade física, tipografia editorial.
// LGPD: decision/context nunca logados; masking confiado ao backend.
// =============================================================================

import * as React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { useConversationTimeline } from '../../../../hooks/ai-console/useDecisions';
import { useAuth } from '../../../../lib/auth-store';
import { cn } from '../../../../lib/cn';

import { DecisionCard, formatDateTime } from './DecisionCard';

// ─── Banner LGPD (reutilizado da lista) ──────────────────────────────────────

function LgpdBanner(): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-2.5 px-4 py-2.5 rounded-md border"
      style={{
        background: 'var(--info-bg)',
        borderColor: 'var(--info)',
        borderWidth: '1px',
      }}
      role="note"
      aria-label="Aviso de proteção de dados"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-4 h-4 shrink-0 mt-0.5"
        style={{ color: 'var(--info)' }}
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
      </svg>
      <p className="font-sans text-xs leading-relaxed" style={{ color: 'var(--info)' }}>
        Decisões mostradas com dados de identificação pessoal mascarados conforme política de
        proteção de dados (LGPD).
      </p>
    </div>
  );
}

// ─── Skeleton de card ─────────────────────────────────────────────────────────

function SkeletonCard({ index }: { index: number }): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-border overflow-hidden animate-pulse"
      style={{ boxShadow: 'var(--elev-1)', background: 'var(--bg-elev-1)' }}
      aria-hidden="true"
      key={index}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full" style={{ background: 'var(--surface-muted)' }} />
          <div className="h-4 w-32 rounded" style={{ background: 'var(--surface-muted)' }} />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-5 w-10 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
          <div
            className="h-3 w-28 rounded hidden sm:block"
            style={{ background: 'var(--surface-muted)' }}
          />
        </div>
      </div>
      {/* Body */}
      <div className="p-4 flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 rounded" style={{ background: 'var(--surface-muted)' }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div
            className="h-14 rounded-md border border-border"
            style={{ background: 'var(--bg-elev-2)' }}
          />
          <div
            className="h-14 rounded-md border border-border"
            style={{ background: 'var(--bg-elev-2)' }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Summary bar (total de nós, custo total, tokens totais) ──────────────────

interface SummaryBarProps {
  nodeCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number | null;
  totalCostBrl: number | null;
  durationMs: number | null;
}

function SummaryBar({
  nodeCount,
  totalTokensIn,
  totalTokensOut,
  totalCostUsd,
  totalCostBrl,
  durationMs,
}: SummaryBarProps): React.JSX.Element {
  function fmtCostUsd(v: number | null): string {
    if (v === null) return '—';
    return `$${v.toFixed(4)}`;
  }

  function fmtCostBrl(v: number | null): string {
    if (v === null) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 4,
    }).format(v);
  }

  function fmtDuration(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  const stats = [
    { label: 'Nós executados', value: String(nodeCount) },
    {
      label: 'Tokens (in)',
      value: totalTokensIn.toLocaleString('pt-BR'),
    },
    {
      label: 'Tokens (out)',
      value: totalTokensOut.toLocaleString('pt-BR'),
    },
    { label: 'Custo USD', value: fmtCostUsd(totalCostUsd) },
    { label: 'Custo BRL', value: fmtCostBrl(totalCostBrl) },
    { label: 'Duração total', value: fmtDuration(durationMs) },
  ];

  return (
    <div
      className="grid grid-cols-3 sm:grid-cols-6 gap-px rounded-lg border border-border overflow-hidden"
      style={{ boxShadow: 'var(--elev-1)' }}
      aria-label="Resumo da conversa"
    >
      {stats.map(({ label, value }) => (
        <div
          key={label}
          className="flex flex-col gap-0.5 px-3 py-2.5"
          style={{ background: 'var(--bg-elev-1)' }}
        >
          <span
            className="font-sans uppercase tracking-widest text-ink-3"
            style={{ fontSize: '0.6rem' }}
          >
            {label}
          </span>
          <span className="font-mono font-semibold text-ink" style={{ fontSize: 'var(--text-sm)' }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Linha de tempo visual ────────────────────────────────────────────────────

function TimelineConnector({ hasError }: { hasError: boolean }): React.JSX.Element {
  return (
    <div className="flex justify-center py-1" aria-hidden="true">
      <div
        className="w-0.5 h-4 rounded-full"
        style={{
          background: hasError ? 'var(--danger)' : 'var(--border-strong)',
          opacity: hasError ? 0.6 : 0.4,
        }}
      />
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="w-12 h-12 text-ink-4"
        aria-hidden="true"
      >
        <rect x="6" y="14" width="36" height="6" rx="2" />
        <rect x="6" y="26" width="24" height="6" rx="2" />
      </svg>
      <div className="flex flex-col gap-1">
        <p
          className="font-display font-semibold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Nenhuma decisão nesta conversa
        </p>
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          O agente não registrou decisões para este ID de conversa.
        </p>
      </div>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="w-12 h-12 text-danger"
        aria-hidden="true"
      >
        <circle cx="24" cy="24" r="18" />
        <path d="M24 16v10M24 30v2" strokeLinecap="round" />
      </svg>
      <p
        className="font-display font-semibold text-ink"
        style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
      >
        Falha ao carregar a timeline
      </p>
      <p className="font-sans text-sm text-ink-3 max-w-xs">
        Verifique sua conexão e recarregue a página.
      </p>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Timeline de decisões de uma conversa específica.
 * Rota: /configuracoes/ia/decisoes/conversa/:conversationId
 */
export function ConversationTimelinePage(): React.JSX.Element {
  const { conversationId = '' } = useParams<{ conversationId: string }>();
  const { hasPermission } = useAuth();

  // Derivar permissão antes dos hooks de dados (mas nunca antes dos hooks do React)
  const hasReadPermission = hasPermission('ai_decisions:read');

  // Hook de dados sempre chamado — enabled:false evita fetch quando sem permissão.
  // O guard early-return vem APÓS todos os hooks (Rules of Hooks).
  const { decisions, isLoading, isError } = useConversationTimeline(conversationId, {
    enabled: hasReadPermission,
  });

  // Computar resumo agregado (só quando carregado)
  const summary = React.useMemo(() => {
    if (decisions.length === 0) return null;

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCostUsd: number | null = null;
    let totalCostBrl: number | null = null;

    for (const d of decisions) {
      totalTokensIn += d.tokens_in ?? 0;
      totalTokensOut += d.tokens_out ?? 0;
      if (d.cost_usd !== null) {
        totalCostUsd = (totalCostUsd ?? 0) + d.cost_usd;
      }
      if (d.cost_brl !== null) {
        totalCostBrl = (totalCostBrl ?? 0) + d.cost_brl;
      }
    }

    // Duração: diff entre primeira e última decisão
    const sorted = [...decisions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const durationMs =
      first && last
        ? new Date(last.created_at).getTime() - new Date(first.created_at).getTime()
        : null;

    return { totalTokensIn, totalTokensOut, totalCostUsd, totalCostBrl, durationMs };
  }, [decisions]);

  // Ordenar cronologicamente (ascendente) para a timeline
  const sorted = React.useMemo(
    () =>
      [...decisions].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    [decisions],
  );

  // RBAC: sem ai_decisions:read → 404 (após todos os hooks)
  if (!hasReadPermission) {
    return <Navigate to="/404" replace />;
  }

  // Timestamp da primeira decisão (para o subtítulo)
  const firstTimestamp = sorted[0]?.created_at ?? null;

  return (
    <div className="flex flex-col gap-6">
      {/* ── Breadcrumb ─────────────────────────────────────────────── */}
      <nav aria-label="Navegação de contexto" className="flex items-center gap-2">
        <Link
          to="/configuracoes/ia/decisoes"
          className="font-sans text-sm text-ink-3 hover:text-ink transition-colors duration-[150ms]"
        >
          Decisões do Agente
        </Link>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-3.5 h-3.5 text-ink-4"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <span
          className="font-mono text-sm font-semibold text-ink truncate max-w-[200px]"
          title={conversationId}
        >
          {conversationId}
        </span>
      </nav>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <h1
          className="font-display font-bold text-ink"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.04em',
            lineHeight: '1',
            fontVariationSettings: "'opsz' 32",
          }}
        >
          Timeline da Conversa
        </h1>
        <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
          {firstTimestamp
            ? `Iniciada em ${formatDateTime(firstTimestamp)} · ${sorted.length} nós executados`
            : 'Carregando timeline...'}
        </p>
      </div>

      {/* ── Banner LGPD ─────────────────────────────────────────────── */}
      <LgpdBanner />

      {/* ── Summary bar ─────────────────────────────────────────────── */}
      {!isLoading && !isError && summary !== null && (
        <SummaryBar
          nodeCount={sorted.length}
          totalTokensIn={summary.totalTokensIn}
          totalTokensOut={summary.totalTokensOut}
          totalCostUsd={summary.totalCostUsd}
          totalCostBrl={summary.totalCostBrl}
          durationMs={summary.durationMs}
        />
      )}

      {/* ── Loading skeletons ────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex flex-col gap-1" aria-busy="true" aria-label="Carregando timeline">
          {Array.from({ length: 4 }).map((_, i) => (
            <React.Fragment key={i}>
              <SkeletonCard index={i} />
              {i < 3 && <TimelineConnector hasError={false} />}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────── */}
      {isError && !isLoading && (
        <div
          className="rounded-lg border border-border overflow-hidden"
          style={{ boxShadow: 'var(--elev-1)', background: 'var(--bg-elev-1)' }}
        >
          <ErrorState />
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────── */}
      {!isLoading && !isError && sorted.length === 0 && (
        <div
          className="rounded-lg border border-border overflow-hidden"
          style={{ boxShadow: 'var(--elev-1)', background: 'var(--bg-elev-1)' }}
        >
          <EmptyState />
        </div>
      )}

      {/* ── Timeline de cards ────────────────────────────────────────── */}
      {!isLoading && !isError && sorted.length > 0 && (
        <div
          className="flex flex-col"
          role="feed"
          aria-label={`Timeline da conversa ${conversationId}`}
        >
          {sorted.map((decision, index) => (
            <React.Fragment key={decision.id}>
              <DecisionCard
                decision={decision}
                index={index + 1}
                // promptKey poderia vir de um contexto de configuração — por ora
                // deixamos undefined; quando F9-S05 expuser o mapping
                // key→node_name, pode ser passado aqui.
                promptKey={undefined}
              />
              {/* Conector visual entre cards */}
              {index < sorted.length - 1 && (
                <TimelineConnector hasError={Boolean(decision.error)} />
              )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── Link de volta ────────────────────────────────────────────── */}
      {!isLoading && (
        <div className="pt-2">
          <Link
            to="/configuracoes/ia/decisoes"
            className={cn(
              'inline-flex items-center gap-1.5',
              'font-sans text-sm font-medium text-ink-3',
              'hover:text-ink transition-colors duration-[150ms]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M10 4l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Voltar para decisões
          </Link>
        </div>
      )}
    </div>
  );
}
