// =============================================================================
// features/configuracoes/ai-console/prompts/PromptsListPage.tsx
//
// Lista de prompt keys com:
//   - Coluna key, versão ativa em destaque (chip), model_recommended, última atualização
//   - Filtro de busca por key
//   - Estados: loading (skeleton), empty, error
//   - Permissões: sem ai_prompts:read → 404; sem ai_prompts:write → botão oculto
//   - Hover Lift nos cards (DS §8)
// =============================================================================

import * as React from 'react';
import { Link, Navigate } from 'react-router-dom';

import { Badge } from '../../../../components/ui/Badge';
import { type PromptKeyItem, usePromptKeys } from '../../../../hooks/ai-console/usePrompts';
import { useAuth } from '../../../../lib/auth-store';
import { cn } from '../../../../lib/cn';

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow(): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-2.5 p-4 rounded-lg border border-border animate-pulse"
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-1)' }}
      aria-hidden="true"
    >
      <div className="h-4 w-1/3 rounded" style={{ background: 'var(--surface-muted)' }} />
      <div className="flex gap-2">
        <div className="h-3 w-16 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-3 w-24 rounded" style={{ background: 'var(--surface-muted)' }} />
      </div>
    </div>
  );
}

// ─── Formatador de data ───────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

// ─── Card de prompt key ────────────────────────────────────────────────────────

function PromptKeyCard({ item }: { item: PromptKeyItem }): React.JSX.Element {
  return (
    <Link
      to={`/configuracoes/ia/prompts/${item.key}`}
      className={cn(
        'group flex flex-col gap-3 p-4 rounded-lg border border-border',
        'transition-all duration-[250ms] ease-out',
        'hover:-translate-y-1 focus-visible:-translate-y-1',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
      )}
      style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-4)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-2)';
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-4)';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--elev-2)';
      }}
    >
      {/* Linha 1: key + versão ativa */}
      <div className="flex items-center justify-between gap-3">
        <span
          className="font-mono font-semibold text-ink group-hover:text-azul transition-colors duration-fast truncate"
          style={{ fontSize: 'var(--text-sm)' }}
        >
          {item.key}
        </span>
        {item.active_version !== null ? (
          <span
            className="shrink-0 font-display font-bold text-azul"
            style={{ fontSize: 'var(--text-xs)', letterSpacing: '-0.01em' }}
          >
            v{item.active_version} ativo
          </span>
        ) : (
          <Badge variant="warning">Sem versão ativa</Badge>
        )}
      </div>

      {/* Linha 2: model + data */}
      <div className="flex items-center gap-3 flex-wrap">
        {item.model_recommended && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm font-mono"
            style={{
              fontSize: '0.65rem',
              background: 'var(--surface-muted)',
              color: 'var(--text-3)',
            }}
          >
            {item.model_recommended}
          </span>
        )}
        <span className="font-sans text-xs text-ink-3 ml-auto">{formatDate(item.created_at)}</span>
        {/* Chevron */}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          className="w-4 h-4 shrink-0 text-ink-4 group-hover:text-azul group-hover:translate-x-0.5 transition-all duration-fast"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
      </div>
    </Link>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

/**
 * Lista de prompt keys.
 * Rota: /configuracoes/ia/prompts
 */
export function PromptsListPage(): React.JSX.Element {
  const { hasPermission } = useAuth();
  const { keys, isLoading, isError } = usePromptKeys();
  const [search, setSearch] = React.useState('');

  // RBAC: sem leitura → 404
  if (!hasPermission('ai_prompts:read')) {
    return <Navigate to="/404" replace />;
  }

  const filtered = keys.filter((k) => k.key.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.04em',
              lineHeight: '1',
              fontVariationSettings: "'opsz' 32",
            }}
          >
            Prompts de IA
          </h1>
          <p className="mt-1.5 font-sans text-ink-3" style={{ fontSize: 'var(--text-sm)' }}>
            Gerencie os prompts do agente de IA e controle qual versão está ativa em produção.
          </p>
        </div>
      </div>

      {/* ── Busca ──────────────────────────────────────────────────────── */}
      <div className="relative">
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-4 pointer-events-none"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3 3" strokeLinecap="round" />
        </svg>
        <input
          type="search"
          placeholder="Filtrar por chave..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cn(
            'w-full md:max-w-xs pl-9 pr-4 py-2.5',
            'font-sans text-sm text-ink rounded-sm',
            'border border-border-strong bg-surface-1',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'placeholder:text-ink-4',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow] duration-fast ease',
          )}
          aria-label="Filtrar prompts por chave"
        />
      </div>

      {/* ── Estado: loading ─────────────────────────────────────────────── */}
      {isLoading && (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label="Carregando prompts"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      )}

      {/* ── Estado: erro ────────────────────────────────────────────────── */}
      {isError && !isLoading && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            className="w-10 h-10 text-danger"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16v.5" strokeLinecap="round" />
          </svg>
          <p className="font-sans text-sm text-ink-3 max-w-xs">
            Não foi possível carregar os prompts. Verifique sua conexão e tente novamente.
          </p>
        </div>
      )}

      {/* ── Estado: empty ───────────────────────────────────────────────── */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.2}
            className="w-10 h-10 text-ink-4"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9h6M9 13h4" strokeLinecap="round" />
          </svg>
          <p className="font-sans text-sm text-ink-3 max-w-xs">
            {search
              ? `Nenhum prompt encontrado para "${search}".`
              : 'Nenhum prompt cadastrado ainda.'}
          </p>
        </div>
      )}

      {/* ── Grid de cards ───────────────────────────────────────────────── */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <PromptKeyCard key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
