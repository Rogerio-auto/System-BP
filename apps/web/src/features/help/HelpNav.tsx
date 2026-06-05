import * as React from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { cn } from '../../lib/cn';

import type { HelpManifest } from './manifest';

interface HelpNavProps {
  manifest: HelpManifest;
}

export function HelpNav({ manifest }: HelpNavProps): React.JSX.Element {
  const location = useLocation();
  const isHome = location.pathname === '/ajuda' || location.pathname === '/ajuda/';

  return (
    <nav aria-label="Navegação da Central de Ajuda" className="flex flex-col gap-6 py-4 pr-4">
      {/* Home link */}
      <NavLink
        to="/ajuda"
        end
        className={cn(
          'font-sans text-sm rounded-sm px-3 py-2 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        )}
        style={
          isHome
            ? {
                background: 'rgba(27,58,140,0.08)',
                color: 'var(--brand-azul)',
                fontWeight: 600,
              }
            : { color: 'var(--text-2)' }
        }
      >
        {manifest.home?.title ?? 'Início'}
      </NavLink>

      {/* Seções */}
      {manifest.sections.map((section) => (
        <div key={section.slug} className="flex flex-col gap-1">
          <h3
            className="font-sans font-semibold uppercase px-3"
            style={{
              fontSize: '0.6875rem',
              letterSpacing: '0.08em',
              color: 'var(--text-3)',
              marginBottom: '0.25rem',
            }}
          >
            {section.title}
          </h3>
          <ul className="flex flex-col">
            {section.articles.map((article) => (
              <li key={article.slug}>
                <NavLink
                  to={`/ajuda/${article.slug}`}
                  className={({ isActive }) =>
                    cn(
                      'block font-sans text-sm rounded-sm px-3 py-1.5 transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
                      isActive ? 'font-semibold' : '',
                    )
                  }
                  style={({ isActive }) =>
                    isActive
                      ? { background: 'rgba(27,58,140,0.08)', color: 'var(--brand-azul)' }
                      : { color: 'var(--text-2)' }
                  }
                >
                  {article.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
