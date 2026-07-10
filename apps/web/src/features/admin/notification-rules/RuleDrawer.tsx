// =============================================================================
// features/admin/notification-rules/RuleDrawer.tsx — Drawer criar/editar regra
// de notificação (F24-S11).
//
// DS:
//   - Drawer lateral: z-[160], elev-5, entra da direita (translate-x).
//   - Form: React Hook Form + zodResolver(notificationRuleCreateSchema).
//   - trigger_key: dropdown fechado do catálogo (GET /notification-rules/catalog).
//   - Campos contextuais: threshold_hours só aparece para stage_inactivity.
//   - Placeholders restritos ao gatilho escolhido.
//   - RuleTestPanel exibido após salvar em modo edit (ruleId presente).
//   - Estados: loading prefill (skeleton), submitting, erro inline.
//
// Props:
//   - open: boolean
//   - onClose: () => void
//   - ruleId?: string — sem ruleId = create, com = edit
// =============================================================================

import type { NotificationRuleResponse } from '@elemento/shared-schemas';
import {
  TRIGGER_CATALOG,
  lookupTrigger,
  notificationRuleCreateSchema,
  type NotificationRuleCreate,
} from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { useToast } from '../../../components/ui/Toast';
import { useKanbanStages } from '../../../hooks/kanban/useKanbanStages';
import { cn } from '../../../lib/cn';

import {
  useCreateNotificationRule,
  useNotificationCatalog,
  useNotificationRule,
  useUpdateNotificationRule,
} from './hooks';
import { RuleTestPanel } from './RuleTestPanel';

// ---------------------------------------------------------------------------
// Eixo kanban_stage: trigger_key parametrizável por stage (F24-S16/S17).
//
// A entrada de catálogo é sempre `kanban_stage:*`, mas o trigger_key
// persistido pode restringir a um stage específico: `kanban_stage:<stageId>`
// (UUID de kanban_stages.id). O campo do form continua sendo um único
// `trigger_key` — estas funções puras compõem/decompõem a string, sem campo
// separado no payload.
// ---------------------------------------------------------------------------

const KANBAN_STAGE_TRIGGER_PREFIX = 'kanban_stage:';
const KANBAN_STAGE_ANY_TRIGGER_KEY = 'kanban_stage:*';

/** `true` se o trigger_key pertence ao eixo kanban_stage (genérico ou por stage). */
export function isKanbanStageTriggerKey(triggerKey: string): boolean {
  return triggerKey.startsWith(KANBAN_STAGE_TRIGGER_PREFIX);
}

/** Extrai o seletor de stage (`'*'` ou UUID) a partir de um trigger_key persistido. */
export function parseKanbanStageSelector(triggerKey: string): string {
  return isKanbanStageTriggerKey(triggerKey)
    ? triggerKey.slice(KANBAN_STAGE_TRIGGER_PREFIX.length)
    : '*';
}

/** Monta o trigger_key final a partir do seletor escolhido no Select de stage. */
export function buildKanbanStageTriggerKey(stageSelector: string): string {
  return stageSelector === '*'
    ? KANBAN_STAGE_ANY_TRIGGER_KEY
    : `${KANBAN_STAGE_TRIGGER_PREFIX}${stageSelector}`;
}

// ---------------------------------------------------------------------------
// Tipos do formulário
// ---------------------------------------------------------------------------

type RuleFormValues = NotificationRuleCreate;

// ---------------------------------------------------------------------------
// Opções de select
// ---------------------------------------------------------------------------

const RECIPIENT_MODE_OPTIONS = [
  { value: 'by_role_city', label: 'Por papel + cidade' },
  { value: 'assignee', label: 'Agente atribuído' },
  { value: 'managers', label: 'Gestores da cidade' },
] as const;

const SEVERITY_OPTIONS = [
  { value: 'info', label: 'Informativo' },
  { value: 'warning', label: 'Alerta' },
  { value: 'critical', label: 'Crítico' },
] as const;

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'gestor_regional', label: 'Gestor Regional' },
  { value: 'agente', label: 'Agente' },
  { value: 'analista_credito', label: 'Analista de Crédito' },
  { value: 'cobranca', label: 'Cobrança' },
  { value: 'juridico', label: 'Jurídico' },
] as const;

// ---------------------------------------------------------------------------
// Helper: label amigável para gatilho
// ---------------------------------------------------------------------------

function triggerLabel(key: string): string {
  const MAP: Record<string, string> = {
    'simulations.generated': 'Simulação gerada',
    'credit_analysis.status_changed': 'Análise: status alterado',
    'chatwoot.handoff_requested': 'Handoff solicitado',
    'contract.signed': 'Contrato assinado',
    'contract.near_end': 'Contrato próximo ao fim',
    'payment_due.overdue_15d': 'Inadimplência 15d+',
    'billing.collection_sent': 'Cobrança enviada',
    'task.created': 'Tarefa criada',
    'customer.law_firm_referred': 'Encaminhado à advocacia',
    'kanban_stage:*': 'Inatividade no Kanban',
    'handoff:requested': 'Handoff sem aceite',
    'simulation:sent_no_reply': 'Simulação sem resposta',
    'analysis:pendente': 'Análise pendente',
    'contract:draft_unsigned': 'Contrato em draft',
    'payment_due:overdue': 'Parcela inadimplente',
    'conversation:no_reply': 'Conversa sem resposta',
  };
  return MAP[key] ?? key;
}

// ---------------------------------------------------------------------------
// Skeleton de carregamento do form
// ---------------------------------------------------------------------------

function FormSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-6 py-6" aria-busy="true" aria-label="Carregando…">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="h-11 rounded-sm animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: label de seção
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p
      className="font-sans text-xs font-bold text-ink-4 uppercase pt-2"
      style={{ letterSpacing: '0.08em' }}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: toggle de canal
// ---------------------------------------------------------------------------

interface ChannelToggleProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

function ChannelToggle({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: ChannelToggleProps): React.JSX.Element {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-center gap-3 cursor-pointer select-none',
        'px-3 py-2.5 rounded-sm border',
        'transition-[border-color,background] duration-[150ms]',
        checked ? 'border-azul/40 bg-azul/5 dark:bg-azul/10' : 'border-border bg-surface-1',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
        aria-label={label}
      />
      {/* Checkbox visual */}
      <span
        aria-hidden="true"
        className={cn(
          'w-4 h-4 rounded-xs border-2 flex items-center justify-center shrink-0',
          'transition-colors duration-[150ms]',
          checked ? 'border-azul bg-azul' : 'border-border-strong bg-surface-1',
        )}
      >
        {checked && (
          <svg
            viewBox="0 0 12 12"
            fill="none"
            stroke="white"
            strokeWidth={2}
            className="w-2.5 h-2.5"
            aria-hidden="true"
          >
            <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="font-sans text-sm font-medium text-ink">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: toggle de papel (role)
// ---------------------------------------------------------------------------

interface RoleToggleProps {
  roleKey: string;
  label: string;
  selected: boolean;
  onToggle: (key: string) => void;
}

function RoleToggle({ roleKey, label, selected, onToggle }: RoleToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onToggle(roleKey)}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs font-medium',
        'border transition-[border-color,color,background] duration-[150ms]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        selected
          ? 'border-azul/40 bg-azul/10 text-azul dark:bg-azul/20'
          : 'border-border text-ink-3 bg-surface-1 hover:border-ink-3 hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: preview de placeholders do gatilho
// ---------------------------------------------------------------------------

interface PlaceholderHintsProps {
  triggerKey: string;
}

function PlaceholderHints({ triggerKey }: PlaceholderHintsProps): React.JSX.Element | null {
  // lookupTrigger resolve o prefixo kanban_stage:<stageId|*> para a mesma
  // entrada de catálogo (F24-S16/S17) — TRIGGER_CATALOG.find exato não cobre
  // trigger_key com stage específico.
  const entry = lookupTrigger(triggerKey);
  if (entry === undefined) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {(entry.placeholders as ReadonlyArray<string>).map((ph) => (
        <code
          key={ph}
          className={cn(
            'font-mono text-[0.68rem] px-1.5 py-0.5 rounded-xs',
            'border border-border bg-surface-muted text-ink-3',
            'cursor-default select-all',
          )}
          title={`Copie e cole no template: {{${ph}}}`}
        >
          {`{{${ph}}}`}
        </code>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: form interno
// ---------------------------------------------------------------------------

interface RuleFormProps {
  ruleId?: string | undefined;
  onClose: () => void;
  /** Chamado após criação/edição bem-sucedida com o ID da regra */
  onSaved?: ((id: string) => void) | undefined;
}

function RuleForm({ ruleId, onClose, onSaved }: RuleFormProps): React.JSX.Element {
  const isEditMode = Boolean(ruleId);
  const { toast } = useToast();

  // Dados do catálogo para o dropdown de gatilhos
  const { data: catalogData, isLoading: catalogLoading } = useNotificationCatalog();

  // Stages do Kanban para o seletor do eixo kanban_stage (F24-S17) — reusa o
  // hook existente do módulo Kanban, sem endpoint novo.
  const { stages: kanbanStages, isLoading: stagesLoading } = useKanbanStages();

  // Prefill em modo edit
  const { data: existingRule, isLoading: ruleLoading } = useNotificationRule(ruleId);

  const isLoadingData = catalogLoading || (isEditMode && ruleLoading);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RuleFormValues>({
    resolver: zodResolver(notificationRuleCreateSchema),
    defaultValues: {
      name: '',
      trigger_key: '',
      recipient_mode: 'by_role_city',
      recipient_roles: [],
      severity: 'info',
      channels: ['in_app'],
      title_template: '',
      body_template: '',
      threshold_hours: undefined,
      cooldown_hours: 0,
      enabled: false,
      city_scope: [],
    },
  });

  // Prefill quando a regra existente carrega
  React.useEffect(() => {
    if (!existingRule) return;
    reset({
      name: existingRule.name,
      trigger_key: existingRule.trigger_key,
      recipient_mode: existingRule.recipient_mode,
      recipient_roles: existingRule.recipient_roles,
      severity: existingRule.severity,
      channels: existingRule.channels,
      title_template: existingRule.title_template,
      body_template: existingRule.body_template,
      threshold_hours: existingRule.threshold_hours ?? undefined,
      cooldown_hours: existingRule.cooldown_hours,
      enabled: existingRule.enabled,
      city_scope: existingRule.city_scope ?? [],
    });
  }, [existingRule, reset]);

  // Watch para campos contextuais
  const watchedTriggerKey = watch('trigger_key');
  const watchedRecipientMode = watch('recipient_mode');
  const watchedChannels = watch('channels');
  const watchedRoles = watch('recipient_roles') ?? [];

  // Determinar se o gatilho atual é stage_inactivity — lookupTrigger resolve
  // o prefixo kanban_stage:<stageId|*> para a mesma entrada de catálogo.
  const selectedTriggerEntry = lookupTrigger(watchedTriggerKey);
  const isInactivityTrigger = selectedTriggerEntry?.kind === 'stage_inactivity';
  const showThreshold = isInactivityTrigger;
  const showRoles = watchedRecipientMode === 'by_role_city';

  // Eixo kanban_stage: exibe o seletor de stage só quando o gatilho atual
  // pertence a este eixo (F24-S17). O stage escolhido não é um campo
  // separado — é derivado/gravado diretamente na string trigger_key.
  const isKanbanStageTrigger = isKanbanStageTriggerKey(watchedTriggerKey);
  const selectedStageSelector = parseKanbanStageSelector(watchedTriggerKey);
  const hasKanbanStages = kanbanStages.length > 0;

  const stageOptions = React.useMemo(
    () => [
      { value: '*', label: 'Qualquer stage' },
      ...kanbanStages.map((s) => ({ value: s.id, label: s.name })),
    ],
    [kanbanStages],
  );

  const handleStageSelectorChange = (stageSelector: string): void => {
    setValue('trigger_key', buildKanbanStageTriggerKey(stageSelector), { shouldValidate: true });
  };

  // Quando mudar o gatilho para event, limpa threshold_hours
  React.useEffect(() => {
    if (!isInactivityTrigger) {
      setValue('threshold_hours', undefined);
    }
  }, [isInactivityTrigger, setValue]);

  // Handlers de canal (array de checkboxes)
  const handleChannelChange = (channel: 'in_app' | 'email', checked: boolean): void => {
    const current = watchedChannels ?? [];
    if (checked) {
      if (!current.includes(channel)) {
        setValue('channels', [...current, channel], { shouldValidate: true });
      }
    } else {
      setValue(
        'channels',
        current.filter((c) => c !== channel),
        { shouldValidate: true },
      );
    }
  };

  // Handler de roles (toggle array)
  const handleRoleToggle = (roleKey: string): void => {
    const current = watchedRoles;
    if (current.includes(roleKey)) {
      setValue(
        'recipient_roles',
        current.filter((r) => r !== roleKey),
        { shouldValidate: true },
      );
    } else {
      setValue('recipient_roles', [...current, roleKey], { shouldValidate: true });
    }
  };

  // Mutações
  const { mutate: doCreate, isPending: isCreating } = useCreateNotificationRule({
    onSuccess: (rule) => {
      toast('Regra criada com sucesso.', 'success');
      onSaved?.(rule.id);
      onClose();
    },
    onError: (err) => {
      toast(err.message ?? 'Erro ao criar regra.', 'danger');
    },
  });

  const { mutate: doUpdate, isPending: isUpdating } = useUpdateNotificationRule();

  const isBusy = isSubmitting || isCreating || isUpdating;

  const onSubmit = (data: RuleFormValues): void => {
    if (isEditMode && ruleId) {
      doUpdate(
        {
          id: ruleId,
          body: {
            name: data.name,
            trigger_key: data.trigger_key,
            recipient_mode: data.recipient_mode,
            recipient_roles: data.recipient_roles,
            severity: data.severity,
            channels: data.channels,
            title_template: data.title_template,
            body_template: data.body_template,
            threshold_hours: data.threshold_hours,
            cooldown_hours: data.cooldown_hours,
            enabled: data.enabled,
            city_scope: data.city_scope,
          },
        },
        {
          onSuccess: (rule: NotificationRuleResponse) => {
            toast('Regra atualizada com sucesso.', 'success');
            onSaved?.(rule.id);
            onClose();
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Erro ao atualizar regra.';
            toast(msg, 'danger');
          },
        },
      );
    } else {
      doCreate(data);
    }
  };

  if (isLoadingData) {
    return <FormSkeleton />;
  }

  // Opções do dropdown de gatilhos a partir do catálogo (ou fallback do TRIGGER_CATALOG)
  const triggerOptions = (
    catalogData?.data.length
      ? catalogData.data
      : (TRIGGER_CATALOG as ReadonlyArray<{ key: string }>)
  ).map((e) => ({ value: e.key, label: triggerLabel(e.key) }));

  const inAppChecked = watchedChannels?.includes('in_app') ?? false;
  const emailChecked = watchedChannels?.includes('email') ?? false;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-5 px-6 py-6"
    >
      {/* ── Nome ──────────────────────────────────────────────────────────── */}
      <Input
        id="rule-name"
        label="Nome da regra"
        placeholder="Ex: Alerta de inatividade no kanban — Qualificação"
        required
        error={errors.name?.message}
        {...register('name')}
      />

      {/* ── Gatilho ───────────────────────────────────────────────────────── */}
      <Controller
        name="trigger_key"
        control={control}
        render={({ field }) => (
          <Select
            id="rule-trigger"
            label="Gatilho"
            required
            placeholder="Selecione o gatilho…"
            options={triggerOptions}
            // O eixo kanban_stage sempre exibe a entrada genérica do catálogo
            // (kanban_stage:*) aqui — o stage específico é escolhido no
            // seletor abaixo, não neste dropdown (F24-S17).
            value={isKanbanStageTriggerKey(field.value) ? 'kanban_stage:*' : field.value}
            onChange={(e) => field.onChange(e.target.value)}
            error={errors.trigger_key?.message}
            hint="Define quando a notificação será disparada. Não pode ser alterado após salvar."
          />
        )}
      />

      {/* ── Stage do Kanban (apenas eixo kanban_stage) ──────────────────────── */}
      {isKanbanStageTrigger && (
        <Select
          id="rule-kanban-stage"
          label="Estágio do Kanban"
          required
          options={stageOptions}
          value={selectedStageSelector}
          onChange={(e) => handleStageSelectorChange(e.target.value)}
          disabled={isBusy || stagesLoading || !hasKanbanStages}
          hint={
            hasKanbanStages
              ? 'Restringe o gatilho a um único estágio, ou monitore qualquer estágio.'
              : 'Nenhum estágio do Kanban cadastrado para esta organização.'
          }
        />
      )}

      {/* ── Threshold (apenas stage_inactivity) ───────────────────────────── */}
      {showThreshold && (
        <Input
          id="rule-threshold"
          label="Horas de inatividade (threshold)"
          type="number"
          min={1}
          placeholder="Ex: 24"
          required
          error={errors.threshold_hours?.message}
          hint={
            selectedTriggerEntry && 'timestampSource' in selectedTriggerEntry
              ? `Medido a partir de: ${selectedTriggerEntry.timestampSource}`
              : undefined
          }
          {...register('threshold_hours', { valueAsNumber: true })}
        />
      )}

      {/* ── Separador: Destinatários ───────────────────────────────────────── */}
      <SectionLabel>Destinatários</SectionLabel>

      {/* Modo de resolução */}
      <Controller
        name="recipient_mode"
        control={control}
        render={({ field }) => (
          <Select
            id="rule-recipient-mode"
            label="Modo de resolução"
            required
            options={RECIPIENT_MODE_OPTIONS as unknown as Array<{ value: string; label: string }>}
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
            error={errors.recipient_mode?.message}
            hint="Como a plataforma determina quem recebe a notificação."
          />
        )}
      />

      {/* Papéis — apenas quando by_role_city */}
      {showRoles && (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
            Papéis{' '}
            <span className="normal-case tracking-normal text-danger font-bold" aria-hidden="true">
              *
            </span>
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Papéis destinatários">
            {ROLE_OPTIONS.map((opt) => (
              <RoleToggle
                key={opt.value}
                roleKey={opt.value}
                label={opt.label}
                selected={watchedRoles.includes(opt.value)}
                onToggle={handleRoleToggle}
              />
            ))}
          </div>
          {errors.recipient_roles?.message && (
            <span role="alert" className="text-xs text-danger">
              {errors.recipient_roles.message}
            </span>
          )}
        </div>
      )}

      {/* ── Separador: Canais ─────────────────────────────────────────────── */}
      <SectionLabel>Canais de entrega</SectionLabel>

      <div className="flex flex-col gap-2" role="group" aria-label="Canais de entrega">
        <ChannelToggle
          id="rule-channel-inapp"
          label="In-app (sino de notificações)"
          checked={inAppChecked}
          onChange={(v) => handleChannelChange('in_app', v)}
          disabled={isBusy}
        />
        <ChannelToggle
          id="rule-channel-email"
          label="E-mail"
          checked={emailChecked}
          onChange={(v) => handleChannelChange('email', v)}
          disabled={isBusy}
        />
        {errors.channels?.message && (
          <span role="alert" className="text-xs text-danger">
            {errors.channels.message}
          </span>
        )}
      </div>

      {/* ── Severidade ────────────────────────────────────────────────────── */}
      <Controller
        name="severity"
        control={control}
        render={({ field }) => (
          <Select
            id="rule-severity"
            label="Severidade"
            required
            options={SEVERITY_OPTIONS as unknown as Array<{ value: string; label: string }>}
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
            error={errors.severity?.message}
            hint="Controla ênfase visual no sino e SLA de resposta esperado."
          />
        )}
      />

      {/* ── Cooldown ──────────────────────────────────────────────────────── */}
      <Input
        id="rule-cooldown"
        label="Cooldown (horas)"
        type="number"
        min={0}
        placeholder="0 = sem cooldown"
        error={errors.cooldown_hours?.message}
        hint="Intervalo mínimo entre disparos para a mesma entidade. 0 = sem cooldown."
        {...register('cooldown_hours', { valueAsNumber: true })}
      />

      {/* ── Separador: Templates ──────────────────────────────────────────── */}
      <SectionLabel>Templates de mensagem</SectionLabel>

      {/* Preview de placeholders disponíveis */}
      {watchedTriggerKey.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-sans text-xs text-ink-4">
            Placeholders disponíveis para este gatilho — clique para copiar:
          </p>
          <PlaceholderHints triggerKey={watchedTriggerKey} />
        </div>
      )}

      {/* Título do template */}
      <Input
        id="rule-title-template"
        label="Título da notificação"
        placeholder="Ex: Nova simulação gerada — {{product_id}}"
        required
        error={errors.title_template?.message}
        hint="Use {{placeholder}} com os valores do gatilho acima."
        {...register('title_template')}
      />

      {/* Corpo do template */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="rule-body-template"
          className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
        >
          Corpo da notificação{' '}
          <span className="text-danger normal-case tracking-normal font-bold" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="rule-body-template"
          placeholder="Ex: Lead {{lead_id}} gerou simulação de R$ {{amount}} em {{term_months}} meses."
          rows={4}
          aria-describedby={
            errors.body_template ? 'rule-body-template-error' : 'rule-body-template-hint'
          }
          aria-invalid={Boolean(errors.body_template) || undefined}
          className={cn(
            'w-full font-sans text-sm font-medium text-ink',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-[150ms]',
            'placeholder:text-ink-4 resize-y',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
            errors.body_template && 'border-danger',
          )}
          {...register('body_template')}
        />
        {errors.body_template ? (
          <span id="rule-body-template-error" role="alert" className="text-xs text-danger">
            {errors.body_template.message}
          </span>
        ) : (
          <span id="rule-body-template-hint" className="text-xs text-ink-4">
            Use {`{{placeholder}}`} com os valores do gatilho. Sem PII de cidadão (LGPD §8.5).
          </span>
        )}
      </div>

      {/* ── Toggle enabled ────────────────────────────────────────────────── */}
      <Controller
        name="enabled"
        control={control}
        render={({ field }) => (
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              id="rule-enabled"
              aria-checked={field.value}
              aria-label="Regra ativa"
              disabled={isBusy}
              onClick={() => field.onChange(!field.value)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-pill',
                'border-2 border-transparent',
                'transition-colors duration-[200ms]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              style={{
                backgroundColor: field.value ? 'var(--brand-verde)' : 'var(--surface-muted)',
              }}
            >
              <span
                className="pointer-events-none block h-4 w-4 rounded-pill bg-white transition-transform duration-[200ms]"
                style={{
                  boxShadow: 'var(--elev-1)',
                  transform: field.value ? 'translateX(16px)' : 'translateX(0)',
                }}
                aria-hidden="true"
              />
            </button>
            <label
              htmlFor="rule-enabled"
              className="font-sans text-sm font-medium text-ink-2 cursor-pointer select-none"
            >
              {field.value ? 'Regra ativa — será avaliada pelo worker' : 'Regra inativa'}
            </label>
          </div>
        )}
      />

      {/* ── Footer ────────────────────────────────────────────────────────── */}
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
          {isBusy
            ? isEditMode
              ? 'Salvando…'
              : 'Criando…'
            : isEditMode
              ? 'Salvar alterações'
              : 'Criar regra'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Drawer principal
// ---------------------------------------------------------------------------

interface RuleDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Sem ruleId → create; com → edit */
  ruleId?: string | undefined;
}

/**
 * Drawer lateral de criação / edição de regra de notificação (F24-S11).
 *
 * Entra da direita com slide + fade. Backdrop fecha ao clicar fora.
 * Em modo edit, exibe RuleTestPanel após o form (dry-run sem envio real).
 * Portal para z-index correto acima do layout.
 */
export function RuleDrawer({ open, onClose, ruleId }: RuleDrawerProps): React.JSX.Element | null {
  // ID da regra salva (para exibir o TestPanel após save em mode edit)
  const [savedRuleId, setSavedRuleId] = React.useState<string | undefined>(ruleId);

  // Sincronizar quando o ruleId externo muda (ao reabrir em modo edit)
  React.useEffect(() => {
    setSavedRuleId(ruleId);
  }, [ruleId]);

  // Fechar com Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Bloquear scroll do body
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const isEditMode = Boolean(ruleId);
  const title = isEditMode ? 'Editar regra' : 'Nova regra de notificação';
  const showTestPanel = isEditMode && savedRuleId !== undefined;

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

      {/* Drawer — entra da direita */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rule-drawer-title"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-[160]',
          'w-full sm:max-w-[520px]',
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
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <div>
            <h2
              id="rule-drawer-title"
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-xl)',
                letterSpacing: '-0.03em',
                fontVariationSettings: "'opsz' 24",
              }}
            >
              {title}
            </h2>
            {isEditMode && savedRuleId && (
              <code
                className="font-mono text-xs text-ink-4 block mt-0.5"
                style={{ fontSize: '0.7rem' }}
              >
                {savedRuleId}
              </code>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              'w-8 h-8 flex items-center justify-center',
              'rounded-sm text-ink-3',
              'hover:text-ink hover:bg-surface-hover',
              'transition-all duration-[150ms]',
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
          <RuleForm ruleId={ruleId} onClose={onClose} onSaved={(id) => setSavedRuleId(id)} />
        </div>

        {/* TestPanel — visível somente em modo edit com regra salva */}
        {showTestPanel && (
          <div className="px-6 pb-6 border-t border-border-subtle">
            <div className="pt-5">
              <RuleTestPanel ruleId={savedRuleId} />
            </div>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
