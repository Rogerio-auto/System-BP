// =============================================================================
// components/ui/CurrencyInput.tsx — Campo de moeda canônico (DS §9.2) — F18-S03.
//
// Representação interna: REAIS como number (float, 2 casas — decisão D5 revisada).
// Exibição: formatBRL(reais) via Intl.NumberFormat('pt-BR').
//
// Comportamento:
//   - onFocus: exibe o valor editável sem máscara (ex: "10000" ou "10000,50").
//   - onChange: parseia o texto e propaga o valor em REAIS via callback.
//   - onBlur: formata o valor com máscara completa (ex: "R$ 10.000,00").
//
// Props: value em REAIS (number | null), onChange(reais: number | null).
// Formulários NÃO devem converter para centavos — o CurrencyInput é a borda.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';
import { formatBRL, parseBRLInput } from '../../lib/format/money';

import { Label } from './Label';

export interface CurrencyInputProps {
  id: string;
  /** Valor em REAIS (null = campo vazio). */
  value: number | null;
  /** Callback com o novo valor em REAIS (null = campo vazio/inválido). */
  onChange: (reais: number | null) => void;
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
 * CurrencyInput — campo de moeda canônico (DS §9.2).
 *
 * Recebe e emite valores em REAIS (não centavos).
 * Digitar "10000" → exibe "R$ 10.000,00" → propaga 10000 (reais).
 *
 * Uso:
 *   <CurrencyInput
 *     id="amount"
 *     label="Valor"
 *     value={amount}           // number | null em REAIS
 *     onChange={(v) => setAmount(v)}  // v em REAIS
 *   />
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
      onBlur: onBlurProp,
    },
    ref,
  ) {
    const hasError = Boolean(error);

    // Estado interno do texto exibido.
    // Quando em foco: texto bruto (editável, sem máscara).
    // Quando fora de foco: formatado com R$ e separadores.
    const [focused, setFocused] = React.useState(false);
    const [editText, setEditText] = React.useState<string>('');

    // Sincroniza o texto editável com o valor externo quando fora de foco.
    // Evita sobrescrever o que o usuário está digitando.
    const displayValue = React.useMemo(() => {
      if (focused) return editText;
      if (value === null || value === undefined) return '';
      return formatBRL(value);
    }, [focused, value, editText]);

    function handleFocus(): void {
      // Ao entrar em foco, mostra o valor sem formatação para edição fácil.
      if (value !== null && value !== undefined) {
        // Exibe inteiro sem casas se for número redondo, com vírgula se tiver centavos.
        const cents = Math.round(value * 100);
        const reais = cents / 100;
        const text = Number.isInteger(reais) ? String(reais) : reais.toFixed(2).replace('.', ',');
        setEditText(text);
      } else {
        setEditText('');
      }
      setFocused(true);
    }

    function handleBlur(): void {
      setFocused(false);
      onBlurProp?.();
    }

    function handleChange(e: React.ChangeEvent<HTMLInputElement>): void {
      const raw = e.target.value;
      setEditText(raw);
      const parsed = parseBRLInput(raw);
      onChange(parsed);
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
          inputMode="decimal"
          autoComplete="off"
          value={displayValue}
          placeholder={placeholder ?? 'R$ 0,00'}
          required={required}
          disabled={disabled}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          aria-invalid={hasError || undefined}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={handleChange}
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
