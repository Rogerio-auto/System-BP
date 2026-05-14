// =============================================================================
// features/admin/products/ProductDrawer.tsx — Drawer create / edit de produto.
//
// DS:
//   - Drawer lateral: z-[160], elev-5, entra da direita (translate-x).
//   - Form: React Hook Form + Zod.
//   - key: lowercase auto conforme o user digita o nome.
//   - is_active toggle: Controller (switch customizado, não input nativo).
//   - 409 conflict → erro inline no campo key.
//
// Props:
//   - open: boolean
//   - onClose: () => void
//   - productId?: string — sem productId = modo create, com = modo edit
//   - onCreated?: (id: string) => void — callback após criação bem-sucedida
//     (permite abrir o form de "Publicar primeira regra" no pai)
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { useCreateProduct, useUpdateProduct } from '../../../hooks/admin/useProducts';
import type { ProductCreate } from '../../../lib/api/credit-products';
import { getProduct } from '../../../lib/api/credit-products';
import { cn } from '../../../lib/cn';

// ---------------------------------------------------------------------------
// Schema Zod do form
// ---------------------------------------------------------------------------

const ProductFormSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo'),
  key: z
    .string()
    .min(3, 'key deve ter ao menos 3 caracteres')
    .max(60, 'key deve ter no máximo 60 caracteres')
    .regex(/^[a-z0-9_]+$/, 'key: apenas letras minúsculas, dígitos e underscores'),
  description: z.string().max(1000, 'Descrição muito longa').optional(),
  is_active: z.boolean(),
});

type ProductFormValues = z.infer<typeof ProductFormSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converte string livre em key snake_case lowercase.
 * Ex: "Microcrédito Básico" → "microcredito_basico"
 */
function nameToKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // espaços/especiais → _
    .replace(/^_+|_+$/g, '') // trim underscores
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Sub-componente: form interno
// ---------------------------------------------------------------------------

interface ProductFormProps {
  productId?: string | undefined;
  onClose: () => void;
  onCreated?: ((id: string) => void) | undefined;
}

function ProductForm({ productId, onClose, onCreated }: ProductFormProps): React.JSX.Element {
  const isEditMode = Boolean(productId);
  const [editLoading, setEditLoading] = React.useState(isEditMode);
  // Controla se a key foi editada manualmente (para não sobrescrever o que o user já mudou)
  const [keyTouched, setKeyTouched] = React.useState(false);

  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(ProductFormSchema),
    defaultValues: {
      name: '',
      key: '',
      description: '',
      is_active: true,
    },
  });

  // Prefill em modo edit
  React.useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    setEditLoading(true);
    getProduct(productId)
      .then((product) => {
        if (cancelled) return;
        reset({
          name: product.name,
          key: product.key,
          description: product.description ?? '',
          is_active: product.is_active,
        });
        setKeyTouched(true); // em edit, key já está definida — não re-gerar
      })
      .catch(() => {
        // silencia — user vê erro ao tentar salvar
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [productId, reset]);

  // Auto-gera key ao digitar o nome (só se o user ainda não tocou na key)
  const nameValue = watch('name');
  React.useEffect(() => {
    if (isEditMode || keyTouched) return;
    const generated = nameToKey(nameValue);
    setValue('key', generated, { shouldValidate: false });
  }, [nameValue, isEditMode, keyTouched, setValue]);

  const { createProduct: doCreate, isPending: isCreating } = useCreateProduct({
    onSuccess: (product) => {
      reset();
      setKeyTouched(false);
      onCreated?.(product.id);
      onClose();
    },
    onConflict: (msg) => setError('key', { type: 'manual', message: msg }),
  });

  const { updateProduct: doUpdate, isPending: isUpdating } = useUpdateProduct({
    onSuccess: () => onClose(),
    onConflict: (msg) => setError('key', { type: 'manual', message: msg }),
  });

  const isBusy = isSubmitting || isCreating || isUpdating || editLoading;

  const onSubmit = (data: ProductFormValues): void => {
    if (isEditMode && productId) {
      doUpdate(productId, {
        name: data.name,
        description: data.description ?? null,
        is_active: data.is_active,
      });
    } else {
      const createBody: ProductCreate = {
        name: data.name,
        key: data.key,
      };
      if (data.description) createBody.description = data.description;
      doCreate(createBody);
    }
  };

  if (editLoading) {
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
      {/* Nome */}
      <Input
        id="product-name"
        label="Nome do produto"
        placeholder="Ex: Microcrédito Básico"
        required
        error={errors.name?.message}
        {...register('name')}
      />

      {/* Key — auto-gerada mas editável */}
      <div className="flex flex-col gap-2">
        <Input
          id="product-key"
          label="Identificador único (key)"
          placeholder="Ex: microcredito_basico"
          hint={
            isEditMode
              ? 'A key não pode ser alterada após a criação.'
              : 'Gerado automaticamente. Apenas letras minúsculas, dígitos e underscores.'
          }
          error={errors.key?.message}
          disabled={isEditMode}
          {...register('key', {
            onChange: () => {
              if (!isEditMode) setKeyTouched(true);
            },
          })}
        />
        {/* Preview em Mono quando não é edit */}
        {!isEditMode && (
          <span className="font-mono text-xs text-azul px-1" style={{ letterSpacing: '-0.01em' }}>
            {watch('key') || '—'}
          </span>
        )}
      </div>

      {/* Descrição */}
      <div className="flex flex-col gap-2">
        <label
          htmlFor="product-description"
          className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]"
        >
          Descrição <span className="normal-case tracking-normal text-ink-4">(opcional)</span>
        </label>
        <textarea
          id="product-description"
          placeholder="Descreva brevemente os objetivos e público-alvo deste produto..."
          rows={3}
          className={cn(
            'w-full font-sans text-sm font-medium text-ink',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'placeholder:text-ink-4 resize-y',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
            errors.description && 'border-danger',
          )}
          {...register('description')}
        />
        {errors.description && (
          <span className="text-xs text-danger">{errors.description.message}</span>
        )}
      </div>

      {/* Toggle is_active — só visível em modo edit */}
      {isEditMode && (
        <Controller
          name="is_active"
          control={control}
          render={({ field }) => (
            <div className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                id="product-active"
                aria-checked={field.value}
                aria-label="Produto ativo"
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
                htmlFor="product-active"
                className="font-sans text-sm font-medium text-ink-2 cursor-pointer select-none"
              >
                {field.value ? 'Produto ativo' : 'Produto inativo'}
              </label>
            </div>
          )}
        />
      )}

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
          {isBusy
            ? isEditMode
              ? 'Salvando...'
              : 'Criando...'
            : isEditMode
              ? 'Salvar alterações'
              : 'Criar produto'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Drawer principal
// ---------------------------------------------------------------------------

interface ProductDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Sem productId → create; com → edit */
  productId?: string | undefined;
  /** Chamado após criação bem-sucedida (para abrir drawer de publicar regra) */
  onCreated?: ((id: string) => void) | undefined;
}

/**
 * Drawer lateral de criação / edição de produto de crédito.
 *
 * Entra da direita com slide + fade. Backdrop fecha ao clicar fora.
 * Portal para z-index correto acima do layout.
 */
export function ProductDrawer({
  open,
  onClose,
  productId,
  onCreated,
}: ProductDrawerProps): React.JSX.Element | null {
  // Fechar com Escape
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Bloquear scroll do body
  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const title = productId ? 'Editar produto' : 'Novo produto de crédito';

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

      {/* Drawer — entra da direita */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-drawer-title"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-[160]',
          'w-full sm:max-w-[440px]',
          'flex flex-col',
          'bg-surface-1 border-l border-border',
          'overflow-y-auto',
        )}
        style={{
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right 300ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <h2
            id="product-drawer-title"
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

        {/* Form */}
        <div className="flex-1">
          <ProductForm productId={productId} onClose={onClose} onCreated={onCreated} />
        </div>
      </div>
    </>,
    document.body,
  );
}
