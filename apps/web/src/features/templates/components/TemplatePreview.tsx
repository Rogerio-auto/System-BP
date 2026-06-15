// =============================================================================
// features/templates/components/TemplatePreview.tsx
//
// Preview visual do template com variáveis de exemplo substituídas.
// F5-S15: Reflete header (texto/documento/imagem) acima do body.
// Destaca {{N}} em azul. DS: elev-1, tokens canônicos.
// =============================================================================
import * as React from 'react';

import type { TemplateHeaderType } from '../schemas';

interface TemplatePreviewProps {
  body: string;
  /** Nomes semânticos das variáveis em ordem posicional. */
  variables: string[];
  /** F5-S15 — tipo do cabeçalho. */
  headerType?: TemplateHeaderType;
  /** F5-S15 — texto do cabeçalho quando headerType='text'. */
  headerText?: string;
}

/**
 * Substitui {{N}} pelo nome semântico ou por um placeholder de exemplo.
 * Retorna array de React nodes com as partes coloridas.
 */
function renderBodyWithHighlights(body: string, variables: string[]): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = /\{\{(\d+)\}\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body)) !== null) {
    const [fullMatch, indexStr] = match;
    const varIndex = parseInt(indexStr ?? '1', 10) - 1;
    const varName = variables[varIndex] ?? `variável_${varIndex + 1}`;

    // Texto antes do match
    if (match.index > lastIndex) {
      parts.push(body.slice(lastIndex, match.index));
    }

    // Variável destacada
    parts.push(
      <span
        key={`var-${match.index}`}
        className="inline-flex items-center px-1 rounded"
        style={{
          background: 'rgba(27,58,140,0.1)',
          color: 'var(--brand-azul)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.85em',
          fontWeight: 600,
        }}
        title={fullMatch}
      >
        {varName}
      </span>,
    );

    lastIndex = match.index + fullMatch.length;
  }

  // Resto do texto
  if (lastIndex < body.length) {
    parts.push(body.slice(lastIndex));
  }

  return parts;
}

export function TemplatePreview({
  body,
  variables,
  headerType = 'none',
  headerText,
}: TemplatePreviewProps): React.JSX.Element {
  return (
    <div
      className="rounded-md p-4 border"
      style={{
        background: 'var(--bg-elev-2)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--elev-1)',
      }}
      aria-label="Preview do template"
    >
      <p
        className="font-sans text-xs font-semibold uppercase tracking-widest mb-2"
        style={{ color: 'var(--text-3)', letterSpacing: '0.1em' }}
      >
        Preview
      </p>

      {/* F5-S15 — Header do template */}
      {headerType !== 'none' && (
        <div className="mb-3 pb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {headerType === 'text' && headerText && (
            <p
              className="font-sans font-bold"
              style={{ fontSize: 'var(--text-base)', color: 'var(--text)' }}
            >
              {headerText}
            </p>
          )}
          {headerType === 'document' && (
            <div
              className="inline-flex items-center gap-2 px-2 py-1 rounded"
              style={{ background: 'rgba(27,58,140,0.1)', color: 'var(--brand-azul)' }}
            >
              <span>📎</span>
              <span className="font-sans text-xs font-semibold">Documento (PDF)</span>
            </div>
          )}
          {headerType === 'image' && (
            <div
              className="inline-flex items-center gap-2 px-2 py-1 rounded"
              style={{ background: 'rgba(46,155,62,0.1)', color: 'var(--brand-verde)' }}
            >
              <span>🖼</span>
              <span className="font-sans text-xs font-semibold">Imagem</span>
            </div>
          )}
        </div>
      )}

      <p
        className="font-sans leading-relaxed whitespace-pre-wrap break-words"
        style={{ color: 'var(--text)', fontSize: 'var(--text-sm)' }}
      >
        {body ? (
          renderBodyWithHighlights(body, variables)
        ) : (
          <span style={{ color: 'var(--text-4)' }}>
            O preview aparecerá aqui conforme você digita o corpo do template.
          </span>
        )}
      </p>
    </div>
  );
}
