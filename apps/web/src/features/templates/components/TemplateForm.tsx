// =============================================================================
// features/templates/components/TemplateForm.tsx
//
// Formulário de criação e edição de templates WhatsApp.
// React Hook Form + Zod resolver.
// DS: tokens canônicos, sem hex, elevation, hover states.
// LGPD: validação DLP no schema rejeita CPF/email/telefone no body.
// =============================================================================
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/cn';
import type { TemplateCreateForm, TemplateResponse, TemplateUpdateForm } from '../schemas';
import {
  TemplateCategorySchema,
  TemplateCreateFormSchema,
  TemplateUpdateFormSchema,
} from '../schemas';

import { TemplatePreview } from './TemplatePreview';
import { TemplateVariablesInput } from './TemplateVariablesInput';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TemplateFormProps {
  /** Se presente, popula o form para edição. */
  initialValues?: Partial<TemplateResponse>;
  /** true se editando um template existente (modo edição). */
  isEdit?: boolean;
  onSubmit: (data: TemplateCreateForm | TemplateUpdateForm) => void;
  isPending?: boolean;
  /** Erro do servidor para exibir no form. */
  serverError?: string | null;
}

// ─── Campo de label ───────────────────────────────────────────────────────────

function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}): React.JSX.Element {
  return (
    <label
      htmlFor={htmlFor}
      className="block font-sans font-medium mb-1"
      style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
    >
      {children}
      {required && (
        <span aria-hidden="true" style={{ color: 'var(--danger)', marginLeft: 2 }}>
          *
        </span>
      )}
    </label>
  );
}

// ─── Input genérico ───────────────────────────────────────────────────────────

type FieldInputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  error?: string;
};

const FieldInput = React.forwardRef<HTMLInputElement, FieldInputProps>(function FieldInput(
  { id, error, ...props },
  ref,
) {
  return (
    <div className="flex flex-col gap-1">
      <input
        ref={ref}
        id={id}
        className={cn(
          'w-full px-3 py-2 rounded-sm border font-sans text-sm',
          'transition-all duration-[150ms]',
          'focus:outline-none',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error && 'border-danger',
        )}
        style={{
          borderColor: error ? 'var(--danger)' : 'var(--border-strong)',
          background: 'var(--bg-elev-1)',
          color: 'var(--text)',
          boxShadow: error
            ? 'inset 0 1px 2px var(--border-inner-dark), 0 0 0 3px rgba(200,52,31,0.12)'
            : 'inset 0 1px 2px var(--border-inner-dark)',
          fontSize: 'var(--text-sm)',
        }}
        onFocus={(e) => {
          if (!error) {
            e.currentTarget.style.borderColor = 'var(--brand-azul)';
            e.currentTarget.style.boxShadow =
              'inset 0 1px 2px var(--border-inner-dark), 0 0 0 3px rgba(27,58,140,0.15)';
          }
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          if (!error) {
            e.currentTarget.style.borderColor = 'var(--border-strong)';
            e.currentTarget.style.boxShadow = 'inset 0 1px 2px var(--border-inner-dark)';
          }
          props.onBlur?.(e);
        }}
        {...props}
      />
      {error && (
        <p className="font-sans text-xs" style={{ color: 'var(--danger)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
});

// ─── TemplateForm ─────────────────────────────────────────────────────────────

export function TemplateForm({
  initialValues,
  isEdit = false,
  onSubmit,
  isPending = false,
  serverError,
}: TemplateFormProps): React.JSX.Element {
  const schema = isEdit ? TemplateUpdateFormSchema : TemplateCreateFormSchema;

  // Justificativa do `as`: schema é discriminado por isEdit — tipo safe em runtime.
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<TemplateCreateForm>({
    resolver: zodResolver(schema as typeof TemplateCreateFormSchema),
    defaultValues: {
      name: initialValues?.name ?? '',
      category: initialValues?.category ?? 'utility',
      language: initialValues?.language ?? 'pt_BR',
      body: initialValues?.body ?? '',
      variables: initialValues?.variables ?? [],
    },
  });

  const watchedBody = watch('body') ?? '';
  const watchedVariables = watch('variables') ?? [];

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="flex flex-col gap-6"
      noValidate
    >
      {/* Nome (slug) — somente em criação */}
      {!isEdit && (
        <div>
          <FieldLabel htmlFor="template-name" required>
            Nome (slug interno)
          </FieldLabel>
          <FieldInput
            id="template-name"
            placeholder="ex: followup_d1"
            {...(errors.name?.message ? { error: errors.name.message } : {})}
            {...register('name')}
          />
          <p className="mt-1 font-sans text-xs" style={{ color: 'var(--text-4)' }}>
            Letras minúsculas, números e underscores. Ex: followup_d1
          </p>
        </div>
      )}

      {/* Categoria */}
      <div>
        <FieldLabel htmlFor="template-category" required={!isEdit}>
          Categoria
        </FieldLabel>
        <select
          id="template-category"
          className="w-full px-3 py-2 rounded-sm border font-sans text-sm focus:outline-none"
          style={{
            borderColor: 'var(--border-strong)',
            background: 'var(--bg-elev-1)',
            color: 'var(--text)',
            boxShadow: 'inset 0 1px 2px var(--border-inner-dark)',
            fontSize: 'var(--text-sm)',
          }}
          {...register('category')}
        >
          {TemplateCategorySchema.options.map((cat) => (
            <option key={cat} value={cat}>
              {cat === 'utility'
                ? 'Utilidade (transacional)'
                : cat === 'marketing'
                  ? 'Marketing'
                  : 'Autenticação'}
            </option>
          ))}
        </select>
        {errors.category?.message && (
          <p className="mt-1 font-sans text-xs" style={{ color: 'var(--danger)' }} role="alert">
            {errors.category.message}
          </p>
        )}
      </div>

      {/* Idioma */}
      <div>
        <FieldLabel htmlFor="template-language" required={!isEdit}>
          Idioma
        </FieldLabel>
        <FieldInput
          id="template-language"
          placeholder="pt_BR"
          {...(errors.language?.message ? { error: errors.language.message } : {})}
          {...register('language')}
        />
      </div>

      {/* Corpo */}
      <div>
        <FieldLabel htmlFor="template-body" required={!isEdit}>
          Corpo do template
        </FieldLabel>
        <textarea
          id="template-body"
          rows={5}
          placeholder="Olá {{1}}, sua proposta de crédito no valor de {{2}} está em análise."
          className={cn(
            'w-full px-3 py-2 rounded-sm border font-sans text-sm',
            'transition-all duration-[150ms] resize-y',
            'focus:outline-none',
          )}
          style={{
            borderColor: errors.body ? 'var(--danger)' : 'var(--border-strong)',
            background: 'var(--bg-elev-1)',
            color: 'var(--text)',
            boxShadow: errors.body
              ? 'inset 0 1px 2px var(--border-inner-dark), 0 0 0 3px rgba(200,52,31,0.12)'
              : 'inset 0 1px 2px var(--border-inner-dark)',
            fontSize: 'var(--text-sm)',
            minHeight: 100,
          }}
          onFocus={(e) => {
            if (!errors.body) {
              e.currentTarget.style.borderColor = 'var(--brand-azul)';
              e.currentTarget.style.boxShadow =
                'inset 0 1px 2px var(--border-inner-dark), 0 0 0 3px rgba(27,58,140,0.15)';
            }
          }}
          {...register('body', {
            onBlur: (e: React.FocusEvent<HTMLTextAreaElement>) => {
              if (!errors.body) {
                (e.currentTarget as HTMLTextAreaElement).style.borderColor = 'var(--border-strong)';
                (e.currentTarget as HTMLTextAreaElement).style.boxShadow =
                  'inset 0 1px 2px var(--border-inner-dark)';
              }
            },
          })}
        />
        {errors.body?.message && (
          <p className="mt-1 font-sans text-xs" style={{ color: 'var(--danger)' }} role="alert">
            {errors.body.message}
          </p>
        )}
        <p className="mt-1 font-sans text-xs" style={{ color: 'var(--text-4)' }}>
          Use {'{{1}}'}, {'{{2}}'}, etc. para variáveis. CPF, e-mail e telefone hardcoded são
          bloqueados pela política LGPD.
        </p>
      </div>

      {/* Preview */}
      <TemplatePreview body={watchedBody} variables={watchedVariables} />

      {/* Variáveis */}
      <div>
        <FieldLabel htmlFor="template-variables">Variáveis detectadas</FieldLabel>
        <TemplateVariablesInput
          body={watchedBody}
          value={watchedVariables}
          onChange={(vars) => setValue('variables', vars)}
        />
      </div>

      {/* Erro do servidor */}
      {serverError && (
        <div
          className="px-4 py-3 rounded-sm border-l-4 font-sans text-sm"
          style={{
            borderLeftColor: 'var(--danger)',
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
          }}
          role="alert"
        >
          {serverError}
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending} aria-busy={isPending}>
          {isPending
            ? isEdit
              ? 'Salvando…'
              : 'Criando…'
            : isEdit
              ? 'Salvar alterações'
              : 'Criar e enviar para aprovação'}
        </Button>
      </div>
    </form>
  );
}
