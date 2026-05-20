// =============================================================================
// features/configuracoes/ai-console/decisions/DecisionsListPage.tsx
//
// Lista filtrável de ai_decision_logs.
// Rota: /configuracoes/ia/decisoes
//
// Funcionalidades:
//   - Filtros: data range, conversation_id, lead_id, intent, node, model
//   - Estado dos filtros na URL (querystring) — navegação/bookmark-safe
//   - Paginação cursor-based (próxima página via next_cursor)
//   - Colunas: timestamp, nó, intent, model, tokens, latência, status
//   - Link de linha → timeline da conversa (quando conversation_id disponível)
//   - Banner LGPD discreto no topo
//   - Estados: loading (skeleton), empty (com CTA), error
//
// RBAC: ai_decisions:read → 404 sem permissão
// LGPD: dados mascarados pelo backend — UI não tenta de-mask
// DS: light-first, elev-2 nos cards, hover conforme §8, tokens canônicos
// =============================================================================

import * as React from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import { type DecisionFilters, useDecisionsList } from '../../../../hooks/ai-console/useDecisions';
import { useAuth } from '../../../../lib/auth-store';
import { cn } from '../../../../lib/cn';

import { DecisionRow } from './DecisionCard';
import { DecisionFilters as DecisionFiltersPanel, type FilterValues } from './DecisionFilters';

// ─── Banner LGPD ─────────────────────────────────────────────────────────────

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

// ─── Skeleton de linha ────────────────────────────────────────────────────────

function SkeletonRow({ index }: { index: number }): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0 animate-pulse"
      aria-hidden="true"
      key={index}
    >
      <div className="h-3 w-36 rounded shrink-0" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-3 w-28 rounded shrink-0" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-3 flex-1 rounded" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-3 w-28 rounded shrink-0" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-3 w-24 rounded shrink-0" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-3 w-14 rounded shrink-0" style={{ background: 'var(--surface-muted)' }} />
      <div
        className="h-5 w-16 rounded-pill shrink-0"
        style={{ background: 'var(--surface-muted)' }}
      />
    </div>
  );
}

// ─── Cabeçalho da tabela ─────────────────────────────────────────────────────

function TableHeader(): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 border-b border-border"
      style={{ background: 'var(--bg-elev-2)' }}
    >
      <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3 w-36 shrink-0">
        Timestamp
      </span>
      <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3 w-32 shrink-0">
        Nó
      </span>
      <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3 flex-1">
        Intent
      </span>
      <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3 w-32 shrink-0">
        Modelo
      </span>
      <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3 w-28 shrink-0 text-right">
        Tokens
      </span>
      <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3 w-16 shrink-0 text-right">
        Latência
      </span>
      <span className="font-sans text-xs font-semibold uppercase tracking-widest text-ink-3 w-20 shrink-0 text-right">
        Status
      </span>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ hasFilters }: { hasFilters: boolean }): React.JSX.Element {
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
        <rect x="6" y="10" width="36" height="28" rx="3" />
        <path d="M14 20h20M14 26h12" strokeLinecap="round" />
        <circle cx="36" cy="30" r="8" fill="var(--bg)" />
        <path d="M33 30l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex flex-col gap-1">
        <p
          className="font-display font-semibold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          {hasFilters ? 'Nenhuma decisão encontrada' : 'Sem decisões registradas'}
        </p>
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          {hasFilters
            ? 'Tente ajustar os filtros para ampliar os resultados.'
            : 'As decisões do agente de IA aparecerão aqui quando o grafo for ativado.'}
        </p>
      </div>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ onRetry }: { onRetry: () => void }): React.JSX.Element {
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
      <div className="flex flex-col gap-1">
        <p
          className="font-display font-semibold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Falha ao carregar decisões
        </p>
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          Verifique sua conexão e tente novamente.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          'inline-flex items-center gap-2 px-4 py-2.5 rounded-sm',
          'font-sans text-sm font-semibold',
          'border border-border-strong bg-surface-1 text-ink',
          'hover:border-azul hover:text-azul',
          'transition-[border-color,color] duration-[150ms] ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        )}
      >
        Tentar novamente
      </button>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

/**
 * Lista filtrável de decisões do agente de IA.
 * Rota: /configuracoes/ia/decisoes
 */
export function DecisionsListPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);

  // Derivar permissão antes dos hooks de dados (mas nunca antes dos hooks do React)
  const hasReadPermission = hasPermission('ai_decisions:read');

  // Ler filtros da URL
  const filterValues: FilterValues = {
    date_from: searchParams.get('date_from') ?? '',
    date_to: searchParams.get('date_to') ?? '',
    conversation_id: searchParams.get('conversation_id') ?? '',
    lead_id: searchParams.get('lead_id') ?? '',
    intent: searchParams.get('intent') ?? '',
    node: searchParams.get('node') ?? '',
    model: searchParams.get('model') ?? '',
  };

  const hasActiveFilter = Object.values(filterValues).some((v) => v.length > 0);

  // Montar filtros para o hook
  const queryFilters: DecisionFilters = {
    ...(filterValues.date_from ? { date_from: filterValues.date_from } : {}),
    ...(filterValues.date_to ? { date_to: filterValues.date_to } : {}),
    ...(filterValues.conversation_id ? { conversation_id: filterValues.conversation_id } : {}),
    ...(filterValues.lead_id ? { lead_id: filterValues.lead_id } : {}),
    ...(filterValues.intent ? { intent: filterValues.intent } : {}),
    ...(filterValues.node ? { node: filterValues.node } : {}),
    ...(filterValues.model ? { model: filterValues.model } : {}),
    ...(cursor ? { cursor } : {}),
    limit: PAGE_SIZE,
  };

  // Hook de dados sempre chamado — enabled:false evita fetch quando sem permissão.
  // O guard early-return vem APÓS todos os hooks (Rules of Hooks).
  const { data, isLoading, isError } = useDecisionsList(queryFilters, {
    enabled: hasReadPermission,
  });

  // RBAC: sem ai_decisions:read → 404 (após todos os hooks)
  if (!hasReadPermission) {
    return <Navigate to="/404" replace />;
  }

  // Atualizar filtro na URL
  function handleFilterChange(key: keyof FilterValues, value: string) {
    setCursor(undefined);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function handleFilterReset() {
    setCursor(undefined);
    setSearchParams({});
  }

  function handleNextPage() {
    if (data?.next_cursor) {
      setCursor(data.next_cursor);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handlePrevPage() {
    setCursor(undefined);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
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
            Decisões do Agente
          </h1>
          <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
            Histórico de decisões do grafo LangGraph — cada linha representa uma execução de nó.
          </p>
        </div>
      </div>

      {/* ── Banner LGPD ─────────────────────────────────────────────── */}
      <LgpdBanner />

      {/* ── Filtros ─────────────────────────────────────────────────── */}
      <DecisionFiltersPanel
        values={filterValues}
        onChange={handleFilterChange}
        onReset={handleFilterReset}
      />

      {/* ── Tabela ──────────────────────────────────────────────────── */}
      <div
        className="rounded-lg border border-border overflow-hidden"
        style={{ boxShadow: 'var(--elev-2)' }}
      >
        <TableHeader />

        {/* Loading */}
        {isLoading && (
          <div aria-busy="true" aria-label="Carregando decisões">
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonRow key={i} index={i} />
            ))}
          </div>
        )}

        {/* Error */}
        {isError && !isLoading && <ErrorState onRetry={() => setCursor(undefined)} />}

        {/* Empty */}
        {!isLoading && !isError && (data?.data ?? []).length === 0 && (
          <EmptyState hasFilters={hasActiveFilter} />
        )}

        {/* Dados */}
        {!isLoading && !isError && (data?.data ?? []).length > 0 && (
          <div>
            {(data?.data ?? []).map((decision) => (
              <DecisionRow key={decision.id} decision={decision} />
            ))}
          </div>
        )}
      </div>

      {/* ── Paginação ───────────────────────────────────────────────── */}
      {!isLoading && !isError && (data?.data ?? []).length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="font-sans text-xs text-ink-3">
            {data?.total !== undefined
              ? `${data.total.toLocaleString('pt-BR')} decisões no total`
              : `${(data?.data ?? []).length} decisões nesta página`}
          </span>

          <div className="flex items-center gap-2">
            {cursor && (
              <button
                type="button"
                onClick={handlePrevPage}
                className={cn(
                  'inline-flex items-center gap-1.5 px-4 py-2 rounded-sm',
                  'font-sans text-sm font-medium text-ink-2',
                  'border border-border bg-surface-1',
                  'hover:border-azul hover:text-azul',
                  'transition-[border-color,color] duration-[150ms] ease-out',
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
                Primeira página
              </button>
            )}

            {data?.next_cursor && (
              <button
                type="button"
                onClick={handleNextPage}
                className={cn(
                  'inline-flex items-center gap-1.5 px-4 py-2 rounded-sm',
                  'font-sans text-sm font-semibold',
                  '[background:var(--grad-azul)] text-[var(--text-on-brand)]',
                  '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
                  'hover:-translate-y-0.5 hover:[box-shadow:var(--glow-azul)]',
                  'active:translate-y-0 active:[box-shadow:var(--elev-1)]',
                  'transition-[transform,box-shadow] duration-[150ms] ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
                )}
              >
                Próxima página
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
