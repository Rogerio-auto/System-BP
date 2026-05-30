// =============================================================================
// features/templates/TemplatesListPage.tsx — Lista paginada de templates WhatsApp.
//
// Contexto: F5-S09.
//
// Funcionalidades:
//   - Lista paginada com filtros: status, categoria
//   - Botão "Sincronizar tudo" (gated por templates:sync)
//   - Banner quando followup.enabled=disabled
//   - Status badges semânticos (DS §9.5)
//   - Estados: loading (skeleton), empty, error
//   - Hover Lift nos cards de linha
//
// DS: tokens canônicos, sem hex, elevation, tipografia canônica.
// =============================================================================
import * as React from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../../lib/auth-store';
import { cn } from '../../lib/cn';

import { TemplateStatusBadge } from './components/TemplateStatusBadge';
import { useTemplates, useSyncAllTemplates } from './hooks/useTemplates';
import type { TemplateCategory, TemplateFilters, TemplateStatus } from './schemas';

// ─── Banner de aviso (followup desabilitado) ──────────────────────────────────

function FollowupDisabledBanner(): React.JSX.Element {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-md border-l-4"
      style={{
        borderLeftColor: 'var(--brand-amarelo)',
        background: 'var(--warning-bg)',
        boxShadow: 'var(--elev-1)',
      }}
      role="status"
      aria-live="polite"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-5 h-5 shrink-0 mt-0.5"
        style={{ color: 'var(--warning)' }}
        aria-hidden="true"
      >
        <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
      <div>
        <p
          className="font-sans font-semibold"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}
        >
          Envios de follow-up desabilitados
        </p>
        <p
          className="font-sans mt-0.5"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--text-2)' }}
        >
          Você pode gerenciar o catálogo de templates agora. Os envios automáticos só ocorrem quando
          a feature flag{' '}
          <code
            className="px-1 py-0.5 rounded"
            style={{
              background: 'var(--surface-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.85em',
            }}
          >
            followup.enabled
          </code>{' '}
          estiver ativa.
        </p>
      </div>
    </div>
  );
}

// ─── Skeleton de carregamento ─────────────────────────────────────────────────

function TableSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md overflow-hidden border animate-pulse"
      style={{ boxShadow: 'var(--elev-2)', borderColor: 'var(--border)' }}
    >
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-6 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elev-1)' }}
        >
          <div className="h-4 rounded flex-1" style={{ background: 'var(--surface-muted)' }} />
          <div className="h-4 rounded w-24" style={{ background: 'var(--surface-muted)' }} />
          <div className="h-4 rounded w-16" style={{ background: 'var(--surface-muted)' }} />
          <div className="h-5 rounded w-20" style={{ background: 'var(--surface-muted)' }} />
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <svg
        viewBox="0 0 48 48"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        className="w-12 h-12"
        style={{ color: 'var(--text-4)' }}
        aria-hidden="true"
      >
        <rect x="6" y="6" width="36" height="36" rx="4" />
        <path d="M16 20h16M16 28h10" strokeLinecap="round" />
        <circle
          cx="36"
          cy="36"
          r="8"
          fill="var(--success-bg)"
          stroke="var(--success)"
          strokeWidth="1.5"
        />
        <path
          d="M33 36l2 2 4-4"
          stroke="var(--success)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="text-center">
        <p
          className="font-sans font-semibold"
          style={{ fontSize: 'var(--text-base)', color: 'var(--text)' }}
        >
          Nenhum template encontrado
        </p>
        <p
          className="mt-1 font-sans"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}
        >
          Crie o primeiro template para começar a usar o follow-up automático.
        </p>
      </div>
      <Link
        to="/admin/templates/new"
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md font-sans font-semibold transition-all duration-[150ms] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)]"
        style={{
          background: 'var(--grad-azul)',
          color: 'var(--text-on-brand)',
          boxShadow: 'var(--elev-2), inset 0 1px 0 rgba(255,255,255,0.15)',
          fontSize: 'var(--text-sm)',
        }}
      >
        Criar template
      </Link>
    </div>
  );
}

// ─── TemplatesListPage ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  utility: 'Utilidade',
  marketing: 'Marketing',
  authentication: 'Autenticação',
};

const STATUS_OPTIONS: { value: TemplateStatus | ''; label: string }[] = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendente' },
  { value: 'approved', label: 'Aprovado' },
  { value: 'rejected', label: 'Rejeitado' },
  { value: 'paused', label: 'Pausado' },
];

const CATEGORY_OPTIONS: { value: TemplateCategory | ''; label: string }[] = [
  { value: '', label: 'Todas as categorias' },
  { value: 'utility', label: 'Utilidade' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'authentication', label: 'Autenticação' },
];

export function TemplatesListPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const [filters, setFilters] = React.useState<TemplateFilters>({ page: 1, limit: 20 });

  const { data, isLoading, isError, error, refetch } = useTemplates(filters);
  const { syncAll, isPending: isSyncing } = useSyncAllTemplates({
    onSuccess: () => void refetch(),
  });

  // TODO: ler feature flag followup.enabled — por ora mostra banner como MVP
  const followupDisabled = true;

  const canSync = hasPermission('templates:sync');
  const canWrite = hasPermission('templates:write');

  return (
    <div className="flex flex-col gap-6 pb-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
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
            Templates WhatsApp
          </h1>
          <p
            className="mt-1.5 font-sans"
            style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}
          >
            Gerencie os templates aprovados pela Meta para envio de follow-up.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canSync && (
            <button
              type="button"
              onClick={() => syncAll()}
              disabled={isSyncing}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 rounded-md',
                'font-sans text-sm font-medium border',
                'transition-all duration-[150ms]',
                'hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-[rgba(27,58,140,0.2)]',
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
              {isSyncing ? 'Sincronizando…' : 'Sincronizar tudo'}
            </button>
          )}
          {canWrite && (
            <Link
              to="/admin/templates/new"
              className={cn(
                'inline-flex items-center gap-1.5 px-4 py-2 rounded-md',
                'font-sans font-semibold text-sm',
                'transition-all duration-[150ms]',
                'hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2',
                'focus-visible:ring-[rgba(27,58,140,0.2)]',
              )}
              style={{
                background: 'var(--grad-azul)',
                color: 'var(--text-on-brand)',
                boxShadow: 'var(--elev-2), inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
              Novo template
            </Link>
          )}
        </div>
      </div>

      {/* Banner followup desabilitado */}
      {followupDisabled && <FollowupDisabledBanner />}

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filters.status ?? ''}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              page: 1,
              status: (e.target.value as TemplateStatus) || undefined,
            }))
          }
          className="px-3 py-2 rounded-md border font-sans text-sm focus:outline-none"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-elev-1)',
            color: 'var(--text)',
            boxShadow: 'var(--elev-1)',
            fontSize: 'var(--text-sm)',
          }}
          aria-label="Filtrar por status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={filters.category ?? ''}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              page: 1,
              category: (e.target.value as TemplateCategory) || undefined,
            }))
          }
          className="px-3 py-2 rounded-md border font-sans text-sm focus:outline-none"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--bg-elev-1)',
            color: 'var(--text)',
            boxShadow: 'var(--elev-1)',
            fontSize: 'var(--text-sm)',
          }}
          aria-label="Filtrar por categoria"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <TableSkeleton />
      ) : isError ? (
        <div
          className="flex flex-col items-center gap-3 py-12"
          style={{ color: 'var(--danger)' }}
          role="alert"
        >
          <p className="font-sans text-sm">
            Erro ao carregar templates: {error?.message ?? 'Erro desconhecido'}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-sans text-sm underline"
            style={{ color: 'var(--brand-azul)' }}
          >
            Tentar novamente
          </button>
        </div>
      ) : !data || data.data.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          className="rounded-md overflow-hidden border"
          style={{
            background: 'var(--bg-elev-1)',
            boxShadow: 'var(--elev-2)',
            borderColor: 'var(--border)',
          }}
        >
          {/* Header da tabela */}
          <div
            className="grid px-6 py-3 border-b"
            style={{
              gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
              background: 'var(--bg-elev-2)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            {['Nome', 'Categoria', 'Idioma', 'Status', 'Ações'].map((col) => (
              <span
                key={col}
                className="font-sans font-bold uppercase"
                style={{
                  fontSize: '0.65rem',
                  letterSpacing: '0.1em',
                  color: 'var(--text-3)',
                }}
              >
                {col}
              </span>
            ))}
          </div>

          {/* Linhas */}
          {data.data.map((tmpl) => (
            <div
              key={tmpl.id}
              className="grid px-6 py-4 border-b items-center transition-colors duration-[100ms]"
              style={{
                gridTemplateColumns: '2fr 1fr 1fr 1fr auto',
                borderColor: 'var(--border-subtle)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <div>
                <Link
                  to={`/admin/templates/${tmpl.id}`}
                  className="font-sans font-medium hover:underline transition-colors duration-[100ms]"
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--brand-azul)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.color = 'var(--text)';
                  }}
                >
                  {tmpl.name}
                </Link>
                <p
                  className="mt-0.5 font-sans truncate"
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', maxWidth: '280px' }}
                >
                  {tmpl.body.slice(0, 60)}
                  {tmpl.body.length > 60 && '…'}
                </p>
              </div>

              <span
                className="font-sans"
                style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
              >
                {CATEGORY_LABELS[tmpl.category] ?? tmpl.category}
              </span>

              <span
                className="font-mono"
                style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
              >
                {tmpl.language}
              </span>

              <TemplateStatusBadge status={tmpl.status} />

              <Link
                to={`/admin/templates/${tmpl.id}`}
                className={cn(
                  'inline-flex items-center gap-1 px-3 py-1.5 rounded border',
                  'font-sans text-xs font-medium',
                  'transition-all duration-[150ms]',
                  'hover:-translate-y-0.5 focus-visible:outline-none',
                  'focus-visible:ring-2 focus-visible:ring-[rgba(27,58,140,0.2)]',
                )}
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--bg-elev-1)',
                  color: 'var(--text-2)',
                  boxShadow: 'var(--elev-1)',
                }}
              >
                Ver
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Paginação */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="font-sans text-sm" style={{ color: 'var(--text-3)' }}>
            {data.total} template{data.total !== 1 && 's'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={filters.page === 1}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
              className="px-3 py-1.5 rounded border font-sans text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 transition-all duration-[150ms]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-elev-1)',
                color: 'var(--text-2)',
              }}
              aria-label="Página anterior"
            >
              ←
            </button>
            <span className="font-sans text-sm" style={{ color: 'var(--text-2)' }}>
              {filters.page} / {data.totalPages}
            </span>
            <button
              type="button"
              disabled={filters.page === data.totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
              className="px-3 py-1.5 rounded border font-sans text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5 transition-all duration-[150ms]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-elev-1)',
                color: 'var(--text-2)',
              }}
              aria-label="Próxima página"
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
