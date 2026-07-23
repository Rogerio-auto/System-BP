// =============================================================================
// features/quick-replies/admin/QuickReplyForm.tsx — Formulário de criação /
// edição de resposta rápida (F28-S07, doc 25 §11.2).
//
// Molde: features/admin/products/ProductDrawer.tsx (RHF + zodResolver, schema
// LOCAL para ergonomia de formulário — ver formSchema.ts).
//
// Sub-componentes em arquivos separados (linhas < 200, DS §"anti-padrões"):
// QuickReplyBasicFields.tsx (título/atalho/categoria/visibilidade),
// QuickReplyBodySection.tsx (corpo/variáveis/mídia/preview),
// QuickReplyActiveToggle.tsx (switch ativo/inativo).
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { useAuth } from '../../../lib/auth-store';
import { useCreateQuickReply, useQuickReply, useUpdateQuickReply } from '../index';
import type { QuickReplyCreate, QuickReplyUploadResult } from '../types';

import { mapQuickReplyMutationError } from './errors';
import { QuickReplyFormSchema, type QuickReplyFormValues } from './formSchema';
import { QuickReplyActiveToggle } from './QuickReplyActiveToggle';
import { QuickReplyBasicFields } from './QuickReplyBasicFields';
import { QuickReplyBodySection } from './QuickReplyBodySection';
import { QuickReplyCitiesSelect } from './QuickReplyCitiesSelect';
import { computeQuickReplyVariableHint } from './variableHint';

interface QuickReplyFormProps {
  quickReplyId?: string | undefined;
  canManage: boolean;
  onClose: () => void;
}

export function QuickReplyForm({
  quickReplyId,
  canManage,
  onClose,
}: QuickReplyFormProps): React.JSX.Element {
  const isEditMode = Boolean(quickReplyId);
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: existing, isLoading: isLoadingExisting } = useQuickReply(quickReplyId);

  const [body, setBody] = React.useState('');
  const [media, setMedia] = React.useState<QuickReplyUploadResult | null>(null);
  const [cityIds, setCityIds] = React.useState<string[]>([]);
  const sortOrderRef = React.useRef(0);
  const [bodyServerError, setBodyServerError] = React.useState<string | undefined>(undefined);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<QuickReplyFormValues>({
    resolver: zodResolver(QuickReplyFormSchema),
    defaultValues: {
      title: '',
      shortcut: '',
      category: '',
      isActive: true,
      visibility: canManage ? 'organization' : 'personal',
    },
  });

  // Prefill em modo edição
  React.useEffect(() => {
    if (!existing) return;
    reset({
      title: existing.title,
      shortcut: existing.shortcut,
      category: existing.category ?? '',
      isActive: existing.isActive,
      visibility: existing.visibility,
    });
    setBody(existing.body ?? '');
    setCityIds(existing.cityIds);
    sortOrderRef.current = existing.sortOrder;
    if (existing.mediaUrl && existing.mediaMime && existing.mediaKind) {
      setMedia({
        mediaUrl: existing.mediaUrl,
        mediaMime: existing.mediaMime,
        mediaKind: existing.mediaKind,
        mediaSizeBytes: existing.mediaSizeBytes ?? 0,
        mediaFileName: existing.mediaFileName ?? 'arquivo',
      });
    } else {
      setMedia(null);
    }
  }, [existing, reset]);

  const createMutation = useCreateQuickReply();
  const updateMutation = useUpdateQuickReply();
  const isBusy =
    isSubmitting || createMutation.isPending || updateMutation.isPending || isLoadingExisting;

  const onSubmit = async (values: QuickReplyFormValues): Promise<void> => {
    clearErrors('shortcut');
    setBodyServerError(undefined);

    const trimmedBody = body.trim();
    const hasBody = trimmedBody.length > 0;
    const hasMedia = media !== null;

    if (!hasBody && !hasMedia) {
      setBodyServerError('Informe um corpo de texto ou anexe uma mídia.');
      return;
    }

    if (hasBody) {
      const hint = computeQuickReplyVariableHint(trimmedBody);
      if (hint) {
        setBodyServerError(hint.message);
        return;
      }
    }

    const payload: QuickReplyCreate = {
      visibility: canManage ? values.visibility : 'personal',
      shortcut: values.shortcut,
      title: values.title,
      body: hasBody ? trimmedBody : null,
      category:
        values.category && values.category.trim().length > 0 ? values.category.trim() : null,
      mediaUrl: media?.mediaUrl ?? null,
      mediaMime: media?.mediaMime ?? null,
      mediaKind: media?.mediaKind ?? null,
      mediaSizeBytes: media?.mediaSizeBytes ?? null,
      mediaFileName: media?.mediaFileName ?? null,
      cityIds,
      isActive: values.isActive,
      sortOrder: sortOrderRef.current,
    };

    try {
      if (isEditMode && quickReplyId) {
        // `QuickReplyCreate` é estruturalmente compatível com `QuickReplyUpdate`
        // (mesmos campos, aqui todos preenchidos) — sem cast, ver types.ts.
        await updateMutation.mutateAsync({ id: quickReplyId, body: payload });
        toast('Resposta rápida atualizada.', 'success');
      } else {
        await createMutation.mutateAsync(payload);
        toast('Resposta rápida criada.', 'success');
      }
      onClose();
    } catch (err) {
      const fieldError = mapQuickReplyMutationError(err);
      if (fieldError?.field === 'shortcut') {
        setError('shortcut', { type: 'server', message: fieldError.message });
      } else if (fieldError?.field === 'body') {
        setBodyServerError(fieldError.message);
      } else {
        toast(err instanceof Error ? err.message : 'Erro ao salvar resposta rápida.', 'danger');
      }
    }
  };

  if (isLoadingExisting) {
    return (
      <div className="flex flex-col gap-3 px-6 py-6">
        {Array.from({ length: 4 }).map((_, i) => (
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

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-5 px-6 py-6"
    >
      <QuickReplyBasicFields
        register={register}
        control={control}
        errors={errors}
        canManage={canManage}
      />

      <div className="flex flex-col gap-2">
        <span className="font-sans text-sm font-semibold text-ink tracking-[-0.005em]">
          Cidades
        </span>
        <QuickReplyCitiesSelect value={cityIds} onChange={setCityIds} disabled={isBusy} />
      </div>

      <QuickReplyBodySection
        body={body}
        onBodyChange={(v) => {
          setBody(v);
          if (bodyServerError) setBodyServerError(undefined);
        }}
        bodyError={bodyServerError}
        media={media}
        onMediaChange={setMedia}
        agentName={user?.fullName ?? ''}
        disabled={isBusy}
      />

      <Controller
        name="isActive"
        control={control}
        render={({ field }) => (
          <QuickReplyActiveToggle
            checked={field.value}
            onChange={field.onChange}
            disabled={isBusy}
          />
        )}
      />

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
          {isBusy ? 'Salvando...' : isEditMode ? 'Salvar alterações' : 'Criar resposta rápida'}
        </Button>
      </div>
    </form>
  );
}
