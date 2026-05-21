// =============================================================================
// features/configuracoes/ai-console/playground/PlaygroundTrace.tsx
//
// Painel de resultado do playground — exibe resposta da IA + trace do grafo.
//
// Estrutura:
//   1. Banner DRY-RUN permanente no topo (amarelo de aviso — não vermelho)
//   2. Aviso DLP quando dlp_applied = true (DlpNotice)
//   3. Resposta da IA (reply)
//   4. Trace do grafo: cards por nó
//   5. Métricas globais: tokens totais, latência total, prompt versions usadas
//
// DS (doc 18):
//   - Banner DRY-RUN: --warning / --warning-bg + borda amarela
//   - Cards de nó: elev-2, hover Lift, Bricolage para node name, Mono para valores
//   - Skeleton: animate-pulse quando isPending
//   - Card de erro: border-danger, sem stacktrace exposta
//
// LGPD (doc 17):
//   - reply/trace mascarados pelo backend — UI não tenta de-mask
//   - Sem console.log de qualquer campo da resposta
// =============================================================================

import * as React from 'react';

import type {
  PlaygroundResponse,
  PlaygroundTraceNode,
} from '../../../../hooks/ai-console/usePlayground';
import { cn } from '../../../../lib/cn';

import { DlpNotice } from './DlpNotice';

// ─── Banner DRY-RUN ───────────────────────────────────────────────────────────

/**
 * Banner permanente de aviso DRY-RUN.
 * Sempre visível no painel de resultado — nunca condicional.
 * Cor: amarelo de aviso (--warning / --warning-bg), nunca vermelho de erro.
 */
function DryRunBanner(): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-2.5 px-4 py-3 rounded-md border"
      style={{
        background: 'var(--warning-bg)',
        borderColor: 'var(--brand-amarelo)',
        borderWidth: '1px',
      }}
      role="alert"
      aria-label="Modo DRY-RUN ativo"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-4 h-4 shrink-0"
        style={{ color: 'var(--warning)' }}
        aria-hidden="true"
      >
        <path d="M8 2L1.5 13h13L8 2z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8 6v4M8 11.5v.5" strokeLinecap="round" />
      </svg>
      <p
        className="font-sans font-semibold"
        style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}
      >
        DRY-RUN — nada é persistido e nada é enviado ao cliente.
      </p>
    </div>
  );
}

// ─── MetaItem (label + valor) ─────────────────────────────────────────────────

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

// ─── Formatadores locais ──────────────────────────────────────────────────────

function fmtLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTokens(
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
): string {
  if (tokensIn === null || tokensIn === undefined) return '—';
  const out = tokensOut ?? 0;
  return `${tokensIn.toLocaleString('pt-BR')} → ${out.toLocaleString('pt-BR')}`;
}

// ─── Card de nó do trace ──────────────────────────────────────────────────────

interface TraceNodeCardProps {
  node: PlaygroundTraceNode;
  index: number;
  /**
   * Mensagem de erro associada a este nó, derivada do array `errors[]` da
   * response (cruzando pelo nome do node). O contrato do backend não carrega
   * `error` por entry de trace — erros vivem em `result.errors[]` (objetos).
   */
  nodeError?: string | null;
}

function TraceNodeCard({ node, index, nodeError }: TraceNodeCardProps): React.JSX.Element {
  const hasError = Boolean(nodeError);

  return (
    <article
      className={cn(
        'rounded-lg border overflow-hidden',
        'transition-all duration-[250ms] ease-out',
        // Hover Lift (DS §8)
        'hover:-translate-y-px',
        hasError ? 'border-danger/40' : 'border-border',
      )}
      style={{
        boxShadow: 'var(--elev-2)',
        background: 'var(--bg-elev-1)',
      }}
      aria-label={`Nó ${index}: ${node.node}`}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3 border-b',
          hasError ? 'border-danger/20' : 'border-border',
        )}
        style={{
          background: hasError ? 'var(--danger-bg)' : 'var(--bg-elev-2)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Número ordinal */}
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
          {/* Nome do nó */}
          <h4
            className="font-display font-bold text-ink truncate"
            style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.03em' }}
          >
            {node.node}
          </h4>
        </div>

        {/* Status badge inline */}
        <span
          className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-sans font-semibold"
          style={{
            background: hasError ? 'var(--danger-bg)' : 'var(--success-bg)',
            color: hasError ? 'var(--danger)' : 'var(--success)',
            border: `1px solid ${hasError ? 'var(--danger)' : 'var(--success)'}`,
            opacity: 0.8,
          }}
        >
          {hasError ? 'Erro' : 'OK'}
        </span>
      </div>

      {/* Body — grid de metadados */}
      <div className="p-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetaItem label="Intent">{node.intent ?? '—'}</MetaItem>
          <MetaItem label="Modelo">{node.model ?? '—'}</MetaItem>
          <MetaItem label="Prompt">
            {/* prompt_version já vem formatado pelo backend como "<key>@v<N>" */}
            {node.prompt_version ?? '—'}
          </MetaItem>
          <MetaItem label="Latência">{fmtLatency(node.latency_ms)}</MetaItem>
        </div>

        <MetaItem label="Tokens (in → out)">{fmtTokens(node.tokens_in, node.tokens_out)}</MetaItem>

        {/* Erro (se houver) — sem stacktrace */}
        {hasError && nodeError && (
          <div
            className="p-3 rounded-md border border-danger/30"
            style={{ background: 'var(--danger-bg)' }}
            role="alert"
          >
            <p
              className="font-sans text-xs uppercase tracking-widest font-semibold mb-1"
              style={{ color: 'var(--danger)', fontSize: '0.6rem' }}
            >
              Erro do nó
            </p>
            <p className="font-mono text-xs text-ink break-all leading-relaxed">{nodeError}</p>
          </div>
        )}
      </div>
    </article>
  );
}

// ─── Conector visual entre nós ────────────────────────────────────────────────

function TraceConnector({ hasError }: { hasError: boolean }): React.JSX.Element {
  return (
    <div className="flex justify-center py-0.5" aria-hidden="true">
      <div
        className="w-0.5 h-3 rounded-full"
        style={{
          background: hasError ? 'var(--danger)' : 'var(--border-strong)',
          opacity: hasError ? 0.6 : 0.4,
        }}
      />
    </div>
  );
}

// ─── Métricas globais ─────────────────────────────────────────────────────────

interface GlobalMetricsProps {
  tokensTotal: number;
  latencyMs: number;
  promptVersionsUsed: string[];
}

function GlobalMetrics({
  tokensTotal,
  latencyMs,
  promptVersionsUsed,
}: GlobalMetricsProps): React.JSX.Element {
  return (
    <div
      className="grid grid-cols-3 gap-px rounded-lg border border-border overflow-hidden"
      style={{ boxShadow: 'var(--elev-1)' }}
      aria-label="Métricas globais da execução"
    >
      {[
        { label: 'Tokens totais', value: tokensTotal.toLocaleString('pt-BR') },
        { label: 'Latência total', value: fmtLatency(latencyMs) },
        {
          label: 'Prompt versions',
          value: promptVersionsUsed.length > 0 ? promptVersionsUsed.join(', ') : '—',
        },
      ].map(({ label, value }) => (
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

// ─── Skeleton do painel de resultado ─────────────────────────────────────────

function ResultSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-4 animate-pulse"
      aria-busy="true"
      aria-label="Carregando resultado"
    >
      {/* Resposta da IA */}
      <div
        className="rounded-lg border border-border p-4 flex flex-col gap-2"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
      >
        <div className="h-3 w-24 rounded" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-4 w-full rounded" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-4 w-3/4 rounded" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-4 w-5/6 rounded" style={{ background: 'var(--surface-muted)' }} />
      </div>

      {/* Trace cards skeleton */}
      {Array.from({ length: 3 }).map((_, i) => (
        <React.Fragment key={i}>
          <div
            className="rounded-lg border border-border overflow-hidden"
            style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
          >
            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 border-b border-border"
              style={{ background: 'var(--bg-elev-2)' }}
            >
              <div
                className="w-6 h-6 rounded-full"
                style={{ background: 'var(--surface-muted)' }}
              />
              <div className="h-4 w-28 rounded" style={{ background: 'var(--surface-muted)' }} />
            </div>
            {/* Body */}
            <div className="p-4 grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, j) => (
                <div
                  key={j}
                  className="h-8 rounded"
                  style={{ background: 'var(--surface-muted)' }}
                />
              ))}
            </div>
          </div>
          {i < 2 && <TraceConnector hasError={false} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Empty state (antes da primeira execução) ─────────────────────────────────

function EmptyResult(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center justify-center py-14 gap-4 text-center rounded-lg border border-border"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        className="w-10 h-10 text-ink-4"
        aria-hidden="true"
      >
        <rect x="8" y="14" width="32" height="22" rx="3" />
        <path d="M16 24h16M16 30h10" strokeLinecap="round" />
        <path d="M24 14v-4M20 10h8" strokeLinecap="round" />
      </svg>
      <div className="flex flex-col gap-1">
        <p
          className="font-display font-semibold text-ink"
          style={{ fontSize: 'var(--text-base)', letterSpacing: '-0.02em' }}
        >
          Aguardando execução
        </p>
        <p className="font-sans text-sm text-ink-3 max-w-xs">
          Preencha a mensagem e clique em Rodar para ver o trace do agente.
        </p>
      </div>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorResult({ message }: { message: string | null }): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-danger/30 p-5 flex flex-col gap-3"
      style={{ background: 'var(--danger-bg)', boxShadow: 'var(--elev-1)' }}
      role="alert"
    >
      <div className="flex items-center gap-2">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-4 h-4 shrink-0"
          style={{ color: 'var(--danger)' }}
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3M8 10v.5" strokeLinecap="round" />
        </svg>
        <p
          className="font-sans font-semibold"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}
        >
          Falha na execução do playground
        </p>
      </div>
      <p className="font-sans text-sm text-ink-2 leading-relaxed">
        {message ?? 'Erro inesperado. Verifique sua conexão e tente novamente.'}
      </p>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface PlaygroundTraceProps {
  result: PlaygroundResponse | null;
  isPending: boolean;
  isError: boolean;
  errorMessage: string | null;
}

/**
 * Painel direito do playground — resultado, trace, métricas e avisos.
 *
 * Sempre renderiza o DryRunBanner no topo (permanente).
 * Alterna entre empty/skeleton/error/resultado dependendo do estado.
 */
export function PlaygroundTrace({
  result,
  isPending,
  isError,
  errorMessage,
}: PlaygroundTraceProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {/* DRY-RUN banner — sempre visível */}
      <DryRunBanner />

      {/* Loading */}
      {isPending && <ResultSkeleton />}

      {/* Error */}
      {isError && !isPending && <ErrorResult message={errorMessage} />}

      {/* Empty (antes da primeira execução) */}
      {!isPending && !isError && result === null && <EmptyResult />}

      {/* Resultado */}
      {!isPending &&
        !isError &&
        result !== null &&
        (() => {
          // ────────────────────────────────────────────────────────────────
          // Derivar erro por entry de trace cruzando com result.errors[].
          // Backend não envia `error` por entry; envia objetos `{node, error}`
          // no nível raiz. Construímos um índice por nome de node aqui.
          // Se múltiplos errors apontarem para o mesmo node, mostramos o último.
          // ────────────────────────────────────────────────────────────────
          const errorByNode = new Map<string, string>();
          for (const err of result.errors) {
            const node = typeof err['node'] === 'string' ? err['node'] : null;
            const msg = typeof err['error'] === 'string' ? err['error'] : null;
            if (node && msg) errorByNode.set(node, msg);
          }
          const replyContent = result.reply_content.trim();
          const hasReply = replyContent.length > 0 && result.reply_type !== 'none';

          return (
            <div className="flex flex-col gap-4">
              {/* Aviso DLP */}
              {result.dlp_applied && <DlpNotice dlpTokens={result.dlp_tokens} />}

              {/* Aviso de handoff (se o grafo solicitou) */}
              {result.handoff_required && (
                <div
                  className="rounded-md border border-warning/30 p-3"
                  style={{ background: 'var(--warning-bg)' }}
                  role="alert"
                >
                  <p
                    className="font-sans font-semibold text-xs uppercase tracking-widest mb-1"
                    style={{ color: 'var(--warning)', fontSize: '0.6rem' }}
                  >
                    Handoff solicitado pelo agente
                  </p>
                  {result.handoff_reason && (
                    <p className="font-sans text-sm text-ink leading-relaxed">
                      {result.handoff_reason}
                    </p>
                  )}
                </div>
              )}

              {/* Resposta da IA */}
              <section aria-label="Resposta do agente de IA">
                <div
                  className="rounded-lg border border-border overflow-hidden"
                  style={{ boxShadow: 'var(--elev-2)', background: 'var(--bg-elev-1)' }}
                >
                  {/* Header da seção */}
                  <div
                    className="flex items-center gap-2 px-4 py-3 border-b border-border"
                    style={{ background: 'var(--bg-elev-2)' }}
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      className="w-4 h-4 shrink-0"
                      style={{ color: 'var(--brand-azul)' }}
                      aria-hidden="true"
                    >
                      <rect x="2" y="3" width="12" height="10" rx="2" />
                      <path d="M5 7h6M5 10h4" strokeLinecap="round" />
                    </svg>
                    <h3
                      className="font-sans font-semibold text-ink"
                      style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
                    >
                      Resposta que seria enviada
                    </h3>
                  </div>
                  {/* Conteúdo */}
                  <div className="p-4">
                    {hasReply ? (
                      <p className="font-sans text-sm text-ink leading-relaxed whitespace-pre-wrap">
                        {replyContent}
                      </p>
                    ) : (
                      <p
                        className="font-sans text-sm text-ink-3 italic leading-relaxed"
                        aria-label="Sem resposta a enviar"
                      >
                        {result.reply_type === 'none'
                          ? 'Nenhuma resposta gerada (grafo não produziu reply neste turno).'
                          : 'Resposta vazia.'}
                      </p>
                    )}
                  </div>
                </div>
              </section>

              {/* Trace do grafo */}
              {result.trace.length > 0 && (
                <section aria-label="Trace do grafo de execução">
                  <h3
                    className="font-sans font-semibold text-ink-2 mb-3 uppercase tracking-widest"
                    style={{ fontSize: '0.65rem' }}
                  >
                    Trace do grafo
                  </h3>
                  <div className="flex flex-col" role="feed" aria-label="Nós executados">
                    {result.trace.map((node, index) => {
                      const nodeError = errorByNode.get(node.node) ?? null;
                      return (
                        <React.Fragment key={`${node.node}-${index}`}>
                          <TraceNodeCard node={node} index={index + 1} nodeError={nodeError} />
                          {index < result.trace.length - 1 && (
                            <TraceConnector hasError={Boolean(nodeError)} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Métricas globais */}
              <section aria-label="Métricas globais">
                <h3
                  className="font-sans font-semibold text-ink-2 mb-3 uppercase tracking-widest"
                  style={{ fontSize: '0.65rem' }}
                >
                  Métricas globais
                </h3>
                <GlobalMetrics
                  tokensTotal={result.tokens_total}
                  latencyMs={result.latency_ms}
                  promptVersionsUsed={result.prompt_versions_used}
                />
              </section>

              {/* Erros globais — objetos {node, error, ...} */}
              {result.errors.length > 0 && (
                <div
                  className="rounded-md border border-danger/30 p-3"
                  style={{ background: 'var(--danger-bg)' }}
                  role="alert"
                  aria-label="Erros durante execução"
                >
                  <p
                    className="font-sans font-semibold text-xs uppercase tracking-widest mb-2"
                    style={{ color: 'var(--danger)', fontSize: '0.6rem' }}
                  >
                    Erros durante execução ({result.errors.length})
                  </p>
                  <ul className="flex flex-col gap-2">
                    {result.errors.map((err, i) => {
                      const node = typeof err['node'] === 'string' ? err['node'] : null;
                      const msg =
                        typeof err['error'] === 'string' ? err['error'] : JSON.stringify(err);
                      return (
                        <li
                          key={i}
                          className="font-mono text-xs text-ink break-all leading-relaxed"
                        >
                          {node && (
                            <span className="font-semibold" style={{ color: 'var(--danger)' }}>
                              {node}:{' '}
                            </span>
                          )}
                          {msg}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
