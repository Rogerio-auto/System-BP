// =============================================================================
// features/quick-replies/admin/QuickReplyBasicFields.tsx — Título, atalho,
// categoria e visibilidade (F28-S07).
//
// `visibility` só renderiza para quem tem `manage` (doc 25 §5, regra 5) — sem
// `manage` o campo some e o valor é forçado para 'personal' no submit (ver
// QuickReplyForm.tsx).
// =============================================================================

import * as React from 'react';
import { Controller, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';

import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';

import type { QuickReplyFormValues } from './formSchema';
import { sanitizeShortcutInput } from './shortcut';

interface QuickReplyBasicFieldsProps {
  register: UseFormRegister<QuickReplyFormValues>;
  control: Control<QuickReplyFormValues>;
  errors: FieldErrors<QuickReplyFormValues>;
  canManage: boolean;
}

export function QuickReplyBasicFields({
  register,
  control,
  errors,
  canManage,
}: QuickReplyBasicFieldsProps): React.JSX.Element {
  return (
    <>
      <Input
        id="qr-title"
        label="Título"
        required
        error={errors.title?.message}
        {...register('title')}
      />

      <Input
        id="qr-shortcut"
        label="Atalho"
        placeholder="Ex: orientacao-documentos"
        required
        hint='Digitado no chat como "/orientacao-documentos" para filtrar rápido.'
        error={errors.shortcut?.message}
        {...register('shortcut', {
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
            e.target.value = sanitizeShortcutInput(e.target.value);
          },
        })}
      />

      <Input
        id="qr-category"
        label="Categoria"
        placeholder="Ex: Documentação, Prazos, Saudação"
        hint="Opcional — agrupa a resposta no seletor do composer."
        error={errors.category?.message}
        {...register('category')}
      />

      {canManage && (
        <Controller
          name="visibility"
          control={control}
          render={({ field }) => (
            <Select
              id="qr-visibility"
              label="Visibilidade"
              options={[
                { value: 'organization', label: 'Organização — visível para toda a equipe' },
                { value: 'personal', label: 'Pessoal — só você' },
              ]}
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
            />
          )}
        />
      )}
    </>
  );
}
