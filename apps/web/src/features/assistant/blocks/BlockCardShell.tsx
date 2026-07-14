// =============================================================================
// features/assistant/blocks/BlockCardShell.tsx — Chrome canônico dos cards de
// bloco do copiloto interno (F6-S22): DS §9.3 (Card) + hover Spotlight+Lift
// (DS §6 — halo verde segue cursor via --mx/--my), mesma implementação de
// components/ui/Stat.tsx.
// =============================================================================

import * as React from 'react';

import type { BadgeVariant } from '../../../components/ui/Badge';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../lib/cn';

import { BLOCK_VARIANT_COLOR } from './variantColors';

interface BlockCardShellProps {
  icon: React.ReactNode;
  title: string;
  variant: BadgeVariant;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Chrome comum a todos os cards de bloco: ícone de estado (44×44), título,
 * subtítulo/badge opcionais + corpo livre. Card (DS §9.3): bg-elev-1,
 * border, elev-2, hover Spotlight (verde) + Lift (elev-4 + borda forte).
 */
export function BlockCardShell({
  icon,
  title,
  variant,
  subtitle,
  badge,
  children,
  className,
}: BlockCardShellProps): React.JSX.Element {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const accentColor = BLOCK_VARIANT_COLOR[variant];

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
        'relative overflow-hidden w-full',
        'rounded-md border border-border',
        'bg-surface-1 p-4',
        'transition-[transform,box-shadow,border-color] duration-[250ms] ease-out',
        'hover:-translate-y-[3px] hover:border-border-strong',
        'shadow-e2 hover:shadow-e4',
        '[--mx:-9999px] [--my:-9999px]',
        className,
      )}
    >
      {/* Spotlight radial verde segue cursor (DS §6) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-md transition-opacity duration-slow"
        style={{
          background:
            'radial-gradient(360px circle at var(--mx) var(--my), rgba(46,155,62,0.06), transparent 60%)',
        }}
      />

      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="inline-flex items-center justify-center shrink-0"
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius-md)',
                background: `color-mix(in srgb, ${accentColor} 12%, transparent)`,
                color: accentColor,
                boxShadow: 'var(--elev-1)',
              }}
            >
              {icon}
            </span>
            <div className="min-w-0">
              <h4
                className="font-display font-bold text-ink text-base leading-tight truncate"
                style={{ letterSpacing: '-0.024em' }}
              >
                {title}
              </h4>
              {subtitle && (
                <p className="font-sans text-xs text-ink-3 mt-0.5 truncate">{subtitle}</p>
              )}
            </div>
          </div>
          {badge && (
            <Badge variant={variant} className="shrink-0">
              {badge}
            </Badge>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}
