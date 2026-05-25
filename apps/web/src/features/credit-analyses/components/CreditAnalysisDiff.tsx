// =============================================================================
// features/credit-analyses/components/CreditAnalysisDiff.tsx
//
// Diff visual entre dois textos de parecer (versão N-1 vs N).
// Usa o pacote `diff` (já presente no projeto) — sem nova dependência.
//
// DS:
//   - Adições: fundo var(--success-bg), texto var(--success)
//   - Remoções: fundo var(--danger-bg), texto var(--danger), tachado
//   - Sem mudança: texto ink-2
//   - JetBrains Mono para o conteúdo (dados textuais formais)
//   - Fonte menor (0.8125rem) para legibilidade densa
// =============================================================================

import { diffWords } from 'diff';
import * as React from 'react';

interface CreditAnalysisDiffProps {
  /** Texto anterior (versão N-1). Se undefined, exibe o atual sem diff. */
  previous: string | undefined;
  /** Texto atual (versão N). */
  current: string;
  className?: string | undefined;
}

/**
 * Diff palavra-a-palavra entre dois pareceres.
 * Exibe o resultado com destaques coloridos por DS tokens.
 * Imutável — não edita in-place.
 */
export function CreditAnalysisDiff({
  previous,
  current,
  className,
}: CreditAnalysisDiffProps): React.JSX.Element {
  const parts = React.useMemo(() => {
    if (!previous) return null;
    return diffWords(previous, current);
  }, [previous, current]);

  if (!parts) {
    // Sem versão anterior — exibe o texto completo sem diff
    return (
      <pre
        className={className}
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
        {current}
      </pre>
    );
  }

  return (
    <pre
      className={className}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8125rem',
        lineHeight: 1.65,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        margin: 0,
      }}
      aria-label="Diferenças entre versões do parecer"
    >
      {parts.map((part, idx) => {
        if (part.added) {
          return (
            <mark
              key={idx}
              style={{
                background: 'var(--success-bg)',
                color: 'var(--success)',
                borderRadius: 2,
                padding: '0 2px',
              }}
            >
              {part.value}
            </mark>
          );
        }
        if (part.removed) {
          return (
            <del
              key={idx}
              style={{
                background: 'var(--danger-bg)',
                color: 'var(--danger)',
                borderRadius: 2,
                padding: '0 2px',
                textDecoration: 'line-through',
              }}
            >
              {part.value}
            </del>
          );
        }
        return (
          <span key={idx} style={{ color: 'var(--text-2)' }}>
            {part.value}
          </span>
        );
      })}
    </pre>
  );
}
