// =============================================================================
// features/configuracoes/ai-console/playground/PlaygroundPage.tsx
//
// Página do playground do agente de IA.
// Rota: /configuracoes/ia/playground
//
// Layout 2 colunas (mobile: empilhado):
//   - Esquerda: PlaygroundForm (mensagem + toggle real/sintético + botão Rodar)
//   - Direita: PlaygroundTrace (banner DRY-RUN + resultado + trace + métricas)
//
// RBAC: sem ai_playground:run → Navigate /404.
//
// Rules-of-Hooks: TODOS os hooks (useState, useMutation, useMemo) são chamados
// ANTES de qualquer early-return de permissão. Guard fica depois dos hooks.
//
// LGPD (doc 18 §14.2):
//   - Sem console.log de message/reply/trace
//   - Sem persistência local de mensagens
//   - Banner "contexto real" com aviso explícito (em PlaygroundForm)
//   - dlp_applied exibido ao operador via DlpNotice
//
// DS (doc 18):
//   - Light-first; dark toggle first-class
//   - Breadcrumb para Configurações → IA
//   - Profundidade elev-2 nos cards do trace
//   - Hover Lift nos trace cards
//   - Tipografia: Bricolage para título, Geist para body, Mono para métricas
// =============================================================================

import * as React from 'react';
import { Link, Navigate } from 'react-router-dom';

import { usePlayground } from '../../../../hooks/ai-console/usePlayground';
import { useAuth } from '../../../../lib/auth-store';

import { PlaygroundForm } from './PlaygroundForm';
import { PlaygroundTrace } from './PlaygroundTrace';

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

function PlaygroundBreadcrumb(): React.JSX.Element {
  return (
    <nav aria-label="Navegação de contexto" className="flex items-center gap-2">
      <Link
        to="/configuracoes"
        className="font-sans text-sm text-ink-3 hover:text-ink transition-colors duration-[150ms]"
      >
        Configurações
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
      <Link
        to="/configuracoes/ia/prompts"
        className="font-sans text-sm text-ink-3 hover:text-ink transition-colors duration-[150ms]"
      >
        Agente de IA
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
      <span className="font-sans text-sm font-medium text-ink">Playground</span>
    </nav>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Playground do agente de IA — execução isolada em modo DRY-RUN.
 *
 * Rules-of-Hooks: useAuth e usePlayground são chamados incondicionalmente,
 * ANTES do guard de permissão. A verificação de RBAC e o Navigate vêm depois.
 */
export function PlaygroundPage(): React.JSX.Element {
  // ── Hooks — TODOS antes de qualquer early-return ─────────────────────────────
  const { hasPermission } = useAuth();

  const { mutate, isPending, result, isError, errorMessage } = usePlayground();

  // Derivar permissão (não é um hook — pode ser antes do guard)
  const hasPlaygroundPermission = hasPermission('ai_playground:run');

  // ── RBAC guard — após todos os hooks ────────────────────────────────────────
  if (!hasPlaygroundPermission) {
    return <Navigate to="/404" replace />;
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* ── Breadcrumb ────────────────────────────────────────────────────── */}
      <PlaygroundBreadcrumb />

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <h1
          className="font-display font-bold text-ink"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.045em',
            lineHeight: '1',
            fontVariationSettings: "'opsz' 32",
          }}
        >
          Playground
        </h1>
        <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
          Teste o agente de IA em modo isolado. Nenhum dado é persistido e nenhuma mensagem é
          enviada ao cliente.
        </p>
      </div>

      {/* ── Layout 2 colunas ─────────────────────────────────────────────── */}
      {/* Mobile: empilhado (col). Desktop: 2 colunas lado a lado. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── Coluna esquerda: formulário ───────────────────────────────── */}
        <div
          className="rounded-lg border border-border overflow-hidden"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
          }}
        >
          {/* Header do painel */}
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border"
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
              <path d="M3 8h2l2-5 3 10 2-5h3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2
              className="font-sans font-semibold text-ink"
              style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
            >
              Configuração
            </h2>
          </div>

          {/* Corpo do formulário */}
          <div className="p-5">
            <PlaygroundForm onSubmit={mutate} isPending={isPending} />
          </div>
        </div>

        {/* ── Coluna direita: resultado ────────────────────────────────── */}
        <div
          className="rounded-lg border border-border overflow-hidden"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
          }}
        >
          {/* Header do painel */}
          <div
            className="flex items-center gap-2.5 px-5 py-4 border-b border-border"
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
              <circle cx="8" cy="8" r="6" />
              <path d="M6 8l2 2 3-3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <h2
              className="font-sans font-semibold text-ink"
              style={{ fontSize: 'var(--text-sm)', letterSpacing: '-0.01em' }}
            >
              Resultado
            </h2>
          </div>

          {/* Corpo do trace/resultado */}
          <div className="p-5">
            <PlaygroundTrace
              result={result}
              isPending={isPending}
              isError={isError}
              errorMessage={errorMessage}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
