// =============================================================================
// features/templates/TemplateFormPage.tsx — Página de criação de template.
//
// Contexto: F5-S09.
// Rota: /admin/templates/new
// =============================================================================
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { cn } from '../../lib/cn';

import { TemplateForm } from './components/TemplateForm';
import { useCreateTemplate } from './hooks/useTemplates';
import type { TemplateCreateForm, TemplateUpdateForm } from './schemas';

export function TemplateFormPage(): React.JSX.Element {
  const navigate = useNavigate();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const { createTemplate, isPending } = useCreateTemplate({
    onSuccess: (data) => {
      void navigate(`/admin/templates/${data.id}`);
    },
    onError: (message) => {
      setServerError(message);
    },
  });

  const handleSubmit = (
    data: TemplateCreateForm | TemplateUpdateForm,
    sampleFile: File | null,
  ): void => {
    setServerError(null);
    // This page is always creation mode — data always contains 'name'.
    // The union is required by TemplateForm's onSubmit signature.
    // F5-S15 — passa sampleFile para o hook.
    createTemplate(data as TemplateCreateForm, sampleFile);
  };

  return (
    <div className="flex flex-col gap-6 pb-12 max-w-2xl">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={() => void navigate(-1)}
          className={cn(
            'inline-flex items-center gap-1 font-sans text-sm mb-4',
            'transition-colors duration-[150ms]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)] rounded',
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

        <h1
          className="font-display font-bold"
          style={{
            fontSize: 'var(--text-3xl)',
            letterSpacing: '-0.04em',
            lineHeight: '1',
            color: 'var(--text)',
            fontVariationSettings: "'opsz' 32",
          }}
        >
          Novo template
        </h1>
        <p
          className="mt-1.5 font-sans"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}
        >
          Crie um template e envie para aprovação da Meta. Após aprovado, pode ser usado em regras
          de follow-up.
        </p>
      </div>

      {/* Card do form */}
      <div
        className="rounded-lg border p-6"
        style={{
          background: 'var(--bg-elev-1)',
          boxShadow: 'var(--elev-2)',
          borderColor: 'var(--border)',
        }}
      >
        <TemplateForm onSubmit={handleSubmit} isPending={isPending} serverError={serverError} />
      </div>
    </div>
  );
}
