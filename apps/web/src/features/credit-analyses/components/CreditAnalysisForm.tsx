// =============================================================================
// features/credit-analyses/components/CreditAnalysisForm.tsx
//
// Formulários e modais para operações de análise de crédito.
// React Hook Form + Zod. DLP ativo no parecer (LGPD Art. 20 §1º).
//
// Exports:
//   CreditAnalysisForm       — form de criação (embed)
//   CreditAnalysisModal      — modal de criação
//   AddVersionModal          — modal de nova versão
//   DecideModal              — modal de decisão (aprovado | recusado)
//   RequestReviewModal       — modal de revisão humana (LGPD Art. 20 §5)
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useFieldArray, useForm } from 'react-hook-form';

import { LeadCombobox } from '../../../components/comboboxes/LeadCombobox';
import { SimulationSelect } from '../../../components/comboboxes/SimulationSelect';
import { Button } from '../../../components/ui/Button';
import { CurrencyInput } from '../../../components/ui/CurrencyInput';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { cn } from '../../../lib/cn';
import {
  useAddVersion,
  useCreateCreditAnalysis,
  useDecideAnalysis,
  useRequestReview,
} from '../hooks/useCreditAnalyses';
import type {
  CreditAnalysisCreateForm,
  CreditAnalysisDecideForm,
  CreditAnalysisRequestReviewForm,
  CreditAnalysisResponse,
  CreditAnalysisStatus,
  CreditAnalysisVersionForm,
  Pendencia,
} from '../schemas';
import {
  CreditAnalysisCreateFormSchema,
  CreditAnalysisDecideFormSchema,
  CreditAnalysisRequestReviewFormSchema,
  CreditAnalysisVersionFormSchema,
} from '../schemas';

// ─── Textarea canônico do DS (inset shadow, foco azul, erro danger) ───────────

interface TextareaFieldProps {
  id: string;
  label?: string | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  rows?: number | undefined;
  placeholder?: string | undefined;
  className?: string | undefined;
}

const TextareaField = React.forwardRef<
  HTMLTextAreaElement,
  TextareaFieldProps & React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function TextareaField({ id, label, error, required, className, ...props }, ref) {
  const hasError = Boolean(error);
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label
          htmlFor={id}
          className="font-sans text-xs font-semibold text-ink-2 uppercase tracking-[0.1em]"
        >
          {label}
          {required === true && <span className="text-danger ml-0.5">*</span>}
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${id}-error` : undefined}
        required={required}
        className={cn(
          'w-full font-sans text-sm font-medium text-ink',
          'bg-surface-1 rounded-sm px-[14px] py-[11px]',
          'border border-border-strong',
          'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
          'transition-[border-color,box-shadow] duration-fast ease',
          'placeholder:text-ink-4',
          'hover:border-ink-3',
          'focus:outline-none focus:border-azul',
          'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
          'resize-y min-h-[120px]',
          hasError &&
            'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
          className,
        )}
        {...props}
      />
      {hasError && error && (
        <span id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
});

// ─── Pendências dinâmicas (sub-componente) ────────────────────────────────────

interface RegisterReturn {
  name: string;
  ref: React.Ref<HTMLInputElement>;
  onChange: React.ChangeEventHandler<HTMLInputElement>;
  onBlur: React.FocusEventHandler<HTMLInputElement>;
}

interface PendenciasEditorProps {
  fields: { id: string }[];
  onAppend: () => void;
  onRemove: (idx: number) => void;
  prefix: string;
  errors: Record<string, { message?: string } | undefined>[];
  register: (name: string) => RegisterReturn;
}

function PendenciasEditor({
  fields,
  onAppend,
  onRemove,
  prefix,
  errors,
  register,
}: PendenciasEditorProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p
          className="font-sans text-xs font-semibold text-ink-2 uppercase"
          style={{ letterSpacing: '0.1em' }}
        >
          Pendências documentais
        </p>
        <button
          type="button"
          onClick={onAppend}
          className="font-sans text-xs text-azul hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-xs"
        >
          + Adicionar pendência
        </button>
      </div>

      {fields.map((field, idx) => (
        <div
          key={field.id}
          className="flex flex-col gap-2 rounded-sm border border-border-subtle p-3"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <div className="flex items-center justify-between">
            <span className="font-sans text-xs text-ink-3">Pendência {idx + 1}</span>
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className="font-sans text-xs text-danger hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/20 rounded-xs"
              aria-label={`Remover pendência ${idx + 1}`}
            >
              Remover
            </button>
          </div>
          <Input
            id={`${prefix}-pend-tipo-${idx}`}
            label="Tipo"
            placeholder="Ex: Comprovante de renda"
            {...(errors[idx]?.['tipo']?.message !== undefined
              ? { error: errors[idx]['tipo']!.message }
              : {})}
            {...register(`${prefix}.${idx}.tipo`)}
          />
          <Input
            id={`${prefix}-pend-desc-${idx}`}
            label="Descrição"
            placeholder="Detalhes da pendência"
            {...(errors[idx]?.['descricao']?.message !== undefined
              ? { error: errors[idx]['descricao']!.message }
              : {})}
            {...register(`${prefix}.${idx}.descricao`)}
          />
          <Input
            id={`${prefix}-pend-prazo-${idx}`}
            label="Prazo (opcional)"
            placeholder="Ex: 05/06/2026"
            {...register(`${prefix}.${idx}.prazo`)}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Modal wrapper genérico ───────────────────────────────────────────────────

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

function ModalShell({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-xl',
}: ModalShellProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          'w-full rounded-lg border border-border bg-surface-1 overflow-y-auto max-h-[90vh]',
          maxWidth,
        )}
        style={{ boxShadow: 'var(--elev-5)' }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-border-subtle sticky top-0 bg-surface-1 z-10"
          style={{ boxShadow: 'var(--elev-1)' }}
        >
          <h2
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-xl)',
              letterSpacing: '-0.03em',
              fontVariationSettings: "'opsz' 24",
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="w-8 h-8 flex items-center justify-center rounded-xs text-ink-3 hover:text-ink hover:bg-surface-hover transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Status options ───────────────────────────────────────────────────────────

const STATUS_OPTIONS_CREATE = [
  { value: 'em_analise', label: 'Em análise' },
  { value: 'pendente', label: 'Pendente' },
];

const STATUS_OPTIONS_ALL = [
  { value: 'em_analise', label: 'Em análise' },
  { value: 'pendente', label: 'Pendente' },
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'recusado', label: 'Recusado' },
  { value: 'cancelado', label: 'Cancelado' },
];

const DECISION_OPTIONS = [
  { value: 'aprovado', label: 'Aprovado' },
  { value: 'recusado', label: 'Recusado' },
];

// ─── CreditAnalysisForm (embed) ───────────────────────────────────────────────

interface CreditAnalysisFormProps {
  defaultLeadId?: string | undefined;
  defaultSimulationId?: string | undefined;
  onSuccess?: ((analysis: CreditAnalysisResponse) => void) | undefined;
  onCancel?: (() => void) | undefined;
  onError?: ((message: string) => void) | undefined;
}

/**
 * CreditAnalysisForm — formulário de criação embedded.
 * RHF + Zod resolver. DLP ativo no parecer.
 */
export function CreditAnalysisForm({
  defaultLeadId,
  defaultSimulationId,
  onSuccess,
  onCancel,
  onError,
}: CreditAnalysisFormProps): React.JSX.Element {
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreditAnalysisCreateForm>({
    resolver: zodResolver(CreditAnalysisCreateFormSchema),
    defaultValues: {
      lead_id: defaultLeadId ?? '',
      simulation_id: defaultSimulationId ?? null,
      status: 'em_analise',
      parecer_text: '',
      pendencias: [],
    },
  });

  const watchedLeadId = watch('lead_id');
  const watchedSimulationId = watch('simulation_id');

  const { fields, append, remove } = useFieldArray({ control, name: 'pendencias' });

  const handleAppend = (): void => {
    append({ tipo: '', descricao: '' } as Pendencia);
  };

  const { createAnalysis, isPending } = useCreateCreditAnalysis({
    ...(onSuccess !== undefined ? { onSuccess } : {}),
    ...(onError !== undefined ? { onError } : {}),
  });

  const onSubmit = handleSubmit((data) => createAnalysis(data));

  // Mapear erros de pendencias para o sub-componente
  const pendenciaErrors = (errors.pendencias ?? []) as Record<
    string,
    { message?: string } | undefined
  >[];

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {!defaultLeadId ? (
        <LeadCombobox
          value={watchedLeadId}
          onChange={(id) => {
            setValue('lead_id', id, { shouldValidate: true });
            // Limpa simulação quando lead muda
            if (!id) setValue('simulation_id', null);
          }}
          error={errors.lead_id?.message}
          disabled={isPending}
          label="Lead"
          required
        />
      ) : (
        <input type="hidden" {...register('lead_id')} />
      )}

      {!defaultSimulationId && (
        <SimulationSelect
          leadId={watchedLeadId || null}
          value={watchedSimulationId ?? ''}
          onChange={(id) => setValue('simulation_id', id || null)}
          disabled={isPending}
          label="Simulação vinculada (opcional)"
        />
      )}

      <Select
        id="ca-status"
        label="Status inicial"
        options={STATUS_OPTIONS_CREATE}
        error={errors.status?.message}
        {...register('status')}
      />

      <TextareaField
        id="ca-parecer"
        label="Parecer inicial"
        required
        rows={6}
        placeholder="Descreva a análise de crédito. Não inclua CPF ou RG em forma bruta (LGPD)."
        error={errors.parecer_text?.message}
        {...register('parecer_text')}
      />

      <PendenciasEditor
        fields={fields}
        onAppend={handleAppend}
        onRemove={remove}
        prefix="pendencias"
        errors={pendenciaErrors}
        register={register as unknown as (name: string) => RegisterReturn}
      />

      <div className="flex gap-2 pt-1">
        {onCancel !== undefined && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isPending}
            className="flex-1"
          >
            Cancelar
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          disabled={isPending}
          className={onCancel !== undefined ? 'flex-1' : 'w-full'}
        >
          {isPending ? 'Criando...' : 'Criar análise'}
        </Button>
      </div>
    </form>
  );
}

// ─── CreditAnalysisModal ──────────────────────────────────────────────────────

interface CreditAnalysisModalProps extends CreditAnalysisFormProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal de criação de análise (elev-5 conforme DS §4).
 */
export function CreditAnalysisModal({
  open,
  onClose,
  ...formProps
}: CreditAnalysisModalProps): React.JSX.Element | null {
  return (
    <ModalShell open={open} onClose={onClose} title="Nova análise de crédito">
      <CreditAnalysisForm
        {...formProps}
        onSuccess={(analysis) => {
          formProps.onSuccess?.(analysis);
          onClose();
        }}
        onCancel={onClose}
      />
    </ModalShell>
  );
}

// ─── AddVersionModal ──────────────────────────────────────────────────────────

interface AddVersionModalProps {
  open: boolean;
  onClose: () => void;
  analysisId: string;
  currentStatus: CreditAnalysisStatus;
  onSuccess?: ((analysis: CreditAnalysisResponse) => void) | undefined;
  onError?: ((message: string) => void) | undefined;
}

/**
 * Modal para adicionar nova versão de parecer.
 */
export function AddVersionModal({
  open,
  onClose,
  analysisId,
  currentStatus,
  onSuccess,
  onError,
}: AddVersionModalProps): React.JSX.Element | null {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
    reset,
  } = useForm<CreditAnalysisVersionForm>({
    resolver: zodResolver(CreditAnalysisVersionFormSchema),
    defaultValues: {
      status: currentStatus,
      parecer_text: '',
      pendencias: [],
      approved_amount: null,
      approved_term_months: null,
      approved_rate_monthly: null,
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'pendencias' });

  const handleAppend = (): void => {
    append({ tipo: '', descricao: '' } as Pendencia);
  };

  const { addVersion, isPending } = useAddVersion(analysisId, {
    onSuccess: (data) => {
      reset();
      onSuccess?.(data);
      onClose();
    },
    ...(onError !== undefined ? { onError } : {}),
  });

  const onSubmit = handleSubmit((data) => addVersion(data));
  const pendenciaErrors = (errors.pendencias ?? []) as Record<
    string,
    { message?: string } | undefined
  >[];

  return (
    <ModalShell open={open} onClose={onClose} title="Nova versão de parecer">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Select
          id="av-status"
          label="Status resultante"
          options={STATUS_OPTIONS_ALL}
          error={errors.status?.message}
          {...register('status')}
        />

        <TextareaField
          id="av-parecer"
          label="Parecer"
          required
          rows={6}
          placeholder="Texto do parecer. Não inclua CPF/RG brutos (LGPD Art. 20 §1º)."
          error={errors.parecer_text?.message}
          {...register('parecer_text')}
        />

        <PendenciasEditor
          fields={fields}
          onAppend={handleAppend}
          onRemove={remove}
          prefix="av-pendencias"
          errors={pendenciaErrors}
          register={register as unknown as (name: string) => RegisterReturn}
        />

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={isPending} className="flex-1">
            {isPending ? 'Salvando...' : 'Salvar versão'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── DecideModal ──────────────────────────────────────────────────────────────

interface DecideModalProps {
  open: boolean;
  onClose: () => void;
  analysisId: string;
  onSuccess?: ((analysis: CreditAnalysisResponse) => void) | undefined;
  onError?: ((message: string) => void) | undefined;
}

/**
 * Modal de decisão final (aprovado | recusado).
 * Visível apenas com permissão credit_analyses:decide.
 */
export function DecideModal({
  open,
  onClose,
  analysisId,
  onSuccess,
  onError,
}: DecideModalProps): React.JSX.Element | null {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    reset,
  } = useForm<CreditAnalysisDecideForm>({
    resolver: zodResolver(CreditAnalysisDecideFormSchema),
    defaultValues: {
      decision: 'aprovado',
      parecer_text: '',
      approved_amount: null,
      approved_term_months: null,
      approved_rate_monthly: null,
    },
  });

  const decision = watch('decision');
  const watchedApprovedAmount = watch('approved_amount');

  const { decide, isPending } = useDecideAnalysis(analysisId, {
    onSuccess: (data) => {
      reset();
      onSuccess?.(data);
      onClose();
    },
    ...(onError !== undefined ? { onError } : {}),
  });

  const onSubmit = handleSubmit((data) => decide(data));

  return (
    <ModalShell open={open} onClose={onClose} title="Registrar decisão" maxWidth="max-w-lg">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <Select
          id="decide-decision"
          label="Decisão"
          options={DECISION_OPTIONS}
          error={errors.decision?.message}
          {...register('decision')}
        />

        <TextareaField
          id="decide-parecer"
          label="Parecer de decisão"
          required
          rows={5}
          placeholder="Justificativa da decisão. Não inclua CPF/RG brutos (LGPD)."
          error={errors.parecer_text?.message}
          {...register('parecer_text')}
        />

        {decision === 'aprovado' && (
          <div
            className="flex flex-col gap-4 rounded-sm border border-border-subtle p-4"
            style={{ background: 'var(--bg-elev-2)' }}
          >
            <p
              className="font-sans text-xs font-semibold text-ink-2 uppercase"
              style={{ letterSpacing: '0.1em' }}
            >
              Dados da aprovação
            </p>
            {/* Valor — máscara de moeda (centavos progressivo, estilo banco/PIX) */}
            <CurrencyInput
              id="decide-amount"
              label="Valor aprovado (R$)"
              value={
                watchedApprovedAmount === null || watchedApprovedAmount === undefined
                  ? null
                  : Math.round(watchedApprovedAmount * 100)
              }
              onChange={(cents) =>
                setValue('approved_amount', cents === null ? null : cents / 100, {
                  shouldValidate: true,
                })
              }
              error={errors.approved_amount?.message}
            />
            <Input
              id="decide-term"
              label="Prazo (meses)"
              type="number"
              min="1"
              max="600"
              placeholder="Ex: 24"
              error={errors.approved_term_months?.message}
              {...register('approved_term_months', {
                setValueAs: (v: string) => (v ? parseInt(v, 10) : null),
              })}
            />
            {/* Taxa em % a.m. — usuário digita o percentual (ex: 2,5); convertemos
                para decimal (0.025) no envio. Evita a confusão do campo "decimal". */}
            <Input
              id="decide-rate"
              label="Taxa mensal (% a.m.)"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              placeholder="Ex: 2.5"
              hint="Informe o percentual ao mês. Ex: 2,5 = 2,5% a.m."
              error={errors.approved_rate_monthly?.message}
              {...register('approved_rate_monthly', {
                setValueAs: (v: string) => (v ? parseFloat(v) / 100 : null),
              })}
            />
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant={decision === 'aprovado' ? 'secondary' : 'danger'}
            disabled={isPending}
            className="flex-1"
          >
            {isPending ? 'Registrando...' : decision === 'aprovado' ? 'Aprovar' : 'Recusar'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── RequestReviewModal ───────────────────────────────────────────────────────

interface RequestReviewModalProps {
  open: boolean;
  onClose: () => void;
  analysisId: string;
  onSuccess?: ((analysis: CreditAnalysisResponse) => void) | undefined;
  onError?: ((message: string) => void) | undefined;
}

/**
 * Modal de solicitação de revisão humana (Art. 20 §5 LGPD).
 */
export function RequestReviewModal({
  open,
  onClose,
  analysisId,
  onSuccess,
  onError,
}: RequestReviewModalProps): React.JSX.Element | null {
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CreditAnalysisRequestReviewForm>({
    resolver: zodResolver(CreditAnalysisRequestReviewFormSchema),
    defaultValues: { reason: '' },
  });

  const { requestReview, isPending } = useRequestReview(analysisId, {
    onSuccess: (data) => {
      reset();
      onSuccess?.(data);
      onClose();
    },
    ...(onError !== undefined ? { onError } : {}),
  });

  const onSubmit = handleSubmit((data) => requestReview(data));

  return (
    <ModalShell open={open} onClose={onClose} title="Solicitar revisão" maxWidth="max-w-lg">
      <p className="font-sans text-sm text-ink-2 mb-4">
        Solicitar revisão humana (Art. 20 §5 LGPD). O status será retornado a "Em análise".
      </p>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <TextareaField
          id="rr-reason"
          label="Motivo (opcional)"
          rows={4}
          placeholder="Contextualize o motivo da revisão. Não inclua CPF/RG brutos."
          error={errors.reason?.message}
          {...register('reason')}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button type="submit" variant="outline" disabled={isPending} className="flex-1">
            {isPending ? 'Enviando...' : 'Solicitar revisão'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
