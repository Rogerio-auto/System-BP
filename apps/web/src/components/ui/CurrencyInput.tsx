// =============================================================================
// components/ui/CurrencyInput.tsx — Campo de moeda canônico (DS §9.2) — F18-S03.
//
// Representação interna: REAIS como number (float, 2 casas — decisão D5 revisada).
// Exibição: formatBRL(reais) via Intl.NumberFormat('pt-BR').
//
// Comportamento:
//   - onChange: formata AO VIVO com separador de milhar e decimais (live mask).
//               cursor é reposicionado após reformatação via useLayoutEffect.
//   - onFocus:  mostra valor com live mask (sem "R$") para edição fácil.
//   - onBlur:   formata com máscara completa "R$ x.xxx,xx".
//
// Props: value em REAIS (number | null), onChange(reais: number | null).
// Formulários NÃO devem converter para centavos — o CurrencyInput é a borda.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';
import { formatBRL, formatLiveMask, parseBRLInput } from '../../lib/format/money';

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

// ─── Cursor — helpers puros ───────────────────────────────────────────────────

/**
 * Calcula a posição do cursor no texto formatado correspondente a `digitsNeeded`
 * dígitos contados da esquerda. Se `afterComma` é true, o cursor deve estar após
 * a vírgula (parte decimal).
 *
 * Estratégia: conta dígitos em `formatted`, inserindo o cursor logo após o
 * N-ésimo dígito encontrado — pulando separadores de milhar (".").
 * Quando `afterComma`, aguarda a vírgula aparecer antes de concluir a contagem.
 */
function findNewCursorPos(formatted: string, digitsNeeded: number, afterComma: boolean): number {
  let digitCount = 0;
  let commaFound = false;
  // for...of sobre string usa o iterator protocol — cada ch é garantidamente string
  // (não sofre com noUncheckedIndexedAccess, ao contrário de formatted[i]).
  let i = 0;

  for (const ch of formatted) {
    if (ch === ',') {
      commaFound = true;
      // Cursor logo após a vírgula quando já contamos todos os dígitos inteiros
      if (afterComma && digitCount === digitsNeeded) {
        return i + 1;
      }
    } else if (/\d/.test(ch)) {
      digitCount++;
      // Sem vírgula: cursor depois do N-ésimo dígito
      if (!afterComma && digitCount === digitsNeeded) {
        return i + 1;
      }
      // Com vírgula e já passamos por ela: cursor depois do N-ésimo dígito total
      if (afterComma && commaFound && digitCount === digitsNeeded) {
        return i + 1;
      }
    }
    i++;
  }

  return formatted.length;
}

// ─── Componente ───────────────────────────────────────────────────────────────

/**
 * CurrencyInput — campo de moeda canônico (DS §9.2).
 *
 * Recebe e emite valores em REAIS (não centavos).
 * Digitar "10000" → exibe "10.000" ao vivo → ao sair do foco: "R$ 10.000,00".
 * Propaga: onChange(10000).
 *
 * Uso:
 *   <CurrencyInput
 *     id="amount"
 *     label="Valor"
 *     value={amount}                    // number | null em REAIS
 *     onChange={(v) => setAmount(v)}    // v em REAIS
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
    // Quando em foco: texto com live mask (ex: "5.000,50"), sem "R$".
    // Quando fora de foco: formatado com R$ e separadores completos.
    const [focused, setFocused] = React.useState(false);
    const [editText, setEditText] = React.useState<string>('');

    // Ref interno para controlar cursor após reformatação.
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    // Posição de cursor pendente — aplicada em useLayoutEffect após re-render,
    // garantindo que o DOM já reflete o novo value antes de mover o cursor.
    const pendingCursorRef = React.useRef<number | null>(null);

    // Merged ref: atualiza inputRef interno E o ref externo (forwardRef).
    // O cast é o padrão canônico para diferenciar RefCallback de RefObject
    // em runtime; não existe API sem cast no React 18 para este cenário.
    const mergedRef = React.useCallback(
      (node: HTMLInputElement | null) => {
        inputRef.current = node;
        if (typeof ref === 'function') {
          (ref as (n: HTMLInputElement | null) => void)(node);
        } else if (ref !== null && ref !== undefined) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
      },
      [ref],
    );

    // Aplica o cursor pendente após cada render (useLayoutEffect = antes do paint).
    // O null-check torna o efeito no-op na grande maioria dos renders.
    React.useLayoutEffect(() => {
      if (pendingCursorRef.current !== null && inputRef.current) {
        const pos = pendingCursorRef.current;
        pendingCursorRef.current = null;
        inputRef.current.setSelectionRange(pos, pos);
      }
    });

    // displayValue: live mask quando focado, BRL completo quando fora de foco.
    const displayValue = React.useMemo(() => {
      if (focused) return editText;
      if (value === null || value === undefined) return '';
      return formatBRL(value);
    }, [focused, value, editText]);

    function handleFocus(): void {
      // Ao entrar em foco, converte para live mask (sem "R$") para edição fácil.
      if (value !== null && value !== undefined) {
        const cents = Math.round(value * 100);
        const reais = cents / 100;
        const raw = Number.isInteger(reais) ? String(reais) : reais.toFixed(2).replace('.', ',');
        setEditText(formatLiveMask(raw));
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
      const cursorPos = e.target.selectionStart ?? raw.length;

      // Conta dígitos e presença de vírgula à esquerda do cursor no texto bruto
      // para poder reposicionar o cursor após a reformatação.
      const rawBeforeCursor = raw.slice(0, cursorPos);
      const digitsBeforeCursor = (rawBeforeCursor.match(/\d/g) ?? []).length;
      const hasCommaBeforeCursor = rawBeforeCursor.includes(',');

      const masked = formatLiveMask(raw);
      setEditText(masked);

      // Agenda reposicionamento — será aplicado pelo useLayoutEffect após render.
      pendingCursorRef.current = findNewCursorPos(masked, digitsBeforeCursor, hasCommaBeforeCursor);

      onChange(parseBRLInput(masked));
    }

    return (
      <div className={cn('flex flex-col gap-2', wrapperClassName)}>
        {label && (
          <Label htmlFor={id} {...(required === true ? { required: true } : {})}>
            {label}
          </Label>
        )}

        <input
          ref={mergedRef}
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
