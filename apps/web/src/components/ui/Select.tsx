// =============================================================================
// components/ui/Select.tsx — Select nativo canônico (DS §9.2 — Input/Select).
//
// Mesmas regras do Input:
//   - border strong, inset shadow interno
//   - Foco: borda azul + ring
//   - Erro: borda danger + ring rosa
//   - Disabled: opacity 50%
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

import { Label } from './Label';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  id: string;
  label?: string;
  placeholder?: string;
  options: SelectOption[];
  error?: string | undefined;
  hint?: string | undefined;
  wrapperClassName?: string | undefined;
}

/**
 * Select nativo canônico (DS §9.2).
 * Mesmos estilos do Input — profundidade interna, foco azul, erro danger.
 * Suporta ref forwarding para integração com react-hook-form.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { id, label, placeholder, options, error, hint, required, className, wrapperClassName, ...props },
  ref,
) {
  const hasError = Boolean(error);

  return (
    <div className={cn('flex flex-col gap-2', wrapperClassName)}>
      {label && (
        <Label htmlFor={id} {...(required === true ? { required: true } : {})}>
          {label}
        </Label>
      )}

      <div className="relative">
        <select
          ref={ref}
          id={id}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={hasError || undefined}
          required={required}
          className={cn(
            'w-full appearance-none',
            'font-sans text-sm font-medium text-ink',
            'bg-surface-1 rounded-sm px-[14px] py-[11px] pr-9',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
            hasError && [
              'border-danger',
              'focus:border-danger',
              'focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            ],
            'disabled:opacity-50 disabled:cursor-not-allowed',
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Chevron decorativo */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-4 h-4"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </span>
      </div>

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
});
