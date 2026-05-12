// =============================================================================
// components/ui/Avatar.tsx — Avatar circular canônico (DS §9.10).
//
// Fundo: --grad-rondonia (padrão) ou variantes variant-verde/amarelo/azul.
// Iniciais em Geist 700, text-xs, tracking -0.02em.
// Inset highlight superior + shadow-e2.
// NUNCA background sólido — sempre gradient.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

export type AvatarVariant = 'rondonia' | 'azul' | 'verde' | 'amarelo';

interface AvatarProps {
  name: string;
  variant?: AvatarVariant;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const gradients: Record<AvatarVariant, string> = {
  rondonia: 'var(--grad-rondonia)',
  azul: 'var(--grad-azul)',
  verde: 'var(--grad-verde)',
  amarelo: 'var(--grad-amarelo)',
};

const textColors: Record<AvatarVariant, string> = {
  rondonia: 'var(--brand-branco)',
  azul: 'var(--brand-branco)',
  verde: 'var(--brand-branco)',
  amarelo: 'var(--brand-azul-deep)',
};

const sizes = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-11 h-11 text-sm',
};

/**
 * Extrai iniciais de um nome: "Ana Paula" → "AP"
 */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? '?').toUpperCase();
  return `${parts[0]?.[0] ?? ''}${parts[parts.length - 1]?.[0] ?? ''}`.toUpperCase();
}

/**
 * Avatar circular canônico (DS §9.10).
 * Background: gradient (nunca sólido).
 * Iniciais em Geist 700.
 */
export function Avatar({
  name,
  variant = 'rondonia',
  size = 'md',
  className,
}: AvatarProps): React.JSX.Element {
  const initials = getInitials(name);

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        'rounded-pill select-none',
        'font-sans font-bold',
        sizes[size],
        className,
      )}
      style={{
        background: gradients[variant],
        color: textColors[variant],
        letterSpacing: '-0.02em',
        // Inset highlight superior + shadow-e2 (DS §9.10)
        boxShadow: 'var(--elev-2), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}
    >
      {initials}
    </span>
  );
}
