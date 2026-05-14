// =============================================================================
// features/simulator/ProductSelect.tsx — Select de produto de crédito (F2-S06).
//
// Consome useProducts() (GET /api/credit-products).
// Mostra nome + faixa de valor/prazo da regra ativa em caption discreto.
// DS: Select §9.2 — inset shadow, foco azul, erro danger.
// =============================================================================

import * as React from 'react';

import type { CreditProduct } from '../../hooks/simulator/types';
import { formatBRL } from '../../hooks/simulator/types';
import { useProducts } from '../../hooks/simulator/useProducts';
import { cn } from '../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ProductSelectProps {
  value: string;
  onChange: (productId: string, product: CreditProduct | null) => void;
  error?: string | undefined;
  disabled?: boolean;
}

// ─── Formatadores de caption ─────────────────────────────────────────────────

function buildCaption(product: CreditProduct): string {
  const rule = product.active_rule;
  if (!rule) return 'Sem regra ativa';

  const minVal = formatBRL(rule.min_amount);
  const maxVal = formatBRL(rule.max_amount);
  const minTerm = rule.min_term_months;
  const maxTerm = rule.max_term_months;

  return `${minVal} – ${maxVal} · ${minTerm}–${maxTerm} meses`;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Select de produto de crédito com caption da regra ativa.
 */
export function ProductSelect({
  value,
  onChange,
  error,
  disabled,
}: ProductSelectProps): React.JSX.Element {
  const { products, isLoading } = useProducts();
  const hasError = Boolean(error);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    const product = products.find((p) => p.id === id) ?? null;
    onChange(id, product);
  }

  const selectedProduct = products.find((p) => p.id === value) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="product-select"
        className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-3"
      >
        Produto de Crédito
        <span className="ml-1 text-danger" aria-hidden="true">
          *
        </span>
      </label>

      <div className="relative">
        <select
          id="product-select"
          disabled={disabled || isLoading}
          value={value}
          onChange={handleChange}
          aria-describedby={hasError ? 'product-error' : 'product-hint'}
          aria-invalid={hasError || undefined}
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
            hasError &&
              'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          <option value="" disabled>
            {isLoading ? 'Carregando produtos…' : 'Selecione um produto'}
          </option>
          {products.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.active_rule}>
              {p.name}
              {!p.active_rule ? ' (sem regra ativa)' : ''}
            </option>
          ))}
        </select>

        {/* Chevron */}
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

      {/* Caption da regra ativa — aparece quando há produto selecionado */}
      {selectedProduct && !hasError && (
        <p id="product-hint" className="font-sans text-xs text-ink-3">
          {buildCaption(selectedProduct)}
        </p>
      )}

      {hasError && (
        <span id="product-error" role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
