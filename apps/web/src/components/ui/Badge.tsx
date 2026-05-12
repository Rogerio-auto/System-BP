// =============================================================================
// components/ui/Badge.tsx — Badge pill canônico (DS §9.5).
//
// Variantes: success, warning, danger, info, neutral.
// Pill com bola colorida prefixada (glow via box-shadow).
// font-size: 0.7rem, font-weight: 700, tracking: 0.06em, uppercase.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

export type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const dotColors: Record<BadgeVariant, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  neutral: 'var(--text-3)',
};

const glowColors: Record<BadgeVariant, string> = {
  success: '0 0 4px var(--success)',
  warning: '0 0 4px var(--warning)',
  danger: '0 0 4px var(--danger)',
  info: '0 0 4px var(--info)',
  neutral: 'none',
};

const bgColors: Record<BadgeVariant, string> = {
  success: 'var(--success-bg)',
  warning: 'var(--warning-bg)',
  danger: 'var(--danger-bg)',
  info: 'var(--info-bg)',
  neutral: 'var(--surface-muted)',
};

const textColors: Record<BadgeVariant, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  neutral: 'var(--text-3)',
};

/**
 * Badge pill canônico (DS §9.5).
 * Dot colorido + glow + elev-1 + pill radius.
 */
export function Badge({ variant = 'neutral', children, className }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        'px-2.5 py-0.5',
        'rounded-pill',
        'font-sans font-bold uppercase',
        'whitespace-nowrap',
        className,
      )}
      style={{
        fontSize: '0.7rem',
        letterSpacing: '0.06em',
        background: bgColors[variant],
        color: textColors[variant],
        boxShadow: 'var(--elev-1)',
      }}
    >
      {/* Dot com glow da cor */}
      <span
        aria-hidden="true"
        className="shrink-0 rounded-pill"
        style={{
          width: 6,
          height: 6,
          background: dotColors[variant],
          boxShadow: glowColors[variant],
        }}
      />
      {children}
    </span>
  );
}
