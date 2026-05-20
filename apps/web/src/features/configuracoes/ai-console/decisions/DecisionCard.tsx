// =============================================================================
// features/configuracoes/ai-console/decisions/DecisionCard.tsx
//
// Card de uma decisão do agente de IA.
// Usado tanto na lista (compacto) quanto na timeline (expandido).
//
// DS (doc 18):
//   - Profundidade elev-2 nos cards
//   - Hover Lift (translate-y-1 + elev-4)
//   - Status: ok → Badge success, error → Badge danger
//   - Tipografia: Bricolage para node_name, Geist para metadados, Mono para valores
//   - Cores da bandeira: azul (primário), verde (ok), vermelho (error)
//
// LGPD (doc 17):
//   - Nunca logar decision/context/lead_id em console
//   - UI confia no masking do backend — sem tentativa de de-mask
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import { Badge } from '../../../../components/ui/Badge';
import { type DecisionItem } from '../../../../hooks/ai-console/useDecisions';
import { cn } from '../../../../lib/cn';

// ─── Formatadores ─────────────────────────────────────────────────────────────

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

export function formatCost(value: number | null | undefined, currency: 'USD' | 'BRL'): string {
  if (value === null || value === undefined) return '—';
  if (currency === 'USD') {
    return `$${value.toFixed(4)}`;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  if (tokensIn === null || tokensIn === undefined) return '—';
  const out = tokensOut ?? 0;
  return `${tokensIn.toLocaleString('pt-BR')} → ${out.toLocaleString('pt-BR')}`;
}

// ─── Metadado item (label + valor) ────────────────────────────────────────────

function MetaItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span
        className="font-sans uppercase tracking-widest text-ink-3 truncate"
        style={{ fontSize: '0.6rem' }}
      >
        {label}
      </span>
      <span className="font-mono text-xs text-ink truncate">{children}</span>
    </div>
  );
}

// ─── Variante compacta (lista) ────────────────────────────────────────────────

interface DecisionRowProps {
  decision: DecisionItem;
}

/**
 * Linha compacta de uma decisão para uso na tabela/lista.
 * Hover Lift com link para a timeline da conversa quando aplicável.
 */
export function DecisionRow({ decision }: DecisionRowProps): React.JSX.Element {
  const hasError = Boolean(decision.error);
  const linkTo = decision.conversation_id
    ? `/configuracoes/ia/decisoes/conversa/${encodeURIComponent(decision.conversation_id)}`
    : null;

  const content = (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 border-b border-border last:border-b-0',
        'transition-all duration-[150ms] ease-out',
        linkTo && 'hover:bg-surface-hover cursor-pointer',
      )}
      aria-label={`Decisão do nó ${decision.node_name}`}
    >
      {/* Timestamp */}
      <span className="font-mono text-xs text-ink-3 shrink-0 w-36" title={decision.created_at}>
        {formatDateTime(decision.created_at)}
      </span>

      {/* Nó */}
      <span
        className="font-display font-semibold text-ink shrink-0 w-32 truncate"
        style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.02em' }}
        title={decision.node_name}
      >
        {decision.node_name}
      </span>

      {/* Intent */}
      <span className="font-sans text-xs text-ink-2 flex-1 truncate min-w-0">
        {decision.intent ?? '—'}
      </span>

      {/* Model */}
      <span
        className="font-mono text-xs text-ink-3 shrink-0 w-32 truncate"
        title={decision.model ?? undefined}
      >
        {decision.model ?? '—'}
      </span>

      {/* Tokens */}
      <span className="font-mono text-xs text-ink-3 shrink-0 w-28 text-right">
        {formatTokens(decision.tokens_in, decision.tokens_out)}
      </span>

      {/* Latência */}
      <span className="font-mono text-xs text-ink-3 shrink-0 w-16 text-right">
        {formatLatency(decision.latency_ms)}
      </span>

      {/* Status */}
      <div className="shrink-0 w-20 flex justify-end">
        {hasError ? <Badge variant="danger">Erro</Badge> : <Badge variant="success">OK</Badge>}
      </div>
    </div>
  );

  if (linkTo) {
    return (
      <Link
        to={linkTo}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 focus-visible:ring-inset"
      >
        {content}
      </Link>
    );
  }

  return content;
}

// ─── Variante expandida (timeline) ────────────────────────────────────────────

interface DecisionCardProps {
  decision: DecisionItem;
  /** Número ordinal na timeline (1, 2, 3…) */
  index: number;
  /** Link para detalhe do prompt quando prompt_version disponível */
  promptKey?: string | undefined;
}

/**
 * Card expandido para uso na timeline de conversa.
 * Mostra todos os campos relevantes com hierarquia visual clara.
 * DS: elev-2, hover Lift, tipografia editorial.
 */
export function DecisionCard({ decision, index, promptKey }: DecisionCardProps): React.JSX.Element {
  const hasError = Boolean(decision.error);

  return (
    <article
      className={cn(
        'rounded-lg border overflow-hidden',
        'transition-all duration-[250ms] ease-out',
        hasError ? 'border-danger/40' : 'border-border',
      )}
      style={{ boxShadow: 'var(--elev-2)', background: 'var(--bg-elev-1)' }}
      aria-label={`Decisão ${index}: ${decision.node_name}`}
    >
      {/* ── Header do card ────────────────────────────────────────────── */}
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3 border-b',
          hasError ? 'border-danger/20' : 'border-border',
        )}
        style={{
          background: hasError ? 'var(--danger-bg)' : 'var(--bg-elev-2)',
        }}
      >
        {/* Número + Nome do nó */}
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full font-display font-bold text-xs"
            style={{
              background: hasError ? 'var(--danger)' : 'var(--brand-azul)',
              color: 'var(--text-on-brand)',
            }}
            aria-hidden="true"
          >
            {index}
          </span>
          <h3
            className="font-display font-bold text-ink truncate"
            style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.03em' }}
          >
            {decision.node_name}
          </h3>
        </div>

        {/* Status + Timestamp */}
        <div className="shrink-0 flex items-center gap-3">
          {hasError ? <Badge variant="danger">Erro</Badge> : <Badge variant="success">OK</Badge>}
          <span className="font-mono text-xs text-ink-3 hidden sm:block">
            {formatDateTime(decision.created_at)}
          </span>
        </div>
      </div>

      {/* ── Grid de metadados ──────────────────────────────────────────── */}
      <div className="p-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <MetaItem label="Intent">{decision.intent ?? '—'}</MetaItem>

          <MetaItem label="Modelo">{decision.model ?? '—'}</MetaItem>

          <MetaItem label="Prompt">
            {decision.prompt_version !== null && decision.prompt_version !== undefined ? (
              promptKey ? (
                <Link
                  to={`/configuracoes/ia/prompts/${encodeURIComponent(promptKey)}`}
                  className="text-azul hover:underline transition-colors duration-[150ms]"
                  title={`Ver prompt v${decision.prompt_version}`}
                >
                  v{decision.prompt_version}
                </Link>
              ) : (
                `v${decision.prompt_version}`
              )
            ) : (
              '—'
            )}
          </MetaItem>

          <MetaItem label="Latência">{formatLatency(decision.latency_ms)}</MetaItem>

          <MetaItem label="Tokens (in → out)">
            {formatTokens(decision.tokens_in, decision.tokens_out)}
          </MetaItem>
        </div>

        {/* ── Custos ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className="flex flex-col gap-0.5 p-3 rounded-md border border-border"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <span
              className="font-sans uppercase tracking-widest text-ink-3"
              style={{ fontSize: '0.6rem' }}
            >
              Custo USD
            </span>
            <span
              className="font-mono font-semibold"
              style={{
                fontSize: 'var(--text-base)',
                color: decision.cost_usd !== null ? 'var(--text)' : 'var(--text-4)',
              }}
            >
              {formatCost(decision.cost_usd, 'USD')}
            </span>
          </div>
          <div
            className="flex flex-col gap-0.5 p-3 rounded-md border border-border"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <span
              className="font-sans uppercase tracking-widest text-ink-3"
              style={{ fontSize: '0.6rem' }}
            >
              Custo BRL
            </span>
            <span
              className="font-mono font-semibold"
              style={{
                fontSize: 'var(--text-base)',
                color: decision.cost_brl !== null ? 'var(--text)' : 'var(--text-4)',
              }}
            >
              {formatCost(decision.cost_brl, 'BRL')}
            </span>
          </div>
        </div>

        {/* ── Erro (se houver) ────────────────────────────────────────── */}
        {hasError && decision.error && (
          <div
            className="p-3 rounded-md border border-danger/30"
            style={{ background: 'var(--danger-bg)' }}
            role="alert"
          >
            <p
              className="font-sans text-xs uppercase tracking-widest font-semibold mb-1"
              style={{ color: 'var(--danger)', fontSize: '0.6rem' }}
            >
              Erro do agente
            </p>
            <p className="font-mono text-xs text-ink break-all leading-relaxed">{decision.error}</p>
          </div>
        )}

        {/* ── Chatwoot link ────────────────────────────────────────────── */}
        {decision.chatwoot_conversation_id !== null &&
          decision.chatwoot_conversation_id !== undefined && (
            <div className="flex items-center gap-2">
              <a
                href={`/chatwoot/conversations/${decision.chatwoot_conversation_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'inline-flex items-center gap-1.5',
                  'font-sans text-xs font-medium text-azul',
                  'hover:underline focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-azul/20',
                  'transition-colors duration-[150ms]',
                )}
                aria-label={`Abrir conversa ${decision.chatwoot_conversation_id} no Chatwoot`}
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="w-3.5 h-3.5 shrink-0"
                  aria-hidden="true"
                >
                  <path
                    d="M6 3H3v10h10v-3M8 8l5-5M10 3h3v3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Abrir no Chatwoot (#{decision.chatwoot_conversation_id})
              </a>
            </div>
          )}
      </div>
    </article>
  );
}
