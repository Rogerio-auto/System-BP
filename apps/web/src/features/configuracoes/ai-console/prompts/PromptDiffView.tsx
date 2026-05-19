// =============================================================================
// features/configuracoes/ai-console/prompts/PromptDiffView.tsx
//
// Visualização de diff entre duas versões de prompt.
//
// Usa lib `diff` (npm: diff@9, ~25kB gzip) — escolhida por ser a menor
// implementação de diff estável disponível; não requer componente externo
// com markup proprietário. Render puro com spans coloridos, 100% controlado.
//
// Justificativa da dep `diff`:
//   - Menor bundle que react-diff-viewer-continued (~200kB) ou jsdiff-react.
//   - API simples: diffLines() retorna Change[] com added/removed/count.
//   - Sem markup proprietário — o layout e as cores são do nosso DS.
//   - Auditada pelo npm, sem vulnerabilidades conhecidas.
//
// LGPD: diff é exibido na UI mas nunca enviado para telemetria/console.
// =============================================================================

import * as Diff from 'diff';
import * as React from 'react';

import { type PromptVersion } from '../../../../hooks/ai-console/usePrompts';
import { cn } from '../../../../lib/cn';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface DiffLineProps {
  type: 'added' | 'removed' | 'unchanged';
  lineNumber?: number;
  children: React.ReactNode;
}

function DiffLine({ type, lineNumber, children }: DiffLineProps): React.JSX.Element {
  const bgClass =
    type === 'added'
      ? 'bg-[var(--success-bg)] text-[var(--success)]'
      : type === 'removed'
        ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
        : 'text-ink';

  const prefix = type === 'added' ? '+' : type === 'removed' ? '-' : ' ';

  return (
    <div
      className={cn('flex gap-0 font-mono text-xs leading-5 min-w-0', bgClass)}
      aria-label={
        type === 'added' ? 'Linha adicionada' : type === 'removed' ? 'Linha removida' : undefined
      }
    >
      {/* Número de linha */}
      <span
        className="shrink-0 select-none pr-3 pl-3 text-ink-4 text-right tabular-nums"
        style={{ minWidth: '3rem', borderRight: '1px solid var(--border-subtle)' }}
        aria-hidden="true"
      >
        {lineNumber ?? ''}
      </span>
      {/* Prefixo +/- */}
      <span className="shrink-0 select-none px-2 font-bold" aria-hidden="true">
        {prefix}
      </span>
      {/* Conteúdo */}
      <span className="flex-1 pr-4 whitespace-pre-wrap break-all">{children}</span>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface PromptDiffViewProps {
  /** Versão "de" (esquerda / mais antiga / base) */
  from: PromptVersion;
  /** Versão "para" (direita / mais nova / nova) */
  to: PromptVersion;
  className?: string;
}

/**
 * Diff linha a linha entre duas versões de prompt.
 * Usa Diff.diffLines (lib `diff`) — output é lista de Change com count de linhas.
 */
export function PromptDiffView({ from, to, className }: PromptDiffViewProps): React.JSX.Element {
  const changes = React.useMemo(
    () => Diff.diffLines(from.body, to.body, { newlineIsToken: false }),
    [from.body, to.body],
  );

  // Conta adições/remoções para o resumo
  const stats = React.useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const change of changes) {
      const count = change.count ?? 0;
      if (change.added) added += count;
      else if (change.removed) removed += count;
    }
    return { added, removed };
  }, [changes]);

  const isIdentical = stats.added === 0 && stats.removed === 0;

  // Renderiza linhas com numeração contínua por versão
  const lines: React.ReactNode[] = [];
  let lineNumFrom = 1;
  let lineNumTo = 1;

  for (const change of changes) {
    const rawLines = (change.value ?? '').split('\n');
    // split('\n') adiciona string vazia no final quando value termina com \n
    const lineList = rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;

    if (change.removed) {
      for (const line of lineList) {
        lines.push(
          <DiffLine key={`r-${lineNumFrom}`} type="removed" lineNumber={lineNumFrom}>
            {line}
          </DiffLine>,
        );
        lineNumFrom++;
      }
    } else if (change.added) {
      for (const line of lineList) {
        lines.push(
          <DiffLine key={`a-${lineNumTo}`} type="added" lineNumber={lineNumTo}>
            {line}
          </DiffLine>,
        );
        lineNumTo++;
      }
    } else {
      for (const line of lineList) {
        lines.push(
          <DiffLine key={`u-${lineNumFrom}-${lineNumTo}`} type="unchanged">
            {line}
          </DiffLine>,
        );
        lineNumFrom++;
        lineNumTo++;
      }
    }
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {/* ── Header diff ──────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0"
        style={{ background: 'var(--bg-elev-2)' }}
      >
        <div className="flex items-center gap-2 font-mono text-xs text-ink-3">
          <span>v{from.version}</span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-3.5 h-3.5 text-ink-4"
            aria-hidden="true"
          >
            <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>v{to.version}</span>
        </div>
        {!isIdentical && (
          <div className="flex items-center gap-3 font-mono text-xs">
            <span className="text-[var(--success)]">+{stats.added}</span>
            <span className="text-[var(--danger)]">-{stats.removed}</span>
          </div>
        )}
      </div>

      {/* ── Corpo do diff ────────────────────────────────────────────── */}
      {isIdentical ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-ink-3">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            className="w-8 h-8"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="font-sans text-sm">As versões são idênticas.</p>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto"
          style={{ background: 'var(--bg-elev-1)' }}
          role="region"
          aria-label={`Diff entre v${from.version} e v${to.version}`}
        >
          {lines}
        </div>
      )}
    </div>
  );
}
