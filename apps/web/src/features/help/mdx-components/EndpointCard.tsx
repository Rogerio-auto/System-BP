// =============================================================================
// mdx-components/EndpointCard.tsx — Card compacto de endpoint para uso em MDX
//
// Uso em .mdx:
//   <EndpointCard method="POST" path="/api/leads" summary="Criar lead" />
//
// Click navega para /ajuda/api/:resource#operationId correspondente.
// Cores de método seguem tokens DS (info/success/warning/danger).
// =============================================================================

import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { HighlightedPath } from '../api-reference/highlightPath';

export type HttpMethodType = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface EndpointCardProps {
  method: HttpMethodType;
  path: string;
  summary?: string;
  children?: React.ReactNode;
}

const METHOD_STYLE: Record<HttpMethodType, { bg: string; color: string }> = {
  GET: { bg: 'var(--info-bg)', color: 'var(--info)' },
  POST: { bg: 'var(--success-bg)', color: 'var(--success)' },
  PUT: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  PATCH: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
  DELETE: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
};

/**
 * Card compacto de endpoint para uso em qualquer .mdx da Central de Ajuda.
 * Click navega para a API Reference, exibindo o detalhe do endpoint.
 *
 * @example
 * <EndpointCard method="POST" path="/api/leads" summary="Criar lead" />
 */
export function EndpointCard({
  method,
  path,
  summary,
  children,
}: EndpointCardProps): React.JSX.Element {
  const navigate = useNavigate();
  const s = METHOD_STYLE[method];

  // Deriva a URL da API Reference a partir do primeiro segmento do path
  // Ex: /api/leads -> /ajuda/api/leads
  const resourceSlug = path
    .split('/')
    .filter(Boolean)
    .find((seg) => !seg.startsWith(':') && !seg.startsWith('{') && seg !== 'api');
  const href = resourceSlug ? `/ajuda/api/${encodeURIComponent(resourceSlug)}` : '/ajuda/api';

  function handleClick(e: React.MouseEvent<HTMLDivElement>): void {
    e.preventDefault();
    navigate(href);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate(href);
    }
  }

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`${method} ${path}${summary ? ` — ${summary}` : ''}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="flex items-start gap-3 rounded-md px-4 py-3 my-3"
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-1)',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        outline: 'none',
        textDecoration: 'none',
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = 'var(--elev-2)';
        el.style.borderColor = 'var(--border-strong)';
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.boxShadow = 'var(--elev-1)';
        el.style.borderColor = 'var(--border)';
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLDivElement).style.outline = '2px solid var(--info)';
        (e.currentTarget as HTMLDivElement).style.outlineOffset = '2px';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLDivElement).style.outline = 'none';
      }}
    >
      {/* Method badge */}
      <span
        className="font-mono font-bold uppercase shrink-0 mt-0.5"
        style={{
          background: s.bg,
          color: s.color,
          padding: '2px 8px',
          borderRadius: '4px',
          fontSize: '0.72rem',
          letterSpacing: '0.04em',
          lineHeight: 1.4,
          minWidth: '52px',
          textAlign: 'center',
        }}
      >
        {method}
      </span>

      {/* Path + summary */}
      <div className="flex flex-col gap-0.5 min-w-0">
        <HighlightedPath
          path={path}
          style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text)' }}
        />
        {(summary ?? children) && (
          <span
            className="font-sans"
            style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', lineHeight: 1.4 }}
          >
            {summary ?? children}
          </span>
        )}
      </div>
    </div>
  );
}
