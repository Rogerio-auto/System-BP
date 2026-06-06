// =============================================================================
// api-reference/highlightPath.tsx â€” Destaca variÃ¡veis de path em React
//
// Parseia "/leads/:id/cards/:cardId" em segmentos React onde `:vars`
// recebem fundo `--info-bg`, fontFamily monospace e padding lateral.
// TambÃ©m suporta o estilo OpenAPI "{param}".
// =============================================================================

import * as React from 'react';

interface Segment {
  text: string;
  isVar: boolean;
}

/** Parseia um path OpenAPI em segmentos { text, isVar } */
export function parsePath(path: string): Segment[] {
  const segments: Segment[] = [];
  // Divide nos delimitadores : ou { } mantendo o texto entre eles
  const re = /(\{[^}]+\}|:[a-zA-Z_][a-zA-Z0-9_]*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(path)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: path.slice(lastIndex, match.index), isVar: false });
    }
    // Normaliza para :param (remove chaves se OpenAPI style)
    const raw = match[0];
    const name = raw.startsWith('{') ? `:${raw.slice(1, -1)}` : raw;
    segments.push({ text: name, isVar: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < path.length) {
    segments.push({ text: path.slice(lastIndex), isVar: false });
  }

  return segments;
}

interface HighlightedPathProps {
  path: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renderiza um path com variÃ¡veis destacadas.
 *
 * @example
 * <HighlightedPath path="/leads/:id/cards/:cardId" />
 */
export function HighlightedPath({
  path,
  className,
  style,
}: HighlightedPathProps): React.JSX.Element {
  const segments = parsePath(path);

  return (
    <span className={`font-mono ${className ?? ''}`} style={{ fontSize: 'inherit', ...style }}>
      {segments.map((seg, i) =>
        seg.isVar ? (
          <mark
            key={i}
            style={{
              background: 'var(--info-bg)',
              color: 'var(--info)',
              padding: '0 2px',
              borderRadius: '3px',
              fontFamily: 'inherit',
              fontStyle: 'normal',
            }}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </span>
  );
}
