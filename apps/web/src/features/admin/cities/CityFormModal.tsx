// =============================================================================
// features/admin/cities/CityFormModal.tsx — Modal create / edit de cidade.
//
// DS:
//   - box-shadow: var(--elev-5) — hierarquia de modal (DS §9.6)
//   - Animação entrada: fade-up 300ms cubic-bezier(0.16,1,0.3,1) (igual NewLeadModal)
//   - Portal: createPortal(…, document.body) — z-index correto sobre o layout
//   - Form: React Hook Form + zodResolver(CityCreateSchema)
//   - 409 (slug/ibge_code dupe) → erro inline nos campos correspondentes
//   - Campos: name (required), state_uf (Select 27 UFs), ibge_code (opcional, 7d),
//             is_active (toggle via Controller)
//
// Props:
//   - Sem cityId → modo create (POST /api/admin/cities)
//   - Com cityId → modo edit (GET para prefill + PATCH)
//
// Nota de implementação: is_active usa Controller (não register nativo) porque
// botão switch não é um input HTML — RHF precisa do setValue/watch para o valor.
// =============================================================================

import type { CityCreate, CityResponse } from '@elemento/shared-schemas';
import { CityCreateSchema } from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { useCreateCity, useUpdateCity } from '../../../hooks/admin/useCityMutations';
import { getCity } from '../../../lib/api/cities';
import { cn } from '../../../lib/cn';

// ─── Lista de UFs brasileiras ─────────────────────────────────────────────────

const UF_OPTIONS = [
  { value: 'AC', label: 'AC — Acre' },
  { value: 'AL', label: 'AL — Alagoas' },
  { value: 'AP', label: 'AP — Amapá' },
  { value: 'AM', label: 'AM — Amazonas' },
  { value: 'BA', label: 'BA — Bahia' },
  { value: 'CE', label: 'CE — Ceará' },
  { value: 'DF', label: 'DF — Distrito Federal' },
  { value: 'ES', label: 'ES — Espírito Santo' },
  { value: 'GO', label: 'GO — Goiás' },
  { value: 'MA', label: 'MA — Maranhão' },
  { value: 'MT', label: 'MT — Mato Grosso' },
  { value: 'MS', label: 'MS — Mato Grosso do Sul' },
  { value: 'MG', label: 'MG — Minas Gerais' },
  { value: 'PA', label: 'PA — Pará' },
  { value: 'PB', label: 'PB — Paraíba' },
  { value: 'PR', label: 'PR — Paraná' },
  { value: 'PE', label: 'PE — Pernambuco' },
  { value: 'PI', label: 'PI — Piauí' },
  { value: 'RJ', label: 'RJ — Rio de Janeiro' },
  { value: 'RN', label: 'RN — Rio Grande do Norte' },
  { value: 'RS', label: 'RS — Rio Grande do Sul' },
  { value: 'RO', label: 'RO — Rondônia' },
  { value: 'RR', label: 'RR — Roraima' },
  { value: 'SC', label: 'SC — Santa Catarina' },
  { value: 'SP', label: 'SP — São Paulo' },
  { value: 'SE', label: 'SE — Sergipe' },
  { value: 'TO', label: 'TO — Tocantins' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface CityFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Quando presente: modo edit (preenche form com dados existentes). */
  cityId?: string | undefined;
}

// ─── Sub-componente de form ───────────────────────────────────────────────────

interface CityFormProps {
  cityId?: string | undefined;
  onClose: () => void;
}

function CityForm({ cityId, onClose }: CityFormProps): React.JSX.Element {
  const isEditMode = Boolean(cityId);
  const [editLoading, setEditLoading] = React.useState(isEditMode);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CityCreate>({
    resolver: zodResolver(CityCreateSchema),
    defaultValues: {
      name: '',
      state_uf: 'RO',
      ibge_code: undefined,
      aliases: [],
      is_active: true,
    },
  });

  // Prefill em modo edit
  React.useEffect(() => {
    if (!cityId) return;
    let cancelled = false;
    setEditLoading(true);
    getCity(cityId)
      .then((city: CityResponse) => {
        if (cancelled) return;
        reset({
          name: city.name,
          state_uf: city.state_uf,
          ibge_code: city.ibge_code ?? undefined,
          aliases: city.aliases,
          is_active: city.is_active,
        });
      })
      .catch(() => {
        // Silencia — o form permanece com defaults; usuario vê erro ao salvar.
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cityId, reset]);

  const handleConflict = (message: string): void => {
    if (message.toLowerCase().includes('ibge')) {
      setError('ibge_code', { type: 'manual', message });
    } else {
      setError('name', { type: 'manual', message });
    }
  };

  const { createCity: doCreate, isPending: isCreating } = useCreateCity({
    onSuccess: () => {
      reset();
      onClose();
    },
    onConflict: handleConflict,
  });

  const { updateCity: doUpdate, isPending: isUpdating } = useUpdateCity({
    onSuccess: () => {
      onClose();
    },
    onConflict: handleConflict,
  });

  const isBusy = isSubmitting || isCreating || isUpdating || editLoading;

  const onSubmit = (data: CityCreate): void => {
    if (isEditMode && cityId) {
      doUpdate(cityId, data);
    } else {
      doCreate(data);
    }
  };

  if (editLoading) {
    return (
      <div className="px-6 py-8">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-11 rounded-sm animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="px-6 py-5 flex flex-col gap-4"
    >
      {/* Nome */}
      <Input
        id="city-name"
        label="Nome do município"
        placeholder="Ex: Porto Velho"
        required
        error={errors.name?.message}
        {...register('name')}
      />

      {/* UF */}
      <Select
        id="city-uf"
        label="Estado (UF)"
        options={UF_OPTIONS}
        required
        error={errors.state_uf?.message}
        {...register('state_uf')}
      />

      {/* IBGE code */}
      <Input
        id="city-ibge"
        label="Código IBGE"
        placeholder="Ex: 1100205 (7 dígitos)"
        hint="Opcional. Único por organização quando informado."
        error={errors.ibge_code?.message}
        {...register('ibge_code')}
      />

      {/* Status ativo — Controller porque é switch customizado, não input nativo */}
      <Controller
        name="is_active"
        control={control}
        render={({ field }) => (
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              id="city-active"
              aria-checked={field.value}
              aria-label="Cidade ativa no atendimento"
              disabled={isBusy}
              onClick={() => field.onChange(!field.value)}
              className={cn(
                'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
                'border-2 border-transparent',
                'transition-colors duration-fast ease',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              style={{
                backgroundColor: field.value ? 'var(--brand-azul)' : 'var(--surface-muted)',
              }}
            >
              <span
                className="pointer-events-none block h-4 w-4 rounded-full bg-white transition-transform duration-fast ease"
                style={{
                  boxShadow: 'var(--elev-1)',
                  transform: field.value ? 'translateX(16px)' : 'translateX(0)',
                }}
                aria-hidden="true"
              />
            </button>
            <label
              htmlFor="city-active"
              className="font-sans text-sm font-medium text-ink-2 cursor-pointer select-none"
            >
              {field.value ? 'Ativa no atendimento' : 'Inativa (desabilitada)'}
            </label>
          </div>
        )}
      />

      {/* Footer */}
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
          {isBusy
            ? isEditMode
              ? 'Salvando...'
              : 'Criando...'
            : isEditMode
              ? 'Salvar alterações'
              : 'Criar cidade'}
        </Button>
      </div>
    </form>
  );
}

// ─── Modal principal ──────────────────────────────────────────────────────────

/**
 * Modal de criação / edição de cidade.
 * Sem cityId → create; com cityId → edit (prefill via GET /api/admin/cities/:id).
 *
 * Renderizado via createPortal para z-index correto acima do layout.
 */
export function CityFormModal({
  open,
  onClose,
  cityId,
}: CityFormModalProps): React.JSX.Element | null {
  // Fechar no Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Prevenir scroll do body
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const title = cityId ? 'Editar cidade' : 'Nova cidade';

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        role="presentation"
        aria-hidden="true"
        className="fixed inset-0 z-[150] bg-[var(--text)]/20 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Wrapper de centralização */}
      <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="city-modal-title"
          className={cn(
            'w-full max-w-md pointer-events-auto',
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
              id="city-modal-title"
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
                aria-hidden="true"
              >
                <path d="M5 5l10 10M15 5l-10 10" />
              </svg>
            </button>
          </div>

          <CityForm cityId={cityId} onClose={onClose} />
        </div>
      </div>
    </>,
    document.body,
  );
}
