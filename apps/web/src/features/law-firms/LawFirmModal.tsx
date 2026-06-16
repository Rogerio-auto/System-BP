// =============================================================================
// features/law-firms/LawFirmModal.tsx — Modal de criação/edição de escritório (F19-S04).
//
// DS:
//   - Overlay: fixed inset-0, bg-text/60, backdrop-blur-[4px].
//   - Painel: elev-5, rounded-md, max-w-lg, fade-up 200ms.
//   - Campos: Input canônico (elev interno), Label semântica.
//   - Botões: variant primary (criar) / outline (cancelar).
//   - Validação client-side: Zod (LawFirmCreateSchema) + RHF.
//   - Checkbox para is_default_for_city.
//   - Multi-select de cidades via chips (lista de cidades da API).
// =============================================================================

import type { LawFirmCreate, LawFirmResponse } from '@elemento/shared-schemas';
import { LawFirmCreateSchema } from '@elemento/shared-schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';

import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Label } from '../../components/ui/Label';
import { useToast } from '../../components/ui/Toast';
import { useCitiesList } from '../../hooks/useCitiesList';
import { cn } from '../../lib/cn';

import { useCreateLawFirm, useUpdateLawFirm } from './hooks';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LawFirmModalProps {
  /** undefined = modo criação; LawFirmResponse = modo edição */
  firm?: LawFirmResponse | null;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Phone mask helper (69) 9XXXX-XXXX
// ---------------------------------------------------------------------------

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

// ---------------------------------------------------------------------------
// City chip selector
// ---------------------------------------------------------------------------

interface CitySelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

function CitySelector({ selectedIds, onChange }: CitySelectorProps): React.JSX.Element {
  const { cities, isLoading } = useCitiesList();
  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q));
  }, [cities, search]);

  const toggle = (id: string): void => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectedCities = React.useMemo(
    () => cities.filter((c) => selectedIds.includes(c.id)),
    [cities, selectedIds],
  );

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="city-search">Cidades de cobertura</Label>

      {/* Selected chips */}
      {selectedCities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCities.map((city) => (
            <span
              key={city.id}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-sans font-medium',
                'transition-colors duration-[150ms]',
              )}
              style={{
                background: 'var(--brand-azul)',
                color: 'var(--text-on-brand)',
              }}
            >
              {city.name}
              <button
                type="button"
                onClick={() => toggle(city.id)}
                className="flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-white/20 transition-colors"
                aria-label={`Remover ${city.name}`}
              >
                <svg
                  viewBox="0 0 12 12"
                  fill="currentColor"
                  className="w-2.5 h-2.5"
                  aria-hidden="true"
                >
                  <path d="M3.293 3.293a1 1 0 011.414 0L6 4.586l1.293-1.293a1 1 0 111.414 1.414L7.414 6l1.293 1.293a1 1 0 01-1.414 1.414L6 7.414l-1.293 1.293a1 1 0 01-1.414-1.414L4.586 6 3.293 4.707a1 1 0 010-1.414z" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <input
        id="city-search"
        type="text"
        placeholder={isLoading ? 'Carregando cidades…' : 'Buscar cidade…'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={isLoading}
        className={cn(
          'w-full font-sans text-sm font-medium text-ink',
          'bg-surface-1 rounded-sm px-[14px] py-[9px]',
          'border border-border-strong',
          'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
          'transition-[border-color,box-shadow] duration-fast ease',
          'placeholder:text-ink-4',
          'hover:border-ink-3 hover:bg-surface-hover',
          'focus:outline-none focus:border-azul',
          'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      />

      {/* City list */}
      {search && filtered.length > 0 && (
        <div
          className="max-h-40 overflow-y-auto rounded-sm border border-border flex flex-col"
          style={{ background: 'var(--bg-elev-2)', boxShadow: 'var(--elev-2)' }}
        >
          {filtered.map((city) => {
            const isSelected = selectedIds.includes(city.id);
            return (
              <button
                key={city.id}
                type="button"
                onClick={() => toggle(city.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 text-sm font-sans text-left',
                  'transition-colors duration-[100ms]',
                  isSelected
                    ? 'bg-azul/10 text-azul font-medium'
                    : 'text-ink hover:bg-surface-hover',
                )}
              >
                <span
                  className={cn(
                    'flex items-center justify-center w-4 h-4 rounded border flex-shrink-0',
                    isSelected ? 'border-azul bg-azul' : 'border-border-strong bg-surface-1',
                  )}
                  aria-hidden="true"
                >
                  {isSelected && (
                    <svg
                      viewBox="0 0 12 12"
                      fill="currentColor"
                      className="w-3 h-3 text-white"
                      aria-hidden="true"
                    >
                      <path
                        d="M10 3L5 8.5 2 5.5"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  )}
                </span>
                <span>{city.name}</span>
                <span className="ml-auto text-xs text-ink-4">{city.state_uf}</span>
              </button>
            );
          })}
        </div>
      )}

      {search && filtered.length === 0 && !isLoading && (
        <p className="text-xs text-ink-3 px-1">Nenhuma cidade encontrada.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function LawFirmModal({ firm, onClose }: LawFirmModalProps): React.JSX.Element {
  const { toast } = useToast();
  const { mutate: createFirm, isPending: isCreating } = useCreateLawFirm();
  const { mutate: updateFirm, isPending: isUpdating } = useUpdateLawFirm();
  const isPending = isCreating || isUpdating;
  const isEditing = Boolean(firm);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
  } = useForm<LawFirmCreate>({
    resolver: zodResolver(LawFirmCreateSchema),
    defaultValues: {
      name: firm?.name ?? '',
      contact_phone: firm?.contact_phone ?? undefined,
      coverage_city_ids: firm?.coverage_city_ids ?? [],
      is_default_for_city: firm?.is_default_for_city ?? false,
      notes: firm?.notes ?? undefined,
    },
  });

  const coverageCityIds = watch('coverage_city_ids');

  const onSubmit = (data: LawFirmCreate): void => {
    if (isEditing && firm) {
      updateFirm(
        { id: firm.id, data },
        {
          onSuccess: () => {
            toast('Escritório atualizado com sucesso', 'success');
            onClose();
          },
          onError: (err) => {
            toast(`Erro ao atualizar: ${err.message}`, 'danger');
          },
        },
      );
    } else {
      createFirm(data, {
        onSuccess: () => {
          toast('Escritório criado com sucesso', 'success');
          onClose();
        },
        onError: (err) => {
          toast(`Erro ao criar: ${err.message}`, 'danger');
        },
      });
    }
  };

  // Trap focus + ESC close
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--text)]/60 backdrop-blur-[4px]"
      role="dialog"
      aria-modal="true"
      aria-label={isEditing ? 'Editar escritório de advocacia' : 'Novo escritório de advocacia'}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg rounded-md flex flex-col max-h-[90vh]"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          border: '1px solid var(--border)',
          animation: 'fade-up 200ms var(--ease-out) both',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.03em' }}
          >
            {isEditing ? 'Editar escritório' : 'Novo escritório de advocacia'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-3 hover:text-ink transition-colors rounded-sm focus-visible:ring-2 focus-visible:ring-azul/15 focus-visible:outline-none"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5" aria-hidden="true">
              <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
            </svg>
          </button>
        </div>

        {/* Scrollable form body */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="flex flex-col gap-5 px-6 py-5 overflow-y-auto"
        >
          {/* Nome */}
          <Input
            id="firm-name"
            label="Nome do escritório"
            required
            placeholder="Ex.: Souza & Associados Advocacia"
            error={errors.name?.message}
            {...register('name')}
          />

          {/* Telefone */}
          <Controller
            name="contact_phone"
            control={control}
            render={({ field }) => (
              <Input
                id="firm-phone"
                label="Telefone de contato"
                placeholder="(69) 99999-9999"
                hint="Dado público do escritório — não incluir celular pessoal."
                error={errors.contact_phone?.message}
                value={field.value ?? ''}
                onChange={(e) => {
                  const masked = maskPhone(e.target.value);
                  field.onChange(masked || undefined);
                }}
              />
            )}
          />

          {/* Cidades de cobertura */}
          <Controller
            name="coverage_city_ids"
            control={control}
            render={() => (
              <CitySelector
                selectedIds={coverageCityIds ?? []}
                onChange={(ids) => setValue('coverage_city_ids', ids, { shouldValidate: true })}
              />
            )}
          />
          {errors.coverage_city_ids && (
            <span className="text-xs text-danger -mt-3">{errors.coverage_city_ids.message}</span>
          )}

          {/* Escritório padrão */}
          <div className="flex items-start gap-3">
            <input
              id="firm-default"
              type="checkbox"
              className={cn(
                'mt-0.5 w-4 h-4 rounded-sm border border-border-strong',
                'accent-[var(--brand-azul)] cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/15',
              )}
              {...register('is_default_for_city')}
            />
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="firm-default">Escritório padrão para cidades de cobertura</Label>
              <p className="text-xs text-ink-3 font-sans">
                Quando ativo, este escritório é selecionado automaticamente para clientes das
                cidades marcadas acima.
              </p>
            </div>
          </div>

          {/* Notas */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="firm-notes">Notas internas</Label>
            <textarea
              id="firm-notes"
              rows={3}
              placeholder="Especialidades, horários, contatos secundários… Não incluir dados pessoais de clientes."
              className={cn(
                'w-full font-sans text-sm font-medium text-ink resize-none',
                'bg-surface-1 rounded-sm px-[14px] py-[11px]',
                'border border-border-strong',
                'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
                'transition-[border-color,box-shadow] duration-fast ease',
                'placeholder:text-ink-4',
                'hover:border-ink-3 hover:bg-surface-hover',
                'focus:outline-none focus:border-azul',
                'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
              )}
              {...register('notes')}
            />
            {errors.notes && <span className="text-xs text-danger">{errors.notes.message}</span>}
          </div>
        </form>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 shrink-0"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={isPending}
            onClick={handleSubmit(onSubmit)}
          >
            {isPending
              ? isEditing
                ? 'Salvando…'
                : 'Criando…'
              : isEditing
                ? 'Salvar alterações'
                : 'Criar escritório'}
          </Button>
        </div>
      </div>
    </div>
  );
}
