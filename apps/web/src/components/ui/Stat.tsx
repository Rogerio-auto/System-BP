// =============================================================================
// components/ui/Stat.tsx — Card KPI canônico (DS §9.8).
//
// bg-elev-1, elev-2.
// Label uppercase tracking, valor em Bricolage 800 text-3xl.
// Trend pill: ↑/↓ X% em JetBrains Mono, bg estado.
// Decoração: radial gradient sutil top-right em verde 8%.
// Hover: Spotlight (halo verde segue cursor).
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

interface StatProps {
  label: string;
  value: string | number;
  trend?: {
    value: string; // ex: "+12%" ou "-3%"
    direction: 'up' | 'down' | 'neutral';
  };
  description?: string;
  className?: string;
}

const trendColors = {
  up: { bg: 'var(--success-bg)', color: 'var(--success)' },
  down: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
  neutral: { bg: 'var(--surface-muted)', color: 'var(--text-3)' },
};

/**
 * Stat/KPI canônico (DS §9.8).
 * Hover Spotlight: halo verde segue cursor via CSS custom props --mx/--my.
 */
export function Stat({
  label,
  value,
  trend,
  description,
  className,
}: StatProps): React.JSX.Element {
  const cardRef = React.useRef<HTMLDivElement>(null);

  // Spotlight: atualiza --mx/--my no hover (DS §8 — Spotlight pattern)
  const handleMouseMove = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  }, []);

  const handleMouseLeave = React.useCallback(() => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty('--mx', '-9999px');
    el.style.setProperty('--my', '-9999px');
  }, []);

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'relative overflow-hidden',
        'rounded-md border border-border',
        'bg-surface-1 p-5',
        'transition-[transform,box-shadow] duration-[250ms] ease-out',
        'hover:-translate-y-0.5',
        // Spotlight (via CSS vars --mx/--my)
        '[--mx:-9999px] [--my:-9999px]',
        className,
      )}
      style={{
        boxShadow: 'var(--elev-2)',
      }}
    >
      {/* Spotlight radial verde segue cursor */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md transition-opacity duration-slow"
        style={{
          background:
            'radial-gradient(400px circle at var(--mx) var(--my), rgba(46,155,62,0.06), transparent 60%)',
        }}
      />

      {/* Decoração: radial sutil verde top-right */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 right-0 w-24 h-24 rounded-full opacity-10"
        style={{
          background: 'radial-gradient(circle, var(--brand-verde) 0%, transparent 70%)',
          transform: 'translate(30%, -30%)',
        }}
      />

      {/* Conteúdo */}
      <div className="relative z-10 flex flex-col gap-2">
        {/* Label */}
        <p
          className="font-sans font-semibold uppercase text-ink-3"
          style={{ fontSize: '0.7rem', letterSpacing: '0.12em' }}
        >
          {label}
        </p>

        {/* Valor + trend */}
        <div className="flex items-baseline gap-3">
          <span
            className="font-display font-extrabold text-ink leading-none"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            {value}
          </span>

          {trend && (
            <span
              className="font-mono font-medium text-xs rounded-pill px-2 py-0.5"
              style={{
                fontFamily: 'var(--font-mono)',
                background: trendColors[trend.direction].bg,
                color: trendColors[trend.direction].color,
                letterSpacing: '-0.01em',
              }}
            >
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : ''}
              {trend.value}
            </span>
          )}
        </div>

        {description && <p className="font-sans text-xs text-ink-3">{description}</p>}
      </div>
    </div>
  );
}
