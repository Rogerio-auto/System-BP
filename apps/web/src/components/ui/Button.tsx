import * as React from 'react';

import { cn } from '../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ButtonVariant =
  | 'primary'    // bg: --grad-azul, hover: lift + glow-azul
  | 'secondary'  // bg: --grad-verde, hover: lift + glow-verde
  | 'accent'     // bg: --grad-amarelo, texto azul-deep
  | 'outline'    // fundo surface-1, borda strong
  | 'ghost'      // transparente, hover bg surface-hover
  | 'danger';    // bg: --danger

type ButtonSize = 'sm' | 'default' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ícone à esquerda do texto — SVG com 16x16 */
  leftIcon?: React.ReactNode;
  /** Ícone à direita do texto */
  rightIcon?: React.ReactNode;
}

// ─── Classes por variante (DS §9.1 + hover patterns §8) ───────────────────────

const variantClasses: Record<ButtonVariant, string> = {
  primary: cn(
    // bg: --grad-azul, inset highlight de superfície
    '[background:var(--grad-azul)] text-[var(--text-on-brand)]',
    '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
    // Hover: Lift + Glow (DS §8 padrão Glow)
    'hover:-translate-y-0.5',
    'hover:[box-shadow:var(--glow-azul),inset_0_1px_0_rgba(255,255,255,0.2)]',
    // Active: depressão
    'active:translate-y-0',
    'active:[box-shadow:var(--elev-1),inset_0_2px_4px_rgba(0,0,0,0.2)]',
  ),
  secondary: cn(
    '[background:var(--grad-verde)] text-[var(--text-on-brand)]',
    '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
    'hover:-translate-y-0.5',
    'hover:[box-shadow:var(--glow-verde),inset_0_1px_0_rgba(255,255,255,0.2)]',
    'active:translate-y-0',
    'active:[box-shadow:var(--elev-1),inset_0_2px_4px_rgba(0,0,0,0.2)]',
  ),
  accent: cn(
    '[background:var(--grad-amarelo)] text-azul-deep',
    '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.3)]',
    'hover:-translate-y-0.5',
    'hover:[box-shadow:var(--glow-amarelo),inset_0_1px_0_rgba(255,255,255,0.4)]',
    'active:translate-y-0',
    'active:[box-shadow:var(--elev-1),inset_0_2px_4px_rgba(0,0,0,0.15)]',
  ),
  outline: cn(
    'bg-surface-1 text-ink border border-border-strong shadow-e1',
    'hover:border-azul hover:text-azul hover:shadow-e2 hover:-translate-y-px',
    'active:translate-y-0 active:shadow-e1',
  ),
  ghost: cn(
    'bg-transparent text-ink-2',
    'hover:bg-surface-hover hover:text-ink',
    'active:bg-surface-muted',
  ),
  danger: cn(
    'bg-danger text-white',
    '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
    'hover:-translate-y-0.5',
    'hover:[box-shadow:0_0_0_1px_rgba(200,52,31,0.2),0_8px_24px_rgba(200,52,31,0.3)]',
    'active:translate-y-0 active:shadow-e1',
  ),
};

const sizeClasses: Record<ButtonSize, string> = {
  sm:      'px-[14px] py-2 text-xs',
  default: 'px-[22px] py-3 text-sm',   // 12px 22px conforme DS §9.1
  lg:      'px-7 py-4 text-base',      // 16px 28px
};

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Botão canônico do DS (§9.1).
 * Todos os 4 estados: repouso, hover (lift+glow), active (depressão), disabled.
 * Área clicável mínima garantida via min-h-[40px] (WCAG 2.5.5).
 */
export function Button({
  variant = 'primary',
  size = 'default',
  className,
  children,
  leftIcon,
  rightIcon,
  disabled,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        // Base comum a todas variantes
        'inline-flex items-center justify-center gap-2',
        'font-sans font-semibold tracking-[-0.005em]',
        'rounded-sm border-none cursor-pointer',
        'relative',
        'min-h-[40px]', // WCAG área clicável mínima
        // Transições — conforme DS §8 (dur-fast, ease)
        'transition-[transform,box-shadow,background,border-color,color]',
        'duration-fast ease',
        // Disabled
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
        // Variante e tamanho
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {leftIcon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {leftIcon}
        </span>
      )}
      {children}
      {rightIcon && (
        <span className="inline-flex shrink-0" aria-hidden="true">
          {rightIcon}
        </span>
      )}
    </button>
  );
}
