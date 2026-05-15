// =============================================================================
// features/admin/products/PublishRuleDrawer.tsx — Drawer "Publicar nova versão".
//
// DS:
//   - Drawer lateral (mesmo padrão do ProductDrawer).
//   - Form: React Hook Form + Zod.
//   - Preview live: calcula parcela Price ao alterar campos (estimativa).
//   - Modal de confirmação antes de submeter: "Publicar vN → vN-1 expirará. Confirmar?"
//   - cityScope: multi-select de cidades (chips selecionados).
//
// Fórmula Price (estimativa):
//   PMT = P * i / (1 - (1+i)^(-n))
//   onde P = minAmount, i = monthlyRate/100, n = maxTermMonths
//   (usamos values médios se preferir — usamos min/max para estimativa conservadora)
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { usePublishRule } from '../../../hooks/admin/usePublishRule';
import { useCitiesList } from '../../../hooks/useCitiesList';
import type { RuleCreate } from '../../../lib/api/credit-products';
import { cn } from '../../../lib/cn';

// ---------------------------------------------------------------------------
// Schema Zod do form
// ---------------------------------------------------------------------------

const PublishRuleSchema = z
  .object({
    monthlyRate: z
      .number({ invalid_type_error: 'Informe a taxa mensal' })
      .gt(0, 'Taxa deve ser maior que 0')
      .lte(100, 'Taxa não pode exceder 100%'),
    iofRate: z
      .number({ invalid_type_error: 'Informe o IOF ou deixe em branco' })
      .gte(0)
      .lte(100)
      .optional(),
    minAmount: z
      .number({ invalid_type_error: 'Informe o valor mínimo' })
      .min(100, 'Mínimo: R$ 100')
      .max(1_000_000, 'Máximo: R$ 1.000.000'),
    maxAmount: z
      .number({ invalid_type_error: 'Informe o valor máximo' })
      .min(100, 'Mínimo: R$ 100')
      .max(1_000_000, 'Máximo: R$ 1.000.000'),
    minTermMonths: z
      .number({ invalid_type_error: 'Informe o prazo mínimo' })
      .int('Deve ser inteiro')
      .min(1)
      .max(120),
    maxTermMonths: z
      .number({ invalid_type_error: 'Informe o prazo máximo' })
      .int('Deve ser inteiro')
      .min(1)
      .max(120),
    amortization: z.enum(['price', 'sac']),
  })
  .refine((d) => d.maxAmount >= d.minAmount, {
    message: 'Valor máximo deve ser ≥ mínimo',
    path: ['maxAmount'],
  })
  .refine((d) => d.maxTermMonths >= d.minTermMonths, {
    message: 'Prazo máximo deve ser ≥ mínimo',
    path: ['maxTermMonths'],
  });

type PublishRuleValues = z.infer<typeof PublishRuleSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Fórmula Price (PMT).
 * PMT = P * i / (1 - (1+i)^-n)
 * Retorna NaN se entrada inválida.
 */
function calcPricePmt(principal: number, monthlyRatePct: number, termMonths: number): number {
  if (!principal || !monthlyRatePct || !termMonths) return NaN;
  const i = monthlyRatePct / 100;
  const pmt = (principal * i) / (1 - Math.pow(1 + i, -termMonths));
  return pmt;
}

// ---------------------------------------------------------------------------
// Componente: chips de cidades selecionadas
// ---------------------------------------------------------------------------

interface CityScopePickerProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function CityScopePicker({ selectedIds, onChange }: CityScopePickerProps): React.JSX.Element {
  const { cities, isLoading } = useCitiesList();
  const [filterText, setFilterText] = React.useState('');

  const filtered = cities.filter(
    (c) => !selectedIds.includes(c.id) && c.name.toLowerCase().includes(filterText.toLowerCase()),
  );

  const selectedCities = cities.filter((c) => selectedIds.includes(c.id));

  return (
    <div className="flex flex-col gap-2">
      <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
        Escopo de cidades{' '}
        <span className="normal-case tracking-normal text-ink-4">(vazio = todas)</span>
      </label>

      {/* Chips selecionadas */}
      {selectedCities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCities.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill font-sans text-xs font-medium"
              style={{
                background: 'var(--info-bg)',
                color: 'var(--info)',
                boxShadow: 'var(--elev-1)',
              }}
            >
              {c.name}
              <button
                type="button"
                aria-label={`Remover ${c.name}`}
                onClick={() => onChange(selectedIds.filter((id) => id !== c.id))}
                className="ml-0.5 opacity-70 hover:opacity-100 transition-opacity"
              >
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="w-3 h-3"
                  aria-hidden="true"
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input de busca + dropdown */}
      {isLoading ? (
        <div
          className="h-11 rounded-sm animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
          aria-hidden="true"
        />
      ) : (
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar cidade para adicionar..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className={cn(
              'w-full font-sans text-sm font-medium text-ink',
              'bg-surface-1 rounded-sm px-[14px] py-[11px]',
              'border border-border-strong',
              'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
              'transition-[border-color,box-shadow] duration-fast ease',
              'placeholder:text-ink-4',
              'focus:outline-none focus:border-azul',
              'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            )}
          />
          {filterText && filtered.length > 0 && (
            <div
              className="absolute z-10 left-0 right-0 top-full mt-1 rounded-sm border border-border overflow-hidden"
              style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
            >
              {filtered.slice(0, 8).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange([...selectedIds, c.id]);
                    setFilterText('');
                  }}
                  className={cn(
                    'w-full text-left px-4 py-2.5',
                    'font-sans text-sm text-ink-2 hover:text-ink',
                    'hover:bg-surface-hover',
                    'transition-colors duration-fast',
                  )}
                >
                  {c.name} <span className="text-ink-4 text-xs">{c.state_uf}</span>
                </button>
              ))}
            </div>
          )}
          {filterText && filtered.length === 0 && (
            <div
              className="absolute z-10 left-0 right-0 top-full mt-1 rounded-sm border border-border px-4 py-3"
              style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
            >
              <p className="font-sans text-sm text-ink-4">Nenhuma cidade encontrada.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de confirmação
// ---------------------------------------------------------------------------

interface ConfirmPublishModalProps {
  newVersion: number;
  prevVersion: number | null;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}

function ConfirmPublishModal({
  newVersion,
  prevVersion,
  onConfirm,
  onCancel,
  isPending,
}: ConfirmPublishModalProps): React.JSX.Element {
  return createPortal(
    <>
      <div
        role="presentation"
        aria-hidden="true"
        className="fixed inset-0 z-[200] bg-[var(--text)]/40 backdrop-blur-[2px]"
        onClick={onCancel}
      />
      <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-publish-title"
          className="w-full max-w-sm pointer-events-auto rounded-lg border border-border bg-surface-1"
          style={{
            boxShadow: 'var(--elev-5)',
            animation: 'fade-up 250ms cubic-bezier(0.16,1,0.3,1) both',
          }}
        >
          <div className="px-6 py-5">
            <div
              className="w-10 h-10 rounded-sm flex items-center justify-center mb-4"
              style={{ background: 'var(--warning-bg)' }}
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-5 h-5"
                style={{ color: 'var(--warning)' }}
                aria-hidden="true"
              >
                <path d="M10 3l7.5 13H2.5L10 3Z" />
                <path d="M10 9v4M10 14.5v.5" />
              </svg>
            </div>

            <h3
              id="confirm-publish-title"
              className="font-display font-bold text-ink mb-2"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
            >
              Publicar versão v{newVersion}?
            </h3>

            {prevVersion !== null ? (
              <p className="font-sans text-sm text-ink-2">
                A versão{' '}
                <span className="font-mono font-semibold" style={{ color: 'var(--brand-azul)' }}>
                  v{prevVersion}
                </span>{' '}
                será marcada como <strong>expirada</strong> e deixará de ser aplicada em novas
                simulações. Esta ação é permanente.
              </p>
            ) : (
              <p className="font-sans text-sm text-ink-2">
                Esta será a primeira regra deste produto. Será publicada como{' '}
                <span className="font-mono font-semibold" style={{ color: 'var(--brand-azul)' }}>
                  v1
                </span>
                .
              </p>
            )}
          </div>

          <div className="flex gap-3 px-6 pb-5">
            <Button variant="ghost" onClick={onCancel} disabled={isPending} className="flex-1">
              Cancelar
            </Button>
            <Button variant="primary" onClick={onConfirm} disabled={isPending} className="flex-1">
              {isPending ? 'Publicando...' : `Publicar v${newVersion}`}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Componente: form de publicação
// ---------------------------------------------------------------------------

interface PublishRuleFormProps {
  productId: string;
  currentVersion: number | null;
  onClose: () => void;
}

function PublishRuleForm({
  productId,
  currentVersion,
  onClose,
}: PublishRuleFormProps): React.JSX.Element {
  const [cityScope, setCityScope] = React.useState<string[]>([]);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [pendingValues, setPendingValues] = React.useState<PublishRuleValues | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PublishRuleValues>({
    resolver: zodResolver(PublishRuleSchema),
    defaultValues: {
      minAmount: 500,
      maxAmount: 5000,
      minTermMonths: 3,
      maxTermMonths: 24,
      amortization: 'price' as const,
    },
  });

  const { publishRule: doPublish, isPending } = usePublishRule({
    productId,
    onSuccess: () => {
      setShowConfirm(false);
      setPendingValues(null);
      onClose();
    },
  });

  // Campos assistidos para preview live
  const watchedAmount = watch('minAmount');
  const watchedRate = watch('monthlyRate');
  const watchedTerm = watch('maxTermMonths');
  const watchedAmortization = watch('amortization');

  // Preview PMT calculado live
  const previewPmt = React.useMemo(() => {
    if (watchedAmortization === 'price') {
      return calcPricePmt(watchedAmount, watchedRate, watchedTerm);
    }
    // SAC: primeira parcela = amortização + juros
    if (watchedAmount && watchedRate && watchedTerm) {
      const amort = watchedAmount / watchedTerm;
      const juros = watchedAmount * (watchedRate / 100);
      return amort + juros;
    }
    return NaN;
  }, [watchedAmount, watchedRate, watchedTerm, watchedAmortization]);

  const nextVersion = (currentVersion ?? 0) + 1;

  const onSubmit = (values: PublishRuleValues): void => {
    setPendingValues(values);
    setShowConfirm(true);
  };

  const handleConfirm = (): void => {
    if (!pendingValues) return;
    const ruleBody: RuleCreate = {
      monthlyRate: pendingValues.monthlyRate / 100,
      minAmount: pendingValues.minAmount,
      maxAmount: pendingValues.maxAmount,
      minTermMonths: pendingValues.minTermMonths,
      maxTermMonths: pendingValues.maxTermMonths,
      amortization: pendingValues.amortization,
    };
    if (pendingValues.iofRate !== undefined) {
      ruleBody.iofRate = pendingValues.iofRate / 100;
    }
    if (cityScope.length > 0) {
      ruleBody.cityScope = cityScope;
    }
    doPublish(ruleBody);
  };

  const isBusy = isSubmitting || isPending;

  return (
    <>
      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        noValidate
        className="flex flex-col gap-5 px-6 py-6"
      >
        {/* Aviso de versão */}
        <div
          className="flex items-start gap-3 px-4 py-3 rounded-sm border"
          style={{
            background: 'var(--info-bg)',
            borderColor: 'var(--info)',
            borderLeftWidth: 3,
          }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            className="w-4 h-4 mt-0.5 shrink-0"
            style={{ color: 'var(--info)' }}
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7v4M8 5.5v.5" />
          </svg>
          <div>
            <p className="font-sans text-sm font-semibold text-ink">
              Publicando versão{' '}
              <span className="font-mono" style={{ color: 'var(--brand-azul)' }}>
                v{nextVersion}
              </span>
            </p>
            {currentVersion !== null && (
              <p className="font-sans text-xs text-ink-3 mt-0.5">
                A versão atual{' '}
                <span className="font-mono" style={{ color: 'var(--brand-azul)' }}>
                  v{currentVersion}
                </span>{' '}
                será marcada como expirada.
              </p>
            )}
          </div>
        </div>

        {/* Taxa mensal + IOF — row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="rule-monthly-rate"
              className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
            >
              Taxa mensal <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <input
                id="rule-monthly-rate"
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                placeholder="2.50"
                className={cn(
                  'w-full font-mono text-sm font-medium text-ink',
                  'bg-surface-1 rounded-sm px-[14px] py-[11px] pr-9',
                  'border border-border-strong',
                  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                  'transition-[border-color,box-shadow] duration-fast ease',
                  'placeholder:text-ink-4',
                  'focus:outline-none focus:border-azul',
                  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                  errors.monthlyRate && 'border-danger',
                )}
                {...register('monthlyRate', { valueAsNumber: true })}
              />
              <span
                aria-hidden="true"
                className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-4 pointer-events-none"
              >
                %
              </span>
            </div>
            {errors.monthlyRate && (
              <span className="text-xs text-danger">{errors.monthlyRate.message}</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="rule-iof-rate"
              className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
            >
              IOF <span className="normal-case tracking-normal text-ink-4">(opcional)</span>
            </label>
            <div className="relative">
              <input
                id="rule-iof-rate"
                type="number"
                step="0.001"
                min="0"
                max="100"
                placeholder="0.38"
                className={cn(
                  'w-full font-mono text-sm font-medium text-ink',
                  'bg-surface-1 rounded-sm px-[14px] py-[11px] pr-9',
                  'border border-border-strong',
                  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                  'transition-[border-color,box-shadow] duration-fast ease',
                  'placeholder:text-ink-4',
                  'focus:outline-none focus:border-azul',
                  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                  errors.iofRate && 'border-danger',
                )}
                {...register('iofRate', { valueAsNumber: true })}
              />
              <span
                aria-hidden="true"
                className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-4 pointer-events-none"
              >
                %
              </span>
            </div>
            {errors.iofRate && (
              <span className="text-xs text-danger">{errors.iofRate.message}</span>
            )}
          </div>
        </div>

        {/* Faixa de valores */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="rule-min-amount"
              className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
            >
              Valor mínimo <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-4 pointer-events-none"
              >
                R$
              </span>
              <input
                id="rule-min-amount"
                type="number"
                step="100"
                min="100"
                max="1000000"
                placeholder="500"
                className={cn(
                  'w-full font-mono text-sm font-medium text-ink',
                  'bg-surface-1 rounded-sm pl-9 pr-[14px] py-[11px]',
                  'border border-border-strong',
                  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                  'transition-[border-color,box-shadow] duration-fast ease',
                  'placeholder:text-ink-4',
                  'focus:outline-none focus:border-azul',
                  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                  errors.minAmount && 'border-danger',
                )}
                {...register('minAmount', { valueAsNumber: true })}
              />
            </div>
            {errors.minAmount && (
              <span className="text-xs text-danger">{errors.minAmount.message}</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="rule-max-amount"
              className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
            >
              Valor máximo <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-4 pointer-events-none"
              >
                R$
              </span>
              <input
                id="rule-max-amount"
                type="number"
                step="100"
                min="100"
                max="1000000"
                placeholder="5000"
                className={cn(
                  'w-full font-mono text-sm font-medium text-ink',
                  'bg-surface-1 rounded-sm pl-9 pr-[14px] py-[11px]',
                  'border border-border-strong',
                  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                  'transition-[border-color,box-shadow] duration-fast ease',
                  'placeholder:text-ink-4',
                  'focus:outline-none focus:border-azul',
                  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                  errors.maxAmount && 'border-danger',
                )}
                {...register('maxAmount', { valueAsNumber: true })}
              />
            </div>
            {errors.maxAmount && (
              <span className="text-xs text-danger">{errors.maxAmount.message}</span>
            )}
          </div>
        </div>

        {/* Prazos */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <label
              htmlFor="rule-min-term"
              className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
            >
              Prazo mínimo <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <input
                id="rule-min-term"
                type="number"
                step="1"
                min="1"
                max="120"
                placeholder="3"
                className={cn(
                  'w-full font-mono text-sm font-medium text-ink',
                  'bg-surface-1 rounded-sm px-[14px] py-[11px] pr-16',
                  'border border-border-strong',
                  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                  'transition-[border-color,box-shadow] duration-fast ease',
                  'placeholder:text-ink-4',
                  'focus:outline-none focus:border-azul',
                  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                  errors.minTermMonths && 'border-danger',
                )}
                {...register('minTermMonths', { valueAsNumber: true })}
              />
              <span
                aria-hidden="true"
                className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4 pointer-events-none"
              >
                meses
              </span>
            </div>
            {errors.minTermMonths && (
              <span className="text-xs text-danger">{errors.minTermMonths.message}</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="rule-max-term"
              className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
            >
              Prazo máximo <span className="text-danger">*</span>
            </label>
            <div className="relative">
              <input
                id="rule-max-term"
                type="number"
                step="1"
                min="1"
                max="120"
                placeholder="24"
                className={cn(
                  'w-full font-mono text-sm font-medium text-ink',
                  'bg-surface-1 rounded-sm px-[14px] py-[11px] pr-16',
                  'border border-border-strong',
                  'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                  'transition-[border-color,box-shadow] duration-fast ease',
                  'placeholder:text-ink-4',
                  'focus:outline-none focus:border-azul',
                  'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
                  errors.maxTermMonths && 'border-danger',
                )}
                {...register('maxTermMonths', { valueAsNumber: true })}
              />
              <span
                aria-hidden="true"
                className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-ink-4 pointer-events-none"
              >
                meses
              </span>
            </div>
            {errors.maxTermMonths && (
              <span className="text-xs text-danger">{errors.maxTermMonths.message}</span>
            )}
          </div>
        </div>

        {/* Amortização */}
        <div className="flex flex-col gap-2">
          <span className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
            Sistema de amortização <span className="text-danger">*</span>
          </span>
          <div className="flex gap-3">
            {(['price', 'sac'] as const).map((opt) => (
              <label
                key={opt}
                className={cn(
                  'flex-1 flex items-center gap-2.5 px-4 py-3 rounded-sm border cursor-pointer',
                  'transition-[border-color,background] duration-fast ease',
                  'hover:border-azul hover:bg-surface-hover',
                  'has-[:checked]:border-azul has-[:checked]:bg-info-bg',
                )}
              >
                <input
                  type="radio"
                  value={opt}
                  className="w-4 h-4 accent-azul"
                  {...register('amortization')}
                />
                <span className="font-sans text-sm font-semibold text-ink">
                  {opt === 'price' ? 'Price' : 'SAC'}
                </span>
                <span className="font-sans text-xs text-ink-3">
                  {opt === 'price' ? 'parcelas iguais' : 'decrescente'}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Escopo de cidades */}
        <CityScopePicker selectedIds={cityScope} onChange={setCityScope} />

        {/* Preview live */}
        <div
          className="rounded-sm border border-border p-4"
          style={{ background: 'var(--bg-elev-2)', boxShadow: 'var(--elev-1)' }}
        >
          <p className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em] mb-2">
            Estimativa de parcela (exemplo)
          </p>

          {!isNaN(previewPmt) && previewPmt > 0 ? (
            <div className="flex items-baseline gap-2 flex-wrap">
              <span
                className="font-display font-bold text-ink"
                style={{ fontSize: 'var(--text-2xl)', letterSpacing: '-0.035em' }}
              >
                {BRL.format(previewPmt)}
                <span className="font-sans text-sm font-normal text-ink-3">/mês</span>
              </span>
              <span className="font-sans text-xs text-ink-4">
                — {BRL.format(watchedAmount)} em {watchedTerm}×
              </span>
            </div>
          ) : (
            <p className="font-sans text-sm text-ink-4">
              Preencha taxa, valor e prazo para ver a estimativa.
            </p>
          )}

          <p className="font-sans text-[10px] text-ink-4 mt-2">
            * Estimativa baseada em {watchedAmortization === 'price' ? 'Price' : 'SAC (1ª parcela)'}{' '}
            usando o valor mínimo e prazo máximo. Sem IOF. Apenas referência.
          </p>
        </div>

        {/* Footer */}
        <div className="flex gap-3 pt-1 border-t border-border-subtle">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isBusy}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isBusy} className="flex-1">
            {isBusy ? 'Publicando...' : `Publicar v${nextVersion}`}
          </Button>
        </div>
      </form>

      {/* Modal de confirmação */}
      {showConfirm && (
        <ConfirmPublishModal
          newVersion={nextVersion}
          prevVersion={currentVersion}
          onConfirm={handleConfirm}
          onCancel={() => {
            setShowConfirm(false);
            setPendingValues(null);
          }}
          isPending={isPending}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Drawer principal (PublishRuleDrawer)
// ---------------------------------------------------------------------------

interface PublishRuleDrawerProps {
  open: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  /** Versão atualmente ativa (null se nenhuma regra ainda) */
  currentVersion: number | null;
}

/**
 * Drawer lateral para publicar nova versão de regra de crédito.
 *
 * Inclui:
 *   - Form com todos os campos de CreditProductRuleCreate
 *   - Preview live de parcela (Price/SAC)
 *   - Modal de confirmação antes de submeter
 *   - Escopo de cidades (multi-select com chips)
 */
export function PublishRuleDrawer({
  open,
  onClose,
  productId,
  productName,
  currentVersion,
}: PublishRuleDrawerProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const nextVersion = (currentVersion ?? 0) + 1;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        aria-hidden="true"
        className="fixed inset-0 z-[150] bg-[var(--text)]/20 backdrop-blur-[2px]"
        onClick={onClose}
        style={{ animation: 'fade-in 200ms ease both' }}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-rule-drawer-title"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-[160]',
          'w-full sm:max-w-[500px]',
          'flex flex-col',
          'bg-surface-1 border-l border-border',
          'overflow-y-auto',
        )}
        style={{
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right 300ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <div>
            <h2
              id="publish-rule-drawer-title"
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-xl)',
                letterSpacing: '-0.03em',
                fontVariationSettings: "'opsz' 24",
              }}
            >
              Publicar v{nextVersion}
            </h2>
            <p className="font-sans text-xs text-ink-3 mt-1">{productName}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              'w-8 h-8 flex items-center justify-center mt-0.5',
              'rounded-sm text-ink-3',
              'hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5l-10 10" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <div className="flex-1">
          <PublishRuleForm
            productId={productId}
            currentVersion={currentVersion}
            onClose={onClose}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
