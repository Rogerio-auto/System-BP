// =============================================================================
// features/dashboard/components/StaleBanner.tsx — Banner colapsável para
// leads stale (sem interação há > 7 dias).
//
// DS §9.6 Alert: border-left 3px na cor estado + fundo warning-bg.
// Só renderiza quando staleCount > 0.
// Link aponta para /crm?stale=true (filtro a ser implementado em slot futuro).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

interface StaleBannerProps {
  staleCount: number;
  className?: string;
}

/**
 * Banner colapsável de leads stale.
 * Renderiza apenas quando staleCount > 0.
 * DS §9.6 Alert — border-left warning + warning-bg.
 */
export function StaleBanner({ staleCount, className }: StaleBannerProps): React.JSX.Element | null {
  const [dismissed, setDismissed] = React.useState(false);

  if (staleCount === 0 || dismissed) return null;

  return (
    <div
      role="alert"
      className={cn(
        'flex items-center justify-between gap-4',
        'rounded-md px-4 py-3',
        'text-sm',
        className,
      )}
      style={{
        borderLeft: '3px solid var(--warning)',
        background: 'var(--warning-bg)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Ícone alerta */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--warning)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>

        <span className="font-sans" style={{ color: 'var(--text-2)' }}>
          <span className="font-semibold" style={{ color: 'var(--text)' }}>
            {staleCount} {staleCount === 1 ? 'lead' : 'leads'}
          </span>{' '}
          sem interação há mais de 7 dias.{' '}
          <a
            href="/crm?stale=true"
            className="font-semibold underline underline-offset-2 transition-opacity duration-fast hover:opacity-70 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={{ color: 'var(--warning)', ['--tw-ring-color' as string]: 'var(--warning)' }}
          >
            Ver →
          </a>
        </span>
      </div>

      {/* Botão fechar */}
      <button
        type="button"
        aria-label="Dispensar aviso"
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-xs p-1 transition-opacity duration-fast hover:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
        style={{ color: 'var(--text-3)', ['--tw-ring-color' as string]: 'var(--warning)' }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
