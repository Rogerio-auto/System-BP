// =============================================================================
// features/simulator/SimulatorForm.tsx — Formulário de simulação (F2-S06).
//
// Layout: sticky na coluna esquerda (desktop). Mobile: empilha acima do resultado.
// Campos: lead (combobox), produto (select), valor (máscara BRL), prazo (meses).
// Validação live contra a regra ativa do produto selecionado.
// Submete SimulationBody para useSimulate (POST /api/simulations).
// DS: Input §9.2, Button §9.1, Card elev-2 para o wrapper.
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import type { LeadResponse } from '../../hooks/crm/types';
import type { CreditProduct, SimulatorFormValues } from '../../hooks/simulator/types';
import { formatBRL, maskBRL, parseBRL } from '../../hooks/simulator/types';
import type { SimulationError } from '../../hooks/simulator/useSimulate';
import { cn } from '../../lib/cn';

import { LeadCombobox } from './LeadCombobox';
import { ProductSelect } from './ProductSelect';

// ─── Validação Zod ────────────────────────────────────────────────────────────

/**
 * Schema de validação dinâmico — limites vêm da regra ativa do produto.
 * Criado via factory para aceitar os limites como parâmetro.
 */
function buildSchema(rule: CreditProduct['active_rule']) {
  return z.object({
    lead_id: z.string().min(1, 'Selecione um lead'),
    product_id: z.string().min(1, 'Selecione um produto'),
    amount_display: z
      .string()
      .min(1, 'Informe o valor solicitado')
      .refine(
        (v) => {
          if (!rule) return true;
          const cents = parseBRL(v);
          return cents >= rule.min_amount && cents <= rule.max_amount;
        },
        {
          message: rule
            ? `Valor deve estar entre ${formatBRL(rule.min_amount)} e ${formatBRL(rule.max_amount)}`
            : 'Valor inválido',
        },
      ),
    term_months: z
      .string()
      .min(1, 'Informe o prazo')
      .refine(
        (v) => {
          const n = parseInt(v, 10);
          if (!rule) return !isNaN(n) && n > 0;
          return !isNaN(n) && n >= rule.min_term_months && n <= rule.max_term_months;
        },
        {
          message: rule
            ? `Prazo deve estar entre ${rule.min_term_months} e ${rule.max_term_months} meses`
            : 'Prazo inválido',
        },
      ),
  });
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SimulatorFormProps {
  isPending: boolean;
  simulationError: SimulationError | null;
  onSubmit: (values: {
    lead_id: string;
    product_id: string;
    requested_amount: number;
    term_months: number;
  }) => void;
  onLeadChange?: (lead: LeadResponse | null) => void;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Formulário de simulação de crédito.
 * Sticky no desktop, empilhado no mobile.
 */
export function SimulatorForm({
  isPending,
  simulationError,
  onSubmit,
  onLeadChange,
}: SimulatorFormProps): React.JSX.Element {
  const [selectedProduct, setSelectedProduct] = React.useState<CreditProduct | null>(null);

  const schema = React.useMemo(
    () => buildSchema(selectedProduct?.active_rule ?? null),
    [selectedProduct],
  );

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isValid },
    trigger,
  } = useForm<SimulatorFormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      lead_id: '',
      product_id: '',
      amount_display: '',
      term_months: '',
    },
  });

  const watchedLeadId = watch('lead_id');
  const watchedProductId = watch('product_id');
  const watchedAmount = watch('amount_display');

  // Re-valida campos de valor e prazo quando produto muda (limites mudam)
  React.useEffect(() => {
    if (watchedProductId) {
      void trigger(['amount_display', 'term_months']);
    }
  }, [selectedProduct, trigger, watchedProductId]);

  function handleLeadChange(leadId: string, lead: LeadResponse | null) {
    setValue('lead_id', leadId, { shouldValidate: true });
    onLeadChange?.(lead);
  }

  function handleProductChange(productId: string, product: CreditProduct | null) {
    setValue('product_id', productId, { shouldValidate: true });
    setSelectedProduct(product);
  }

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const masked = maskBRL(e.target.value);
    setValue('amount_display', masked, { shouldValidate: true });
  }

  function handleFormSubmit(values: SimulatorFormValues) {
    const requested_amount = parseBRL(values.amount_display);
    const term_months = parseInt(values.term_months, 10);
    onSubmit({
      lead_id: values.lead_id,
      product_id: values.product_id,
      requested_amount,
      term_months,
    });
  }

  const rule = selectedProduct?.active_rule ?? null;

  return (
    <div
      className={cn(
        'rounded-md border border-border bg-surface-1 p-5 flex flex-col gap-5',
        // Sticky no desktop
        'lg:sticky lg:top-5',
      )}
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      {/* Header */}
      <div>
        <h2
          className="font-display font-bold text-ink leading-tight"
          style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.028em' }}
        >
          Simular crédito
        </h2>
        <p className="font-sans text-xs text-ink-3 mt-1">
          Preencha os dados para calcular parcela e amortização.
        </p>
      </div>

      <form
        onSubmit={handleSubmit(handleFormSubmit)}
        noValidate
        className="flex flex-col gap-4"
        aria-label="Formulário de simulação de crédito"
      >
        {/* Lead */}
        <LeadCombobox
          value={watchedLeadId}
          onChange={handleLeadChange}
          error={errors.lead_id?.message}
          disabled={isPending}
        />

        {/* Produto */}
        <ProductSelect
          value={watchedProductId}
          onChange={handleProductChange}
          error={errors.product_id?.message}
          disabled={isPending}
        />

        {/* Valor */}
        <div className="flex flex-col gap-2">
          <label
            htmlFor="amount-input"
            className="font-sans text-xs font-semibold uppercase tracking-[0.08em] text-ink-3"
          >
            Valor solicitado
            <span className="ml-1 text-danger" aria-hidden="true">
              *
            </span>
          </label>
          <input
            id="amount-input"
            type="text"
            inputMode="numeric"
            disabled={isPending}
            value={watchedAmount}
            onChange={handleAmountChange}
            placeholder="R$ 0,00"
            aria-describedby={
              errors.amount_display ? 'amount-error' : rule ? 'amount-hint' : undefined
            }
            aria-invalid={Boolean(errors.amount_display) || undefined}
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
              errors.amount_display &&
                'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          />
          {errors.amount_display ? (
            <span id="amount-error" role="alert" className="text-xs text-danger">
              {errors.amount_display.message}
            </span>
          ) : rule ? (
            <span id="amount-hint" className="text-xs text-ink-3">
              Faixa: {formatBRL(rule.min_amount)} – {formatBRL(rule.max_amount)}
            </span>
          ) : null}
        </div>

        {/* Prazo */}
        <Input
          id="term-months-input"
          label="Prazo (meses)"
          type="number"
          min={rule?.min_term_months ?? 1}
          max={rule?.max_term_months ?? 360}
          disabled={isPending}
          error={errors.term_months?.message}
          hint={rule ? `De ${rule.min_term_months} a ${rule.max_term_months} meses` : undefined}
          placeholder={rule ? `${rule.min_term_months}–${rule.max_term_months}` : 'Ex: 24'}
          required
          {...register('term_months')}
        />

        {/* Erros de rede / API */}
        {simulationError && simulationError.code === 'UNKNOWN' && (
          <div
            role="alert"
            className="rounded-sm border-l-[3px] p-3 text-sm font-sans"
            style={{
              borderColor: 'var(--danger)',
              background: 'var(--danger-bg)',
              color: 'var(--danger)',
            }}
          >
            <strong className="font-semibold">Erro ao simular:</strong> {simulationError.message}
          </div>
        )}

        {/* Botão submit */}
        <Button
          type="submit"
          variant="primary"
          size="default"
          disabled={isPending || !isValid}
          className="w-full mt-1"
          leftIcon={
            isPending ? (
              <span
                className="block w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"
                aria-hidden="true"
              />
            ) : (
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-4 h-4"
              >
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            )
          }
        >
          {isPending ? 'Calculando…' : 'Simular'}
        </Button>
      </form>
    </div>
  );
}
