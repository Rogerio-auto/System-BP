// =============================================================================
// api-reference/ApiSidebar.tsx — Sidebar de recursos da API
//
// Lista as tags (recursos) do spec com contador de endpoints.
// Active state baseado na tag selecionada via URL.
// =============================================================================

import * as React from 'react';
import { Link } from 'react-router-dom';

import type { ResourceGroup } from './types';

interface ApiSidebarProps {
  resources: ResourceGroup[];
  activeTag: string | undefined;
}

export function ApiSidebar({ resources, activeTag }: ApiSidebarProps): React.JSX.Element {
  if (resources.length === 0) {
    return (
      <nav aria-label="Recursos da API">
        <p
          className="font-sans"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)', padding: '0.75rem 0' }}
        >
          Nenhum recurso disponível.
        </p>
      </nav>
    );
  }

  return (
    <nav aria-label="Recursos da API">
      <p
        className="font-sans font-semibold uppercase"
        style={{
          fontSize: '0.65rem',
          letterSpacing: '0.08em',
          color: 'var(--text-3)',
          marginBottom: '0.5rem',
          paddingLeft: '0.75rem',
        }}
      >
        Recursos
      </p>
      <ul role="list" className="flex flex-col gap-0.5">
        {resources.map((resource) => {
          const slug = resource.tag.toLowerCase().replace(/\s+/g, '-');
          const isActive =
            activeTag !== undefined && activeTag.toLowerCase() === resource.tag.toLowerCase();

          return (
            <li key={resource.tag}>
              <Link
                to={`/ajuda/api/${encodeURIComponent(slug)}`}
                aria-current={isActive ? 'page' : undefined}
                className="flex items-center justify-between rounded-sm px-3 py-1.5 transition-colors"
                style={{
                  fontSize: 'var(--text-sm)',
                  fontFamily: 'var(--font-sans)',
                  color: isActive ? 'var(--info)' : 'var(--text-2)',
                  background: isActive ? 'var(--info-bg)' : 'transparent',
                  textDecoration: 'none',
                  fontWeight: isActive ? 500 : 400,
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLAnchorElement).style.background =
                      'var(--surface-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                  }
                }}
              >
                <span>{resource.tag}</span>
                <span
                  className="font-mono tabular-nums"
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: isActive ? 'var(--info)' : 'var(--text-3)',
                    background: isActive ? 'transparent' : 'var(--surface-muted)',
                    borderRadius: '999px',
                    padding: '1px 6px',
                    minWidth: '1.5rem',
                    textAlign: 'center',
                  }}
                >
                  {resource.endpoints.length}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
