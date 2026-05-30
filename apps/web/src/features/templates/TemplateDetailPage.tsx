// =============================================================================
// features/templates/TemplateDetailPage.tsx — Detalhe + edição de template.
//
// Contexto: F5-S09.
// Rota: /admin/templates/:id
//
// Funcionalidades:
//   - Detalhe completo do template
//   - Edição inline (apenas pending/rejected)
//   - Botão "Sincronizar com Meta"
//   - Timeline de status (via updatedAt — histórico completo em slot futuro)
//   - Botão "Soft delete" (status=paused)
//   - Estados: loading (skeleton), error
// =============================================================================
import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAuth } from '../../lib/auth-store';
import { cn } from '../../lib/cn';

import { TemplateForm } from './components/TemplateForm';
import { TemplateStatusBadge } from './components/TemplateStatusBadge';
import {
  useDeleteTemplate,
  useSyncTemplate,
  useTemplate,
  useUpdateTemplate,
} from './hooks/useTemplates';
import type { TemplateUpdateForm } from './schemas';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function DetailSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 animate-pulse max-w-3xl">
      <div className="h-8 rounded w-1/2" style={{ background: 'var(--surface-muted)' }} />
      <div
        className="rounded-lg border p-6 flex flex-col gap-4"
        style={{ background: 'var(--bg-elev-1)', borderColor: 'var(--border)' }}
      >
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="h-3 rounded w-24" style={{ background: 'var(--surface-muted)' }} />
            <div className="h-5 rounded w-full" style={{ background: 'var(--surface-muted)' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Campo de detalhe readonly ────────────────────────────────────────────────

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span
        className="font-sans font-semibold uppercase tracking-widest"
        style={{ fontSize: '0.65rem', letterSpacing: '0.1em', color: 'var(--text-3)' }}
      >
        {label}
      </span>
      <div className="font-sans" style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
        {children}
      </div>
    </div>
  );
}

// ─── TemplateDetailPage ───────────────────────────────────────────────────────

export function TemplateDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();

  const [isEditMode, setIsEditMode] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const { data: template, isLoading, isError, error, refetch } = useTemplate(id ?? '');

  const { updateTemplate, isPending: isUpdating } = useUpdateTemplate(id ?? '', {
    onSuccess: () => {
      setIsEditMode(false);
      setServerError(null);
    },
    onError: (message) => setServerError(message),
  });

  const { syncTemplate, isPending: isSyncing } = useSyncTemplate(id ?? '', {
    onSuccess: () => void refetch(),
  });

  const { deleteTemplate, isPending: isDeleting } = useDeleteTemplate({
    onSuccess: () => void navigate('/admin/templates'),
  });

  const canWrite = hasPermission('templates:write');
  const canSync = hasPermission('templates:sync');
  const canDelete = hasPermission('templates:delete');

  const isEditable = template && (template.status === 'pending' || template.status === 'rejected');

  if (isLoading) return <DetailSkeleton />;

  if (isError || !template) {
    return (
      <div className="flex flex-col items-center gap-3 py-16" role="alert">
        <p className="font-sans text-sm" style={{ color: 'var(--danger)' }}>
          {error?.message ?? 'Template não encontrado.'}
        </p>
        <button
          type="button"
          onClick={() => void navigate(-1)}
          className="font-sans text-sm underline"
          style={{ color: 'var(--brand-azul)' }}
        >
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 pb-12 max-w-3xl">
      {/* Breadcrumb / back */}
      <button
        type="button"
        onClick={() => void navigate(-1)}
        className={cn(
          'inline-flex items-center gap-1 font-sans text-sm w-fit',
          'transition-colors duration-[150ms]',
          'focus-visible:outline-none focus-visible:ring-2',
          'focus-visible:ring-[rgba(27,58,140,0.2)] rounded',
        )}
        style={{ color: 'var(--text-3)' }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = 'var(--brand-azul)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
        }}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path d="M10 4L6 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Voltar para Templates
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1
            className="font-display font-bold"
            style={{
              fontSize: 'var(--text-2xl)',
              letterSpacing: '-0.035em',
              color: 'var(--text)',
              fontVariationSettings: "'opsz' 24",
            }}
          >
            {template.name}
          </h1>
          <TemplateStatusBadge status={template.status} />
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2 flex-wrap">
          {canSync && (
            <button
              type="button"
              onClick={() => syncTemplate()}
              disabled={isSyncing}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded border',
                'font-sans text-sm font-medium',
                'transition-all duration-[150ms]',
                'hover:-translate-y-0.5 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)]',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0',
              )}
              style={{
                background: 'var(--bg-elev-1)',
                borderColor: 'var(--border)',
                color: 'var(--text-2)',
                boxShadow: 'var(--elev-1)',
              }}
              aria-busy={isSyncing}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className={cn('w-4 h-4', isSyncing && 'animate-spin')}
                aria-hidden="true"
              >
                <path d="M13.7 2.3A7 7 0 1 0 15 8" strokeLinecap="round" />
                <path d="M15 2v4h-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {isSyncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>
          )}

          {canWrite && isEditable && !isEditMode && (
            <button
              type="button"
              onClick={() => setIsEditMode(true)}
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded',
                'font-sans font-semibold text-sm',
                'transition-all duration-[150ms]',
                'hover:-translate-y-0.5 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)]',
              )}
              style={{
                background: 'var(--grad-azul)',
                color: 'var(--text-on-brand)',
                boxShadow: 'var(--elev-2), inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
            >
              Editar
            </button>
          )}

          {canDelete && template.status !== 'paused' && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Pausar este template? Não será removido da Meta.')) {
                  deleteTemplate(template.id);
                }
              }}
              disabled={isDeleting}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded border',
                'font-sans text-sm font-medium',
                'transition-all duration-[150ms]',
                'hover:-translate-y-0.5 focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-[rgba(200,52,31,0.2)]',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              style={{
                background: 'var(--bg-elev-1)',
                borderColor: 'var(--danger)',
                color: 'var(--danger)',
                boxShadow: 'var(--elev-1)',
              }}
            >
              Pausar
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo — modo visualização */}
      {!isEditMode ? (
        <div
          className="rounded-lg border p-6 flex flex-col gap-5"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <DetailField label="Categoria">{template.category}</DetailField>
            <DetailField label="Idioma">{template.language}</DetailField>
            <DetailField label="Meta Template ID">
              <code
                className="font-mono text-xs px-1.5 py-0.5 rounded"
                style={{
                  background: 'var(--surface-muted)',
                  color: 'var(--text-2)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {template.metaTemplateId}
              </code>
            </DetailField>
          </div>

          <DetailField label="Corpo do template">
            <pre
              className="font-sans leading-relaxed whitespace-pre-wrap break-words rounded-md p-4 border mt-1"
              style={{
                background: 'var(--bg-elev-2)',
                borderColor: 'var(--border)',
                boxShadow: 'var(--elev-1)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text)',
              }}
            >
              {template.body}
            </pre>
          </DetailField>

          {template.variables.length > 0 && (
            <DetailField label="Variáveis">
              <div className="flex items-center gap-2 flex-wrap mt-1">
                {template.variables.map((v, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded"
                    style={{
                      background: 'rgba(27,58,140,0.08)',
                      color: 'var(--brand-azul)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                    }}
                  >
                    <span style={{ color: 'var(--text-3)' }}>{`{{${i + 1}}}`}</span>
                    {v}
                  </span>
                ))}
              </div>
            </DetailField>
          )}

          {/* Timeline de status (simplificada — data de atualização) */}
          <DetailField label="Última atualização">
            <span style={{ color: 'var(--text-2)' }}>
              {new Date(template.updatedAt).toLocaleString('pt-BR')}
            </span>
          </DetailField>
        </div>
      ) : (
        /* Modo edição */
        <div
          className="rounded-lg border p-6"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <p
              className="font-sans font-semibold"
              style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
            >
              Editando template
            </p>
            <button
              type="button"
              onClick={() => {
                setIsEditMode(false);
                setServerError(null);
              }}
              className="font-sans text-sm"
              style={{ color: 'var(--text-3)' }}
            >
              Cancelar
            </button>
          </div>

          <TemplateForm
            initialValues={template}
            isEdit
            onSubmit={(data) => updateTemplate(data as TemplateUpdateForm)}
            isPending={isUpdating}
            serverError={serverError}
          />
        </div>
      )}
    </div>
  );
}
