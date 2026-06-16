// =============================================================================
// features/crm/PersonalEmailModal.tsx — Modal para cadastrar/atualizar email
// pessoal do agente (F18-S10).
//
// Contexto:
//   Aberto a partir do banner de alerta no NewLeadModal quando
//   user.personal_email === null. Diferente do modal bloqueante de 1º login
//   (features/account/PersonalEmailModal) — este é dispensável e permite
//   também remover o email já cadastrado.
//
// DS:
//   - box-shadow: var(--elev-5) (modal sobre modal — hierarquia máxima)
//   - Header: título em Bricolage + close button ghost
//   - Tokens: sem hex hardcoded
//   - Animação entrada: fade-up (DS §10.3)
//
// LGPD: personalEmail é PII — nunca logar (doc 17 §8.1).
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { cn } from '../../lib/cn';

import { useUpdatePersonalEmail } from './hooks';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PersonalEmailModalProps {
  open: boolean;
  onClose: () => void;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface FormValues {
  personalEmail: string;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Modal dispensável para cadastrar ou remover o email pessoal do agente.
 * Renderizado via createPortal no topo da pilha de z-index (z-[200]).
 *
 * - "Salvar" envia o email preenchido.
 * - "Limpar" envia null (remove o email cadastrado).
 */
export function PersonalEmailModal({
  open,
  onClose,
}: PersonalEmailModalProps): React.JSX.Element | null {
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { personalEmail: '' },
  });

  const { updatePersonalEmail, isPending } = useUpdatePersonalEmail({
    onSuccess: () => {
      toast('E-mail pessoal atualizado', 'success');
      reset();
      onClose();
    },
    onError: (message) => {
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

  // Reset ao fechar
  React.useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  if (!open) return null;

  const isBusy = isSubmitting || isPending;

  const onSubmit = (values: FormValues): void => {
    updatePersonalEmail(values.personalEmail);
  };

  const handleClear = (): void => {
    updatePersonalEmail(null);
  };

  return createPortal(
    <>
      {/* Backdrop — z-[190] abaixo do modal mas acima do NewLeadModal (z-[160]) */}
      <div
        role="presentation"
        aria-hidden="true"
        className="fixed inset-0 z-[190] bg-[var(--text)]/30 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Wrapper de centralização */}
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="personal-email-modal-title"
          aria-describedby="personal-email-modal-desc"
          className={cn(
            'w-full max-w-md pointer-events-auto',
            'rounded-lg border border-border',
            'bg-surface-1',
            'animate-[fade-up_300ms_cubic-bezier(0.16,1,0.3,1)_both]',
          )}
          style={{ boxShadow: 'var(--elev-5)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle">
            {/* Ícone + título */}
            <div className="flex items-center gap-3">
              <span
                className="flex items-center justify-center w-9 h-9 rounded-md bg-surface-2 border border-border-subtle"
                aria-hidden="true"
                style={{ boxShadow: 'var(--elev-1)' }}
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="var(--brand-azul)"
                  strokeWidth={1.6}
                  className="w-4.5 h-4.5"
                  aria-hidden="true"
                >
                  <rect x="2" y="4" width="16" height="12" rx="1.5" />
                  <path d="M2 7l8 5 8-5" />
                </svg>
              </span>
              <h2
                id="personal-email-modal-title"
                className="font-display font-bold text-ink"
                style={{
                  fontSize: 'var(--text-lg)',
                  letterSpacing: '-0.025em',
                  fontVariationSettings: "'opsz' 20",
                }}
              >
                Seu e-mail pessoal
              </h2>
            </div>

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

          {/* Corpo */}
          <div className="px-6 py-5 flex flex-col gap-5">
            {/* Descrição */}
            <p
              id="personal-email-modal-desc"
              className="font-sans text-sm text-ink-3 leading-relaxed"
            >
              Usado para contato interno.{' '}
              <strong className="font-medium text-ink-2">
                Não será compartilhado com clientes.
              </strong>
            </p>

            {/* Formulário */}
            <form
              onSubmit={(e) => {
                void handleSubmit(onSubmit)(e);
              }}
              noValidate
              className="flex flex-col gap-4"
            >
              <Input
                id="crm-personal-email"
                type="email"
                label="E-mail pessoal"
                placeholder="nome@gmail.com"
                autoComplete="email"
                hint="Ex: maria.silva@gmail.com — não use um email do Banco do Povo."
                required
                error={errors.personalEmail?.message}
                {...register('personalEmail', {
                  required: 'Informe seu e-mail pessoal',
                  pattern: {
                    value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                    message: 'Informe um e-mail válido',
                  },
                })}
              />

              {/* Ações */}
              <div className="flex gap-3 pt-1">
                {/* Limpar — remove o email cadastrado (envia null) */}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isBusy}
                  onClick={handleClear}
                  className="flex-none"
                >
                  Limpar
                </Button>

                <Button type="submit" variant="primary" disabled={isBusy} className="flex-1">
                  {isBusy ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
