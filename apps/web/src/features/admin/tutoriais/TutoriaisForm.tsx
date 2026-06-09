// =============================================================================
// features/admin/tutoriais/TutoriaisForm.tsx — Drawer create/edit de tutorial.
//
// DS §9 (Drawer = elev-5, slide-in-right, z-[160]).
// Form: React Hook Form + Zod espelhando a API (camelCase, F12-S12).
// Campos: featureKey (dropdown catálogo), provider, videoRef, hash (Vimeo),
//         description, articleSlug (autocomplete manifest), isActive, duration.
// Preview: <VideoTutorial eager> ao colar videoRef.
//
// Norma 21 §8 — acesso restrito a tutorials:manage.
// LGPD: sem PII no payload (título/descrição são textos editoriais).
//
// F12-S12: alinhado ao contrato camelCase da API — sem snake_case.
//          POST envia idempotencyKey gerado por crypto.randomUUID() por submit.
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { useToast } from '../../../components/ui/Toast';
import {
  useCreateTutorial,
  useFeatureKeys,
  useUpdateTutorial,
} from '../../../hooks/admin/useTutorials';
import type { TutorialResponse } from '../../../lib/api/tutorials';
import { cn } from '../../../lib/cn';
import { getHelpManifest } from '../../help/manifest';
import { VideoTutorial } from '../../help/mdx-components/VideoTutorial';

// ─── Schema Zod — espelha exatamente a API (norma 21 §9, camelCase) ──────────

export const TutorialFormSchema = z
  .object({
    featureKey: z.string().min(1, 'Selecione uma feature_key'),
    title: z.string().min(1, 'Título obrigatório').max(120),
    description: z.string().min(1, 'Descrição obrigatória').max(2000),
    provider: z.enum(['youtube', 'vimeo', 'mp4'], {
      errorMap: () => ({ message: 'Selecione o provider' }),
    }),
    videoRef: z.string().min(1, 'ID/URL do vídeo obrigatório').max(500),
    videoHash: z.string().max(256).optional(),
    articleSlug: z.string().max(300).optional(),
    durationSeconds: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() !== '' ? parseInt(v, 10) : undefined))
      .pipe(z.number().int().positive().optional()),
    isActive: z.boolean().default(true),
  })
  .refine(
    (d) => {
      // hash obrigatório para Vimeo
      if (d.provider === 'vimeo' && !d.videoHash) return false;
      return true;
    },
    { message: 'Hash é obrigatório para vídeos Vimeo', path: ['videoHash'] },
  );

// Tipo do form antes da coerção do durationSeconds
const TutorialFormRawSchema = z.object({
  featureKey: z.string().min(1, 'Selecione uma feature_key'),
  title: z.string().min(1, 'Título obrigatório').max(120),
  description: z.string().min(1, 'Descrição obrigatória').max(2000),
  provider: z.enum(['youtube', 'vimeo', 'mp4']),
  videoRef: z.string().min(1, 'ID/URL do vídeo obrigatório').max(500),
  videoHash: z.string().max(256).optional(),
  articleSlug: z.string().max(300).optional(),
  durationSeconds: z.string().optional(),
  isActive: z.boolean().default(true),
});

export type TutorialFormValues = z.infer<typeof TutorialFormRawSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROVIDER_OPTIONS = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'vimeo', label: 'Vimeo' },
  { value: 'mp4', label: 'MP4 (VPS)' },
];

// ─── ArticleSlugAutocomplete ──────────────────────────────────────────────────

interface ArticleSlugAutoProps {
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
}

function ArticleSlugAutocomplete({
  value,
  onChange,
  error,
}: ArticleSlugAutoProps): React.JSX.Element {
  const [suggestions, setSuggestions] = React.useState<Array<{ slug: string; title: string }>>([]);
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Carrega manifest on-demand (memoized internamente)
  React.useEffect(() => {
    if (!value || value.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    let cancelled = false;
    void getHelpManifest().then((m) => {
      if (cancelled) return;
      const q = value.toLowerCase();
      const results: Array<{ slug: string; title: string }> = [];
      for (const section of m.sections) {
        for (const article of section.articles) {
          if (article.slug.includes(q) || article.title.toLowerCase().includes(q)) {
            results.push({ slug: article.slug, title: article.title });
          }
          if (results.length >= 8) break;
        }
        if (results.length >= 8) break;
      }
      setSuggestions(results);
      setOpen(results.length > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);

  // Fechar ao clicar fora
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id="tutorial-article-slug"
        label="Artigo relacionado (articleSlug)"
        placeholder="guias/crm/criar-lead"
        hint="Slug relativo à Central de Ajuda. Digite para sugestões do manifest."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute z-10 left-0 right-0 mt-1 rounded-sm border border-border overflow-auto"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)', maxHeight: 200 }}
        >
          {suggestions.map((s) => (
            <button
              key={s.slug}
              type="button"
              className={cn(
                'flex items-start gap-3 w-full px-3 py-2 text-left',
                'hover:bg-surface-hover transition-colors duration-fast',
              )}
              onClick={() => {
                onChange(s.slug);
                setOpen(false);
              }}
            >
              <span className="font-mono text-xs text-ink-3 shrink-0 pt-px">{s.slug}</span>
              <span className="font-sans text-sm text-ink truncate">{s.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VideoPreview — preview do player ao digitar videoRef ────────────────────

interface VideoPreviewProps {
  provider: 'youtube' | 'vimeo' | 'mp4';
  videoRef: string;
  hash?: string | undefined;
}

function VideoPreview({ provider, videoRef, hash }: VideoPreviewProps): React.JSX.Element | null {
  // Só mostra se o ref parece válido (mínimo 3 chars)
  if (!videoRef || videoRef.trim().length < 3) return null;

  return (
    <div className="mt-1">
      <p
        className="font-sans font-bold uppercase text-ink-3 mb-2"
        style={{ fontSize: '0.7rem', letterSpacing: '0.1em' }}
      >
        Preview
      </p>
      <VideoTutorial
        provider={provider}
        videoRef={videoRef}
        {...(hash !== undefined ? { hash } : {})}
        title="Preview do tutorial"
        eager
      />
    </div>
  );
}

// ─── Form principal (criar / editar) ─────────────────────────────────────────

interface TutorialFormBodyProps {
  defaultValues: Partial<TutorialFormValues>;
  onSubmit: (data: TutorialFormValues) => void;
  onClose: () => void;
  isBusy: boolean;
  submitLabel: string;
  conflictError?: string | undefined;
}

function TutorialFormBody({
  defaultValues,
  onSubmit,
  onClose,
  isBusy,
  submitLabel,
  conflictError,
}: TutorialFormBodyProps): React.JSX.Element {
  const { featureKeys, isLoading: featureKeysLoading } = useFeatureKeys();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<TutorialFormValues>({
    resolver: zodResolver(TutorialFormRawSchema),
    defaultValues: {
      featureKey: '',
      title: '',
      description: '',
      provider: 'youtube',
      videoRef: '',
      videoHash: '',
      articleSlug: '',
      durationSeconds: '',
      isActive: true,
      ...defaultValues,
    },
  });

  // Propagar conflito de featureKey do hook
  React.useEffect(() => {
    if (conflictError) {
      setError('featureKey', { type: 'manual', message: conflictError });
    }
  }, [conflictError, setError]);

  const provider = useWatch({ control, name: 'provider' });
  const videoRef = useWatch({ control, name: 'videoRef' });
  const videoHash = useWatch({ control, name: 'videoHash' });
  const isActive = useWatch({ control, name: 'isActive' });

  const featureKeyOptions = [
    { value: '', label: 'Selecione uma feature_key' },
    ...featureKeys.map((k) => ({ value: k, label: k })),
  ];

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      noValidate
      className="flex flex-col gap-5 px-6 py-6"
    >
      {/* featureKey dropdown */}
      {featureKeysLoading ? (
        <div
          className="h-12 rounded-sm animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
          aria-hidden="true"
        />
      ) : (
        <Controller
          name="featureKey"
          control={control}
          render={({ field }) => (
            <Select
              id="tutorial-feature-key"
              label="Feature key"
              required
              options={featureKeyOptions}
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              error={errors.featureKey?.message}
              hint="Identificador da funcionalidade (catálogo fechado — nunca texto livre)"
            />
          )}
        />
      )}

      {/* title */}
      <Input
        id="tutorial-title"
        label="Título"
        placeholder="Ex: Como criar um lead no CRM"
        required
        error={errors.title?.message}
        {...register('title')}
      />

      {/* description */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="tutorial-description"
          className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
        >
          Descrição{' '}
          <span className="text-danger normal-case tracking-normal" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="tutorial-description"
          rows={3}
          placeholder="Resumo de 2-3 linhas exibido no drawer de ajuda contextual."
          aria-required="true"
          aria-invalid={Boolean(errors.description) || undefined}
          aria-describedby={errors.description ? 'tutorial-description-error' : undefined}
          className={cn(
            'w-full font-sans text-sm font-medium text-ink resize-y',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'placeholder:text-ink-4',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
            errors.description && [
              'border-danger',
              'focus:border-danger',
              'focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            ],
          )}
          {...register('description')}
        />
        {errors.description && (
          <span id="tutorial-description-error" role="alert" className="text-xs text-danger">
            {errors.description.message}
          </span>
        )}
      </div>

      {/* provider */}
      <Controller
        name="provider"
        control={control}
        render={({ field }) => (
          <Select
            id="tutorial-provider"
            label="Provider"
            required
            options={PROVIDER_OPTIONS}
            value={field.value}
            onChange={(e) => field.onChange(e.target.value as 'youtube' | 'vimeo' | 'mp4')}
            error={errors.provider?.message}
          />
        )}
      />

      {/* videoRef */}
      <Input
        id="tutorial-video-ref"
        label={
          provider === 'mp4'
            ? 'URL do vídeo MP4'
            : provider === 'vimeo'
              ? 'ID do vídeo no Vimeo'
              : 'ID do vídeo no YouTube'
        }
        placeholder={
          provider === 'mp4'
            ? '/videos/criar-lead.mp4'
            : provider === 'vimeo'
              ? '987654321'
              : 'dQw4w9WgXcQ'
        }
        required
        hint={
          provider === 'youtube'
            ? 'Use "Não listado" no YouTube — o "Privado" não embeda externamente.'
            : undefined
        }
        error={errors.videoRef?.message}
        {...register('videoRef')}
      />

      {/* videoHash (Vimeo apenas) */}
      {provider === 'vimeo' && (
        <Input
          id="tutorial-video-hash"
          label="Hash de privacidade (Vimeo)"
          placeholder="abc123xyz"
          required
          hint="Parâmetro `h` do Vimeo para vídeos com privacy=hide-from-vimeo."
          error={errors.videoHash?.message}
          {...register('videoHash')}
        />
      )}

      {/* Preview do player */}
      <VideoPreview provider={provider} videoRef={videoRef ?? ''} hash={videoHash} />

      {/* articleSlug autocomplete */}
      <Controller
        name="articleSlug"
        control={control}
        render={({ field }) => (
          <ArticleSlugAutocomplete
            value={field.value ?? ''}
            onChange={field.onChange}
            error={errors.articleSlug?.message}
          />
        )}
      />

      {/* durationSeconds */}
      <Input
        id="tutorial-duration"
        type="number"
        label="Duração (segundos)"
        placeholder="120"
        hint="Exibida como badge no drawer. Deixe vazio se desconhecida."
        error={errors.durationSeconds?.message}
        min={1}
        {...register('durationSeconds')}
      />

      {/* isActive toggle */}
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="font-sans text-sm font-semibold text-ink">Publicado</p>
          <p className="font-sans text-xs text-ink-3">
            Tutorial ativo aparece para usuários no drawer de ajuda.
          </p>
        </div>
        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <button
              type="button"
              role="switch"
              aria-checked={field.value}
              aria-label="Publicar tutorial"
              onClick={() => field.onChange(!field.value)}
              className={cn(
                'relative w-11 h-6 rounded-pill transition-colors duration-fast focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-azul/30',
                isActive ? 'bg-verde' : 'bg-surface-muted',
              )}
              style={{
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.15)',
              }}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 w-5 h-5 rounded-pill bg-white transition-transform duration-fast',
                  isActive ? 'translate-x-5' : 'translate-x-0',
                )}
                style={{
                  boxShadow: 'var(--elev-2)',
                }}
              />
            </button>
          )}
        />
      </div>

      {/* Footer */}
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
          {isBusy ? 'Salvando...' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ─── CreateForm ───────────────────────────────────────────────────────────────

interface CreateFormProps {
  onClose: () => void;
  onCreated?: ((result: TutorialResponse) => void) | undefined;
}

function CreateTutorialForm({ onClose, onCreated }: CreateFormProps): React.JSX.Element {
  const { toast } = useToast();
  const [conflictError, setConflictError] = React.useState<string | undefined>(undefined);

  const { createTutorial: doCreate, isPending } = useCreateTutorial({
    onSuccess: (result) => {
      toast('Tutorial criado com sucesso!', 'success');
      onCreated?.(result);
      onClose();
    },
    onConflict: (msg) => setConflictError(msg),
  });

  function handleSubmit(data: TutorialFormValues): void {
    setConflictError(undefined);
    doCreate({
      featureKey: data.featureKey,
      title: data.title,
      description: data.description,
      provider: data.provider,
      videoRef: data.videoRef,
      videoHash: data.videoHash || undefined,
      articleSlug: data.articleSlug || undefined,
      durationSeconds:
        data.durationSeconds && data.durationSeconds.trim() !== ''
          ? parseInt(data.durationSeconds, 10)
          : undefined,
      isActive: data.isActive,
      // Gera idempotencyKey único por submit para deduplicação de retry.
      idempotencyKey: crypto.randomUUID(),
    });
  }

  return (
    <TutorialFormBody
      defaultValues={{}}
      onSubmit={handleSubmit}
      onClose={onClose}
      isBusy={isPending}
      submitLabel="Criar tutorial"
      conflictError={conflictError}
    />
  );
}

// ─── EditForm ─────────────────────────────────────────────────────────────────

interface EditFormProps {
  tutorial: TutorialResponse;
  onClose: () => void;
}

function EditTutorialForm({ tutorial, onClose }: EditFormProps): React.JSX.Element {
  const { toast } = useToast();
  const [conflictError, setConflictError] = React.useState<string | undefined>(undefined);

  const { updateTutorial: doUpdate, isPending } = useUpdateTutorial({
    onSuccess: () => {
      toast('Tutorial atualizado.', 'success');
      onClose();
    },
    onConflict: (msg) => setConflictError(msg),
  });

  function handleSubmit(data: TutorialFormValues): void {
    setConflictError(undefined);
    doUpdate(tutorial.id, {
      title: data.title,
      description: data.description,
      provider: data.provider,
      videoRef: data.videoRef,
      videoHash: data.videoHash || undefined,
      articleSlug: data.articleSlug || undefined,
      durationSeconds:
        data.durationSeconds && data.durationSeconds.trim() !== ''
          ? parseInt(data.durationSeconds, 10)
          : undefined,
      isActive: data.isActive,
    });
  }

  return (
    <TutorialFormBody
      defaultValues={{
        featureKey: tutorial.featureKey,
        title: tutorial.title,
        description: tutorial.description,
        provider: tutorial.provider,
        videoRef: tutorial.videoRef,
        videoHash: tutorial.videoHash ?? '',
        articleSlug: tutorial.articleSlug ?? '',
        durationSeconds:
          tutorial.durationSeconds !== null && tutorial.durationSeconds !== undefined
            ? String(tutorial.durationSeconds)
            : '',
        isActive: tutorial.isActive,
      }}
      onSubmit={handleSubmit}
      onClose={onClose}
      isBusy={isPending}
      submitLabel="Salvar alterações"
      conflictError={conflictError}
    />
  );
}

// ─── Drawer principal ─────────────────────────────────────────────────────────

export interface TutoriaisDrawerProps {
  open: boolean;
  onClose: () => void;
  /** sem tutorial = create mode; com = edit mode */
  tutorial?: TutorialResponse | undefined;
  onCreated?: (result: TutorialResponse) => void;
}

/**
 * Drawer lateral (DS §9): elev-5, slide-in-right, z-[160].
 * Portal para z-index correto acima do layout.
 * Acessível: foco no abrir, Esc fecha, aria-modal.
 */
export function TutoriaisDrawer({
  open,
  onClose,
  tutorial,
  onCreated,
}: TutoriaisDrawerProps): React.JSX.Element | null {
  const isEditMode = tutorial !== undefined;
  const title = isEditMode ? 'Editar tutorial' : 'Novo tutorial';

  // Esc para fechar
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Bloquear scroll do body
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

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
        aria-labelledby="tutorial-drawer-title"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-[160]',
          'w-full sm:max-w-[520px]',
          'flex flex-col',
          'border-l border-border',
          'overflow-y-auto',
        )}
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right 300ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <h2
            id="tutorial-drawer-title"
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
          {isEditMode ? (
            <EditTutorialForm tutorial={tutorial} onClose={onClose} />
          ) : (
            <CreateTutorialForm onClose={onClose} onCreated={onCreated} />
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
