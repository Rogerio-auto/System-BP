// =============================================================================
// features/customers/components/LawFirmReferralButton.tsx
//
// Botão "Encaminhar para Advocacia" + modal de confirmação (F19-S05).
//
// Regras de negócio:
//   - Visível apenas se useFeatureFlag('law_firm.referral.enabled') && hasPermission('law_firms:referral')
//   - Desabilitado com tooltip se cooldown ativo
//   - Badge na ficha quando cooldown ativo (escritório + data)
//
// Modal:
//   - Busca sugestão via GET /api/law-firms/suggest?customer_id=
//   - Fallback: dropdown com todos os escritórios da organização
//   - Campo opcional de observações
//   - React Hook Form + Zod
//   - Loading state durante envio
//
// DS (docs/18-design-system.md):
//   - Tokens canônicos — sem hex hardcoded
//   - var(--elev-5) no modal (hierarquia máxima)
//   - var(--elev-2) no badge e cards
//   - Hover: Glow para botão primário, Spotlight para cards
//   - Tipografia: Bricolage (headings), Geist (body), JetBrains Mono (datas/IDs)
//   - 4 estados em todo interativo: default, hover, active, focus visível, disabled
//
// LGPD (doc 17):
//   - customerId é UUID interno — não é PII direta
//   - notes: campo livre — operador é responsável por não incluir PII de terceiros
// =============================================================================

import type { LawFirmResponse } from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { useToast } from '../../../components/ui/Toast';
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { useAuthStore } from '../../../lib/auth-store';
import { cn } from '../../../lib/cn';
import type { LawFirmReferralBody } from '../api';
import { useCreateLawFirmReferral, useLawFirmSuggestion } from '../hooks/useLawFirmReferral';

// ---------------------------------------------------------------------------
// Form schema
// ---------------------------------------------------------------------------

const ReferralFormSchema = z.object({
  law_firm_id: z.string().uuid('Selecione um escritório'),
  notes: z.string().max(1000, 'Máximo 1000 caracteres').optional(),
});

type ReferralForm = z.infer<typeof ReferralFormSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface LawFirmReferralButtonProps {
  customerId: string;
  customerName?: string;
}

// ---------------------------------------------------------------------------
// Ícone de advocacia
// ---------------------------------------------------------------------------

function ScaleIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M8 2v12" />
      <path d="M3 14h10" />
      <path d="M3 5l2.5 5H.5L3 5z" />
      <path d="M13 5l2.5 5h-5L13 5z" />
      <path d="M5.5 2h5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Badge de encaminhamento ativo
// ---------------------------------------------------------------------------

interface ReferralBadgeProps {
  lawFirmName: string;
  cooldownUntil: string;
}

function ReferralBadge({ lawFirmName, cooldownUntil }: ReferralBadgeProps): React.JSX.Element {
  const formattedDate = React.useMemo(() => {
    try {
      return new Date(cooldownUntil).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return cooldownUntil;
    }
  }, [cooldownUntil]);

  return (
    <div
      className={cn('flex items-center gap-2 px-3 py-2 rounded-sm', 'border border-border-strong')}
      style={{ boxShadow: 'var(--elev-2)', background: 'var(--bg-elev-2)' }}
      aria-label={`Encaminhado para ${lawFirmName}. Cooldown até ${formattedDate}`}
    >
      <ScaleIcon
        className="w-4 h-4 shrink-0"
        style={{ color: 'var(--brand-azul)' } as React.CSSProperties}
      />
      <div className="min-w-0">
        <p
          className="font-sans font-semibold text-ink"
          style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.02em' }}
        >
          {lawFirmName}
        </p>
        <p className="font-sans text-ink-3" style={{ fontSize: '0.65rem' }}>
          Cooldown até{' '}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
            {formattedDate}
          </span>
        </p>
      </div>
      <Badge variant="info">Encaminhado</Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface ReferralModalProps {
  customerId: string;
  customerName?: string;
  suggestion: LawFirmResponse | null;
  allFirms: LawFirmResponse[];
  isLoadingFirms: boolean;
  onClose: () => void;
  onSuccess: (data: { referral_id: string; cooldown_until: string; law_firm_name: string }) => void;
}

function ReferralModal({
  customerId,
  customerName,
  suggestion,
  allFirms,
  isLoadingFirms,
  onClose,
  onSuccess,
}: ReferralModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { mutate: submitReferral, isPending } = useCreateLawFirmReferral();

  // Erro inline (cooldown ou outro)
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ReferralForm>({
    resolver: zodResolver(ReferralFormSchema),
    defaultValues: {
      law_firm_id: suggestion?.id ?? '',
      notes: '',
    },
  });

  const selectedFirmId = watch('law_firm_id');

  // Opções para o select: sugestão primeiro, depois os demais sem duplicar
  const firmOptions = React.useMemo(() => {
    if (allFirms.length === 0 && suggestion) {
      return [{ value: suggestion.id, label: `${suggestion.name} (sugerido)` }];
    }

    const suggested = suggestion
      ? [{ value: suggestion.id, label: `${suggestion.name} (sugerido)` }]
      : [];

    const rest = allFirms
      .filter((f) => f.id !== suggestion?.id)
      .map((f) => ({ value: f.id, label: f.name }));

    return [...suggested, ...rest];
  }, [suggestion, allFirms]);

  const selectedFirmName = React.useMemo(() => {
    if (!selectedFirmId) return '';
    const firm = allFirms.find((f) => f.id === selectedFirmId) ?? suggestion;
    return firm?.name ?? '';
  }, [selectedFirmId, allFirms, suggestion]);

  // Fechar com Escape
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !isPending) onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, isPending]);

  const onSubmit = (values: ReferralForm): void => {
    setInlineError(null);

    const body: LawFirmReferralBody = { law_firm_id: values.law_firm_id };
    if (values.notes) body.notes = values.notes;

    submitReferral(
      { customerId, body },
      {
        onSuccess: (data) => {
          onSuccess({
            referral_id: data.referral_id,
            cooldown_until: data.cooldown_until,
            law_firm_name: selectedFirmName,
          });
        },
        onError: (err) => {
          if (err.featureDisabled) {
            toast(err.message, 'info');
            onClose();
          } else {
            setInlineError(err.message);
          }
        },
      },
    );
  };

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(10, 18, 40, 0.50)' }}
        aria-hidden="true"
        onClick={() => {
          if (!isPending) onClose();
        }}
      />

      {/* Modal panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="referral-modal-title"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-[480px] mx-4',
          'flex flex-col',
          'rounded-md border border-border',
          'overflow-hidden',
        )}
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          animation: 'fade-up var(--dur-normal, 200ms) var(--ease-out) both',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <div className="flex items-center gap-2">
            <ScaleIcon
              className="w-5 h-5"
              style={{ color: 'var(--brand-azul)' } as React.CSSProperties}
            />
            <h2
              id="referral-modal-title"
              className="font-display font-bold text-ink"
              style={{
                fontSize: 'var(--text-lg)',
                letterSpacing: '-0.03em',
                fontVariationSettings: "'opsz' 20",
              }}
            >
              Encaminhar para advocacia
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Fechar modal"
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-sm',
              'text-ink-3 hover:text-ink hover:bg-surface-hover',
              'transition-all duration-[150ms] ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              'disabled:opacity-40 disabled:pointer-events-none',
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
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-5 flex flex-col gap-4">
          {/* Contexto */}
          {customerName && (
            <p className="font-sans text-sm text-ink-2">
              Encaminhando <span className="font-semibold text-ink">{customerName}</span> para um
              escritório de advocacia.
            </p>
          )}

          {/* Select de escritório */}
          {isLoadingFirms ? (
            <div
              className="h-11 rounded-sm animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
              aria-label="Carregando escritórios..."
            />
          ) : firmOptions.length === 0 ? (
            <div
              className="flex items-center gap-2 px-3 py-3 rounded-sm border border-border"
              style={{ background: 'var(--bg-elev-2)' }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4 shrink-0 text-ink-3"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 7v4M8 5.5v.5" />
              </svg>
              <p className="font-sans text-sm text-ink-3">
                Nenhum escritório cadastrado.{' '}
                <a
                  href="/configuracoes"
                  className="text-azul hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-azul/40 rounded-xs"
                >
                  Cadastre um escritório
                </a>{' '}
                antes de encaminhar.
              </p>
            </div>
          ) : (
            <Select
              id="referral-law-firm"
              label="Escritório de advocacia"
              required
              options={firmOptions}
              placeholder="Selecione um escritório..."
              error={errors.law_firm_id?.message}
              {...register('law_firm_id')}
            />
          )}

          {/* Sugestão visual quando selecionado */}
          {selectedFirmId && selectedFirmId === suggestion?.id && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-xs"
              style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border-subtle)' }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4 shrink-0"
                style={{ color: 'var(--brand-verde)' }}
                aria-hidden="true"
              >
                <path d="M3 8l3.5 3.5 6.5-7" />
              </svg>
              <p className="font-sans text-xs text-ink-2">
                Escritório sugerido para a cidade do cliente.
              </p>
            </div>
          )}

          {/* Campo de observações */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="referral-notes"
              className="font-sans text-xs font-semibold text-ink-2 uppercase"
              style={{ letterSpacing: '0.1em' }}
            >
              Observações <span className="font-normal text-ink-4 normal-case">(opcional)</span>
            </label>
            <textarea
              id="referral-notes"
              rows={3}
              placeholder="Descreva o motivo do encaminhamento, histórico relevante..."
              maxLength={1000}
              aria-describedby={errors.notes ? 'notes-error' : undefined}
              aria-invalid={errors.notes ? true : undefined}
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
                errors.notes &&
                  'border-danger focus:border-danger focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              )}
              {...register('notes')}
            />
            {errors.notes && (
              <span id="notes-error" role="alert" className="text-xs text-danger">
                {errors.notes.message}
              </span>
            )}
          </div>

          {/* Erro inline (ex: cooldown) */}
          {inlineError && (
            <div
              className="flex items-start gap-2 px-3 py-2.5 rounded-xs"
              role="alert"
              style={{
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger)',
                borderLeftWidth: 3,
              }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4 shrink-0 mt-px"
                style={{ color: 'var(--danger)' }}
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v4M8 11v.5" />
              </svg>
              <p className="font-sans text-sm text-ink">{inlineError}</p>
            </div>
          )}

          {/* Ações */}
          <div className="flex gap-2 pt-1">
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
              variant="primary"
              disabled={isPending || firmOptions.length === 0}
              className="flex-1"
              leftIcon={
                isPending ? (
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className="w-4 h-4 animate-spin"
                    aria-hidden="true"
                  >
                    <circle cx="8" cy="8" r="6" strokeOpacity={0.25} />
                    <path d="M14 8a6 6 0 0 0-6-6" />
                  </svg>
                ) : undefined
              }
            >
              {isPending ? 'Encaminhando...' : 'Confirmar encaminhamento'}
            </Button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * LawFirmReferralButton — botão + badge de encaminhamento para advocacia.
 *
 * Coloca-se na ficha do cliente inadimplente (CrmDetailPage quando customer_id
 * está disponível). Respeita feature flag + permissão RBAC.
 *
 * Gerencia internamente:
 *   - Estado de cooldown ativo (badge + botão desabilitado)
 *   - Modal de seleção de escritório
 *   - Toast de sucesso
 */
export function LawFirmReferralButton({
  customerId,
  customerName,
}: LawFirmReferralButtonProps): React.JSX.Element | null {
  const { enabled: flagEnabled } = useFeatureFlag('law_firm.referral.enabled');
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canReferral = hasPermission('law_firms:referral');

  const { toast } = useToast();
  const [modalOpen, setModalOpen] = React.useState(false);
  const [referralState, setReferralState] = React.useState<{
    law_firm_name: string;
    cooldown_until: string;
  } | null>(null);

  const {
    suggestion,
    allFirms,
    isLoading: loadingFirms,
  } = useLawFirmSuggestion(modalOpen || referralState !== null ? customerId : '');

  const cooldownLabel = React.useMemo(() => {
    if (!referralState?.cooldown_until) return '';
    try {
      return new Date(referralState.cooldown_until).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return referralState.cooldown_until;
    }
  }, [referralState]);

  // Não renderiza nada se flag ou permissão ausentes — DEVE vir após todos os hooks
  if (!flagEnabled || !canReferral) return null;

  const hasCooldown = Boolean(referralState?.cooldown_until);

  const handleSuccess = (data: {
    referral_id: string;
    cooldown_until: string;
    law_firm_name: string;
  }): void => {
    setReferralState({
      law_firm_name: data.law_firm_name,
      cooldown_until: data.cooldown_until,
    });
    setModalOpen(false);
    toast(`Cliente encaminhado para ${data.law_firm_name}.`, 'success');
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        {/* Badge de encaminhamento ativo */}
        {hasCooldown && referralState && (
          <ReferralBadge
            lawFirmName={referralState.law_firm_name}
            cooldownUntil={referralState.cooldown_until}
          />
        )}

        {/* Botão de encaminhamento */}
        <div className="relative inline-block">
          <Button
            variant="outline"
            size="sm"
            disabled={hasCooldown}
            aria-disabled={hasCooldown}
            aria-describedby={hasCooldown ? 'referral-cooldown-tip' : undefined}
            onClick={() => {
              if (!hasCooldown) setModalOpen(true);
            }}
            leftIcon={<ScaleIcon className="w-4 h-4" />}
          >
            Encaminhar para advocacia
          </Button>

          {/* Tooltip de cooldown — aparece ao hover quando desabilitado */}
          {hasCooldown && (
            <span
              id="referral-cooldown-tip"
              role="tooltip"
              className={cn(
                'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10',
                'whitespace-nowrap px-2.5 py-1.5 rounded-xs',
                'font-sans text-xs text-ink-2',
                'pointer-events-none select-none',
                'opacity-0 group-hover:opacity-100',
                'transition-opacity duration-fast',
              )}
              style={{
                background: 'var(--bg-elev-4, var(--bg-elev-3))',
                boxShadow: 'var(--elev-3)',
                border: '1px solid var(--border)',
              }}
            >
              Já encaminhado — disponível em{' '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>{cooldownLabel}</span>
            </span>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <ReferralModal
          customerId={customerId}
          {...(customerName !== undefined ? { customerName } : {})}
          suggestion={suggestion}
          allFirms={allFirms}
          isLoadingFirms={loadingFirms}
          onClose={() => setModalOpen(false)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  );
}
