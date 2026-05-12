import * as React from 'react';

import { cn } from '../../lib/cn';

import { Label } from './Label';

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  id: string;
  label?: string | undefined;
  /** Mensagem de erro — borda vira --danger + ring rosa */
  error?: string | undefined;
  /** Mensagem de ajuda abaixo do campo */
  hint?: string | undefined;
  /** Classe extra para o wrapper externo */
  wrapperClassName?: string | undefined;
}

/**
 * Input do DS (§9.2).
 * - Inset shadow interno (profundidade física, não "sticker")
 * - Foco: border --brand-azul + ring 3px rgba(27,58,140,0.15)
 * - Erro: border --danger + ring rosa
 * - Disabled: opacity 50%, cursor not-allowed
 * Sempre encapsula label semântica + campo + hint/error.
 */
export function Input({
  id,
  label,
  error,
  hint,
  required,
  className,
  wrapperClassName,
  ...props
}: InputProps): React.JSX.Element {
  const hasError = Boolean(error);

  return (
    <div className={cn('flex flex-col gap-2', wrapperClassName)}>
      {label && (
        <Label htmlFor={id} {...(required === true ? { required: true } : {})}>
          {label}
        </Label>
      )}

      <input
        id={id}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        aria-invalid={hasError || undefined}
        required={required}
        className={cn(
          // Base
          'w-full font-sans text-sm font-medium text-ink',
          'bg-surface-1 rounded-sm px-[14px] py-[11px]',
          // Borda e inset shadow (profundidade interna — §9.2)
          'border border-border-strong',
          'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
          // Transições suaves
          'transition-[border-color,box-shadow,background] duration-fast ease',
          // Placeholder
          'placeholder:text-ink-4',
          // Hover
          'hover:border-ink-3 hover:bg-surface-hover',
          // Foco — ring azul 3px (WCAG AA focus visible)
          'focus:outline-none focus:border-azul',
          'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
          'focus:bg-surface-1',
          // Erro
          hasError && [
            'border-danger',
            'focus:border-danger',
            'focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
          ],
          // Disabled
          'disabled:opacity-50 disabled:cursor-not-allowed',
          className,
        )}
        {...props}
      />

      {/* Mensagem de erro ou hint — nunca ambos ao mesmo tempo */}
      {hasError ? (
        <span id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="text-xs text-ink-3">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
