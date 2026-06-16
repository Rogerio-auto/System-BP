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
//   - 409 LEAD_EMAIL_DUPLICATE → erro inline no campo email (F14-S03)
//   - 422 LEAD_EMAIL_INTERNAL → erro inline no campo email (F14-S03)
//   - 422 INVALID_CNPJ → erro inline no campo cnpj (F18-S10)
//
// Campos F14-S03:
//   - email: required quando source='manual' (LeadCreateSchema superRefine)
//   - cnpj: opcional, máscara 00.000.000/0000-00
//   - legal_name: opcional, razão social da empresa
//
// Funcionalidades F18-S10:
//   - Hint anti-confusão no campo email
//   - Banner de alerta quando agente não tem personal_email cadastrado
//   - Erro inline INVALID_CNPJ
//
// Decisão de UX: Modal (não drawer) — formulário simples (< 6 campos visíveis),
// criação é ação pontual que não requer contexto do lead existente.
// Seção PJ colapsável para não poluir o fluxo PF (maioria dos leads).
// =============================================================================

import type { LeadCreate } from '@elemento/shared-schemas';
import { LeadCreateSchema } from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useToast } from '../../components/ui/Toast';
import { useCreateLead } from '../../hooks/crm/useCreateLead';
import { useCitiesList } from '../../hooks/useCitiesList';
import { useAuthStore } from '../../lib/auth-store';
import { cn } from '../../lib/cn';
import { getAccountProfile } from '../account/api';
import { ACCOUNT_PROFILE_QUERY_KEY } from '../account/usePersonalEmailGuard';

import { PersonalEmailModal } from './PersonalEmailModal';

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

// ─── Helpers de máscara ───────────────────────────────────────────────────────

/**
 * Aplica máscara de CNPJ: 00.000.000/0000-00
 * Aceita input com ou sem máscara e re-formata na digitação.
 */
function maskCnpj(value: string): string {
  // Strip tudo que não é dígito
  const digits = value.replace(/\D/g, '').slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12)
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * Modal de criação de lead.
 * Renderizado via createPortal para garantir z-index correto sobre o layout.
 */
export function NewLeadModal({ open, onClose }: NewLeadModalProps): React.JSX.Element | null {
  const { toast } = useToast();
  const { cities, isLoading: citiesLoading } = useCitiesList();

  // Estado local para controlar seção PJ
  const [showPjSection, setShowPjSection] = React.useState(false);

  // Estado local para valor de exibição com máscara (não vai ao RHF)
  const [cnpjDisplay, setCnpjDisplay] = React.useState('');

  // Estado para controlar abertura do PersonalEmailModal
  const [showPersonalEmailModal, setShowPersonalEmailModal] = React.useState(false);

  // Verifica se o agente está autenticado (para ativar a query de perfil)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Consulta o perfil para saber se personal_email está cadastrado.
  // staleTime=0 garante estado fresco no momento em que o modal abre.
  const { data: accountProfile } = useQuery({
    queryKey: ACCOUNT_PROFILE_QUERY_KEY,
    queryFn: getAccountProfile,
    enabled: isAuthenticated && open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // Mostra banner apenas quando o perfil já carregou E personal_email é null.
  // Quando accountProfile é undefined (query pendente), não exibe para evitar flash.
  const showPersonalEmailBanner =
    accountProfile !== undefined && accountProfile.personalEmail === null;

  const cityOptions = React.useMemo(
    () => cities.map((c) => ({ value: c.id, label: `${c.name} — ${c.state_uf}` })),
    [cities],
  );

  const {
    register,
    handleSubmit,
    reset,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LeadCreate>({
    resolver: zodResolver(LeadCreateSchema),
    defaultValues: {
      source: 'manual',
      status: 'new',
    },
  });

  const source = watch('source');
  const isManual = source === 'manual';

  const { createLead, isPending } = useCreateLead({
    onSuccess: () => {
      toast('Lead criado com sucesso!', 'success');
      reset();
      setCnpjDisplay('');
      setShowPjSection(false);
      onClose();
    },
    onDuplicatePhone: (message) => {
      setError('phone_e164', { type: 'manual', message });
    },
    onDuplicateEmail: () => {
      setError('email', {
        type: 'manual',
        message: 'Este email já está cadastrado nesta organização.',
      });
    },
    onInternalEmail: () => {
      setError('email', {
        type: 'manual',
        message: 'Este email pertence a um usuário interno. Informe o email real do cliente.',
      });
    },
    onInvalidCnpj: () => {
      setError('cnpj', {
        type: 'manual',
        message: 'CNPJ inválido. Verifique os dígitos informados.',
      });
      // Garante que a seção PJ esteja visível para o usuário ver o erro
      setShowPjSection(true);
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

  // Resetar seção PJ e estado do RHF ao fechar — [M2] reset() garante que
  // valores internos do RHF (ex.: cnpj) não persistam em reabertura.
  React.useEffect(() => {
    if (!open) {
      setCnpjDisplay('');
      setShowPjSection(false);
      reset();
    }
  }, [open, reset]);

  const onSubmit = (data: LeadCreate): void => {
    createLead(data);
  };

  const isBusy = isSubmitting || isPending;

  // PersonalEmailModal é sempre montado para permitir transições suaves.
  // A renderização do modal principal só ocorre quando open=true.
  const personalEmailModal = (
    <PersonalEmailModal
      open={showPersonalEmailModal}
      onClose={() => setShowPersonalEmailModal(false)}
    />
  );

  if (!open) {
    // Retorna apenas o modal de email pessoal para permitir animação de saída
    return personalEmailModal;
  }

  return (
    <>
      {personalEmailModal}
      {createPortal(
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
                {/* Banner de personal_email — não bloqueante.
                Aparece apenas quando o agente ainda não cadastrou o email pessoal.
                Informa que o campo é necessário para proteção dos dados de contato. */}
                {showPersonalEmailBanner && (
                  <div
                    className={cn(
                      'flex items-start gap-3 rounded-md px-4 py-3',
                      'border border-warning/30',
                      'bg-warning/8',
                    )}
                    role="alert"
                    aria-live="polite"
                  >
                    {/* Ícone de alerta */}
                    <span
                      className="mt-0.5 flex-none flex items-center justify-center w-5 h-5 rounded-full"
                      aria-hidden="true"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="var(--warning)"
                        strokeWidth={1.8}
                        className="w-4 h-4"
                      >
                        <path d="M10 3L2 17h16L10 3z" />
                        <path d="M10 9v4M10 15h.01" strokeLinecap="round" />
                      </svg>
                    </span>
                    {/* Texto */}
                    <div className="flex flex-col gap-1 min-w-0">
                      <p className="font-sans text-xs font-semibold text-ink-2 leading-snug">
                        Cadastre seu e-mail pessoal para proteger seus dados de contato
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowPersonalEmailModal(true)}
                        className={cn(
                          'font-sans text-xs font-semibold',
                          'text-azul underline underline-offset-2',
                          'hover:text-azul/80 transition-colors duration-fast ease',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-sm',
                          'w-fit',
                        )}
                      >
                        Cadastrar agora
                      </button>
                    </div>
                  </div>
                )}

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

                {/* Email — obrigatório para source=manual (LeadCreateSchema superRefine) */}
                <Input
                  id="lead-email"
                  label="E-mail"
                  type="email"
                  placeholder={isManual ? 'email@exemplo.com' : 'opcional'}
                  required={isManual}
                  hint="Use o email do cliente, não o seu email pessoal."
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

                {/* ── Seção Pessoa Jurídica (opcional) ─────────────────────────── */}
                <div className="flex flex-col gap-3">
                  {/* Toggle da seção PJ */}
                  <button
                    type="button"
                    onClick={() => setShowPjSection((v) => !v)}
                    aria-expanded={showPjSection}
                    aria-controls="pj-section"
                    className={cn(
                      'flex items-center gap-2 w-fit',
                      'text-xs font-semibold uppercase tracking-[0.08em]',
                      'text-ink-3 hover:text-ink',
                      'transition-colors duration-fast ease',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 rounded-sm',
                    )}
                  >
                    {/* Chevron rotativo */}
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      className={cn(
                        'w-3.5 h-3.5 transition-transform duration-200',
                        showPjSection && 'rotate-90',
                      )}
                      aria-hidden="true"
                    >
                      <path d="M6 4l4 4-4 4" />
                    </svg>
                    Pessoa Jurídica (opcional)
                  </button>

                  {/* Campos PJ — [M1] sempre no DOM; visibilidade via `hidden` para
                  manter o contrato aria-controls="pj-section" válido mesmo
                  quando recolhido. */}
                  <div
                    id="pj-section"
                    hidden={!showPjSection}
                    className={cn(
                      'flex flex-col gap-4',
                      'rounded-md border border-border-subtle',
                      'bg-surface-2 px-4 py-4',
                    )}
                    style={{ boxShadow: 'var(--elev-1)' }}
                  >
                    <p className="text-xs text-ink-3 leading-relaxed">
                      Preencha apenas se o lead representar uma empresa. CNPJ e razão social são
                      opcionais.
                    </p>

                    {/* CNPJ — com máscara controlada */}
                    <div className="flex flex-col gap-2">
                      <Input
                        id="lead-cnpj"
                        label="CNPJ"
                        placeholder="00.000.000/0000-00"
                        inputMode="numeric"
                        value={cnpjDisplay}
                        error={errors.cnpj?.message}
                        onChange={(e) => {
                          const masked = maskCnpj(e.target.value);
                          setCnpjDisplay(masked);
                          // Envia somente dígitos ao RHF — [L1] normalização canônica
                          // antes do submit; display com máscara fica em cnpjDisplay.
                          const digits = masked.replace(/\D/g, '');
                          setValue('cnpj', digits || null, { shouldValidate: true });
                        }}
                      />
                    </div>

                    {/* Razão social */}
                    <Input
                      id="lead-legal-name"
                      label="Razão social"
                      placeholder="Ex: Comercial Silva Ltda"
                      error={errors.legal_name?.message}
                      {...register('legal_name')}
                    />
                  </div>
                </div>

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
      )}
    </>
  );
}
