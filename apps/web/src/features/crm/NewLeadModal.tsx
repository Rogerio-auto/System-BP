// =============================================================================
// features/crm/NewLeadModal.tsx — Modal para criar novo lead.
//
// DS:
//   - box-shadow: var(--elev-5) — hierarquia de modal (DS §9.6)
//   - Header: título em Bricolage + close button ghost
//   - Animação entrada: fade-up (DS §10.3)
//   - Form: React Hook Form + zodResolver(LeadCreateSchema) via shared-schemas
//   - Telefone E.164 validado client-side
//   - Submit: POST /api/leads → fecha modal + invalida useLeads + toast verde
//   - 409 LEAD_PHONE_DUPLICATE → erro inline no campo phone
//
// Decisão de UX: Modal (não drawer) — formulário simples (< 6 campos visíveis),
// criação é ação pontual que não requer contexto do lead existente.
// =============================================================================

import type { LeadCreate } from '@elemento/shared-schemas';
import { LeadCreateSchema } from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useCreateLead } from '../../hooks/crm/useCreateLead';
import { useCitiesList } from '../../hooks/useCitiesList';
import { cn } from '../../lib/cn';

// ─── Props ────────────────────────────────────────────────────────────────────

interface NewLeadModalProps {
  open: boolean;
  onClose: () => void;
}

// ─── Constantes de opções ─────────────────────────────────────────────────────

const SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'import', label: 'Importação' },
  { value: 'chatwoot', label: 'Chatwoot' },
  { value: 'api', label: 'API' },
];

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Modal de criação de lead.
 * Renderizado via createPortal para garantir z-index correto sobre o layout.
 */
export function NewLeadModal({ open, onClose }: NewLeadModalProps): React.JSX.Element | null {
  const { toast } = useToast();
  const { cities, isLoading: citiesLoading } = useCitiesList();

  const cityOptions = React.useMemo(
    () => cities.map((c) => ({ value: c.id, label: `${c.name} — ${c.state_uf}` })),
    [cities],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LeadCreate>({
    resolver: zodResolver(LeadCreateSchema),
    defaultValues: {
      source: 'manual',
      status: 'new',
    },
  });

  const { createLead, isPending } = useCreateLead({
    onSuccess: () => {
      toast('Lead criado com sucesso!', 'success');
      reset();
      onClose();
    },
    onDuplicatePhone: (message) => {
      setError('phone_e164', { type: 'manual', message });
    },
    onError: ({ message }) => {
      toast(message, 'danger');
    },
  });

  // Fechar no Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Prevenir scroll do body quando modal aberto
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const onSubmit = (data: LeadCreate): void => {
    createLead(data);
  };

  const isBusy = isSubmitting || isPending;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        aria-hidden="true"
        className="fixed inset-0 z-[150] bg-[var(--text)]/20 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Wrapper de centralização — flex evita conflito de transform com a animação fade-up */}
      <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          className={cn(
            'w-full max-w-lg pointer-events-auto',
            'rounded-lg border border-border',
            'bg-surface-1',
            'animate-[fade-up_300ms_cubic-bezier(0.16,1,0.3,1)_both]',
            'max-h-[calc(100vh-2rem)] overflow-y-auto',
          )}
          style={{ boxShadow: 'var(--elev-5)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
            <h2
              id="modal-title"
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-xl)',
                letterSpacing: '-0.03em',
                fontVariationSettings: "'opsz' 24",
              }}
            >
              Novo lead
            </h2>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar modal"
              className={cn(
                'w-8 h-8 flex items-center justify-center',
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
              >
                <path d="M5 5l10 10M15 5l-10 10" />
              </svg>
            </button>
          </div>

          {/* Form */}
          <form
            onSubmit={(e) => {
              void handleSubmit(onSubmit)(e);
            }}
            noValidate
            className="px-6 py-5 flex flex-col gap-4"
          >
            {/* Nome */}
            <Input
              id="lead-name"
              label="Nome completo"
              placeholder="Ex: Maria Aparecida Costa"
              required
              error={errors.name?.message}
              {...register('name')}
            />

            {/* Telefone E.164 */}
            <Input
              id="lead-phone"
              label="Telefone (E.164)"
              placeholder="+5569999999999"
              required
              hint="Formato internacional: +55 + DDD + número"
              error={errors.phone_e164?.message}
              {...register('phone_e164')}
            />

            {/* Email (opcional) */}
            <Input
              id="lead-email"
              label="E-mail"
              type="email"
              placeholder="opcional"
              error={errors.email?.message}
              {...register('email')}
            />

            {/* Cidade */}
            <Select
              id="lead-city"
              label="Cidade"
              placeholder={citiesLoading ? 'Carregando cidades...' : 'Selecione a cidade...'}
              options={cityOptions}
              required
              disabled={citiesLoading}
              error={errors.city_id?.message}
              {...register('city_id')}
            />

            {/* Canal de origem */}
            <Select
              id="lead-source"
              label="Canal de origem"
              options={SOURCE_OPTIONS}
              error={errors.source?.message}
              {...register('source')}
            />

            {/* Notas */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="lead-notes"
                className="font-sans text-xs font-semibold text-ink-2 uppercase tracking-[0.1em]"
              >
                Notas
              </label>
              <textarea
                id="lead-notes"
                rows={3}
                placeholder="Observações iniciais sobre o lead..."
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
                  'resize-none',
                )}
                {...register('notes')}
              />
            </div>

            {/* Footer com ações */}
            <div className="flex gap-3 pt-1">
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
                {isBusy ? 'Criando...' : 'Criar lead'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>,
    document.body,
  );
}
