import * as React from 'react';

import { cn } from '../../lib/cn';
import { formatBRL } from '../../lib/format/money';

import { Label } from './Label';

interface CurrencyInputProps {
  id: string;
  /** Valor em CENTAVOS inteiros (null = vazio). */
  value: number | null;
  /** Callback com o novo valor em CENTAVOS inteiros (null = vazio). */
  onChange: (cents: number | null) => void;
  label?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
  placeholder?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
  wrapperClassName?: string | undefined;
  name?: string | undefined;
  onBlur?: (() => void) | undefined;
}

/**
 * CurrencyInput — campo de moeda canônico (DS §9.2) — F13-S01/S02.
 *
 * Máscara estilo app de banco / PIX: o usuário digita e os dígitos ocupam as
 * casas decimais da direita para a esquerda. Internamente o valor é mantido em
 * CENTAVOS inteiros (decisão D5 — sem float).
 *
 * Ex.: digitar "1" → R$ 0,01 ; "100" → R$ 1,00 ; "1000000" → R$ 10.000,00.
 */
export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    {
      id,
      value,
      onChange,
      label,
      error,
      hint,
      placeholder,
      required,
      disabled,
      className,
      wrapperClassName,
      name,
      onBlur,
    },
    ref,
  ) {
    const hasError = Boolean(error);

    // Sempre formatado (estilo banco): o valor exibido é derivado dos centavos.
    const display = value !== null ? formatBRL(value) : '';

    function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
      const digits = e.target.value.replace(/\D/g, '');
      if (digits === '') {
        onChange(null);
        return;
      }
      // Os dígitos representam centavos (casas ocupam da direita).
      // parseInt evita estouro de precisão para valores realistas (<= 13 dígitos).
      onChange(Number.parseInt(digits, 10));
    }

    return (
      <div className={cn('flex flex-col gap-2', wrapperClassName)}>
        {label && (
          <Label htmlFor={id} {...(required === true ? { required: true } : {})}>
            {label}
          </Label>
        )}

        <input
          ref={ref}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={display}
          placeholder={placeholder ?? 'R$ 0,00'}
          required={required}
          disabled={disabled}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={hasError || undefined}
          onChange={handleChange}
          onBlur={onBlur}
          className={cn(
            'w-full font-sans text-sm font-medium text-ink',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'placeholder:text-ink-4',
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
        />

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
  },
);
