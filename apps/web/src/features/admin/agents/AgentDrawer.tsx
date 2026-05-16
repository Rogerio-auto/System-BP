// =============================================================================
// features/admin/agents/AgentDrawer.tsx — Drawer create/edit de agente (F8-S04).
//
// DS:
//   - Drawer lateral direito: z-[160], elev-5, slide-in-right.
//   - Form: React Hook Form + Zod (campos base) + estado local para cidades.
//   - Create: display_name + phone + userId (combobox) + cidades (AgentCitiesSelect).
//   - Edit: mesmos campos + desativar/reativar com tratamento 409 (leads ativos).
//   - Validação client-side: ≥1 cidade antes de submit.
//
// Contratos confirmados de apps/api/src/modules/agents/schemas.ts:
//   - Create:  { displayName, phone?, userId?, cityIds[], primaryCityId? }
//   - Update:  { displayName?, phone?, userId?, isActive? }
//   - Cities:  { cityIds[], primaryCityId? }
//   - Response: snake_case (display_name, is_active, primary_city_id, etc.)
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useToast } from '../../../components/ui/Toast';
import {
  useCreateAgent,
  useDeactivateAgent,
  useReactivateAgent,
  useSetAgentCities,
  useUpdateAgent,
} from '../../../hooks/admin/useAgents';
import type { AgentResponse } from '../../../hooks/admin/useAgents.types';
import { cn } from '../../../lib/cn';

import { AgentCitiesSelect } from './AgentCitiesSelect';
import type { AgentCitiesValue } from './AgentCitiesSelect';
import { UserCombobox } from './UserCombobox';

// ---------------------------------------------------------------------------
// Schema Zod — campos base do form
// ---------------------------------------------------------------------------

const AgentFormSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Nome deve ter ao menos 2 caracteres')
    .max(120, 'Nome deve ter no máximo 120 caracteres')
    .trim(),
  phone: z.string().max(30).optional().or(z.literal('')),
  userId: z.string().uuid().nullable().optional(),
});

type AgentFormValues = z.infer<typeof AgentFormSchema>;

// ---------------------------------------------------------------------------
// Form de criação
// ---------------------------------------------------------------------------

interface CreateFormProps {
  onClose: () => void;
}

function CreateAgentForm({ onClose }: CreateFormProps): React.JSX.Element {
  const [citiesValue, setCitiesValue] = React.useState<AgentCitiesValue>({
    cityIds: [],
    primaryCityId: null,
  });
  const [citiesError, setCitiesError] = React.useState<string | undefined>(undefined);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AgentFormValues>({
    resolver: zodResolver(AgentFormSchema),
    defaultValues: { displayName: '', phone: '', userId: null },
  });

  const { createAgent, isPending: isCreating } = useCreateAgent({
    onSuccess: () => onClose(),
    onConflict: (msg) => setError('userId', { type: 'manual', message: msg }),
  });

  const isBusy = isSubmitting || isCreating;

  const onSubmit = (data: AgentFormValues): void => {
    // Validação client-side das cidades
    if (citiesValue.cityIds.length === 0) {
      setCitiesError('Ao menos uma cidade é obrigatória');
      return;
    }
    setCitiesError(undefined);

    createAgent({
      displayName: data.displayName,
      ...(data.phone ? { phone: data.phone } : {}),
      ...(data.userId ? { userId: data.userId } : {}),
      cityIds: citiesValue.cityIds,
      ...(citiesValue.primaryCityId ? { primaryCityId: citiesValue.primaryCityId } : {}),
    });
  };

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-5 px-6 py-6"
    >
      <Input
        id="agent-create-name"
        label="Nome do agente"
        placeholder="Ex: João Pedro Alves"
        required
        error={errors.displayName?.message}
        {...register('displayName')}
      />

      <Input
        id="agent-create-phone"
        type="tel"
        label="Telefone"
        placeholder="+55 69 9 9999-9999"
        hint="E.164 — opcional"
        error={errors.phone?.message}
        {...register('phone')}
      />

      {/* Usuário vinculado */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Usuário do sistema
        </label>
        <p className="font-sans text-xs text-ink-4">
          Vincula este agente a uma conta de login existente.
        </p>
        <Controller
          name="userId"
          control={control}
          render={({ field }) => (
            <UserCombobox
              value={field.value ?? null}
              onChange={field.onChange}
              {...(errors.userId?.message !== undefined ? { error: errors.userId.message } : {})}
            />
          )}
        />
      </div>

      {/* Cidades atendidas */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Cidades atendidas{' '}
          <span className="text-danger normal-case tracking-normal" aria-hidden="true">
            *
          </span>
        </label>
        <AgentCitiesSelect
          value={citiesValue}
          onChange={(v) => {
            setCitiesValue(v);
            if (v.cityIds.length > 0) setCitiesError(undefined);
          }}
          {...(citiesError !== undefined ? { error: citiesError } : {})}
        />
      </div>

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
          {isBusy ? 'Criando...' : 'Criar agente'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Form de edição
// ---------------------------------------------------------------------------

interface EditFormProps {
  agentId: string;
  agent: AgentResponse;
  onClose: () => void;
}

function EditAgentForm({ agentId, agent, onClose }: EditFormProps): React.JSX.Element {
  const { toast } = useToast();

  const [citiesValue, setCitiesValue] = React.useState<AgentCitiesValue>({
    cityIds: agent.cities.map((c) => c.city_id),
    primaryCityId: agent.primary_city_id,
  });
  const [citiesError, setCitiesError] = React.useState<string | undefined>(undefined);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AgentFormValues>({
    resolver: zodResolver(AgentFormSchema),
    defaultValues: {
      displayName: agent.display_name,
      phone: agent.phone ?? '',
      userId: agent.user_id,
    },
  });

  const { updateAgent, isPending: isUpdating } = useUpdateAgent({
    onConflict: (msg) => setError('userId', { type: 'manual', message: msg }),
  });

  const { setAgentCities, isPending: isSettingCities } = useSetAgentCities();

  const { deactivate: doDeactivate, isPending: isDeactivating } = useDeactivateAgent({
    onSuccess: () => onClose(),
    onConflict: (msg) => toast(msg, 'danger'),
  });

  const { reactivate: doReactivate, isPending: isReactivating } = useReactivateAgent({
    onSuccess: () => onClose(),
  });

  const isBusy = isSubmitting || isUpdating || isSettingCities || isDeactivating || isReactivating;
  const isActive = agent.is_active;

  const onSubmit = (data: AgentFormValues): void => {
    if (citiesValue.cityIds.length === 0) {
      setCitiesError('Ao menos uma cidade é obrigatória');
      return;
    }
    setCitiesError(undefined);

    // 1. Atualiza campos básicos
    updateAgent(agentId, {
      displayName: data.displayName,
      phone: data.phone || null,
      userId: data.userId ?? null,
    });

    // 2. Substitui cidades atomicamente
    setAgentCities(agentId, {
      cityIds: citiesValue.cityIds,
      ...(citiesValue.primaryCityId ? { primaryCityId: citiesValue.primaryCityId } : {}),
    });

    onClose();
  };

  function handleDeactivate(): void {
    if (
      window.confirm(
        `Desativar "${agent.display_name}"?\nSe este for o único agente ativo em alguma cidade com leads abertos, a operação será bloqueada pelo sistema.`,
      )
    ) {
      doDeactivate(agentId);
    }
  }

  function handleReactivate(): void {
    doReactivate(agentId);
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-5 px-6 py-6"
    >
      <Input
        id="agent-edit-name"
        label="Nome do agente"
        required
        error={errors.displayName?.message}
        {...register('displayName')}
      />

      <Input
        id="agent-edit-phone"
        type="tel"
        label="Telefone"
        placeholder="+55 69 9 9999-9999"
        hint="E.164 — opcional"
        error={errors.phone?.message}
        {...register('phone')}
      />

      {/* Usuário vinculado */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Usuário do sistema
        </label>
        <Controller
          name="userId"
          control={control}
          render={({ field }) => (
            <UserCombobox
              value={field.value ?? null}
              onChange={field.onChange}
              {...(errors.userId?.message !== undefined ? { error: errors.userId.message } : {})}
            />
          )}
        />
      </div>

      {/* Cidades atendidas */}
      <div className="flex flex-col gap-2">
        <label className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
          Cidades atendidas{' '}
          <span className="text-danger normal-case tracking-normal" aria-hidden="true">
            *
          </span>
        </label>
        <p className="font-sans text-xs text-ink-4">
          As cidades selecionadas substituirão completamente as cidades atuais do agente.
        </p>
        <AgentCitiesSelect
          value={citiesValue}
          onChange={(v) => {
            setCitiesValue(v);
            if (v.cityIds.length > 0) setCitiesError(undefined);
          }}
          {...(citiesError !== undefined ? { error: citiesError } : {})}
        />
      </div>

      {/* Footer actions */}
      <div className="flex flex-col gap-3 pt-1 border-t border-border-subtle">
        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isBusy}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isBusy || citiesValue.cityIds.length === 0}
            className="flex-1"
          >
            {isBusy ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>

        {/* Desativar / Reativar */}
        <div className="pt-1 border-t border-border-subtle">
          {isActive ? (
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center justify-center gap-2',
                'px-4 py-2.5 rounded-sm',
                'font-sans text-sm font-semibold text-danger',
                'border border-danger/30 hover:bg-danger/10',
                'transition-all duration-fast',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30',
              )}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3M8 11h.01" />
              </svg>
              {isDeactivating ? 'Desativando...' : 'Desativar agente'}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleReactivate}
              disabled={isBusy}
              className={cn(
                'w-full flex items-center justify-center gap-2',
                'px-4 py-2.5 rounded-sm',
                'font-sans text-sm font-semibold',
                'border transition-all duration-fast',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              )}
              style={{
                color: 'var(--success)',
                borderColor: 'color-mix(in srgb, var(--success) 30%, transparent)',
              }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M4 8a4 4 0 1 0 4-4" />
                <path d="M4 4v4h4" />
              </svg>
              {isReactivating ? 'Reativando...' : 'Reativar agente'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Drawer principal
// ---------------------------------------------------------------------------

export interface AgentDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Sem agentId → create; com → edit */
  agentId?: string | undefined;
  agent?: AgentResponse | undefined;
}

/**
 * Drawer lateral de criação / edição de agente de crédito.
 * Portal para z-index correto acima do layout.
 */
export function AgentDrawer({
  open,
  onClose,
  agentId,
  agent,
}: AgentDrawerProps): React.JSX.Element | null {
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

  const isEditMode = Boolean(agentId && agent);
  const title = isEditMode ? 'Editar agente' : 'Novo agente';

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
        aria-labelledby="agent-drawer-title"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-[160]',
          'w-full sm:max-w-[500px]',
          'flex flex-col',
          'border-l border-border',
          'overflow-y-auto',
        )}
        style={{
          background: 'var(--surface-1)',
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right 300ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <h2
            id="agent-drawer-title"
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
            className={cn(
              'w-8 h-8 flex items-center justify-center',
              'rounded-sm text-ink-3',
              'hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:ring-2 focus-visible:ring-azul/20 focus-visible:outline-none',
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
          {isEditMode && agentId && agent ? (
            <EditAgentForm agentId={agentId} agent={agent} onClose={onClose} />
          ) : (
            <CreateAgentForm onClose={onClose} />
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
