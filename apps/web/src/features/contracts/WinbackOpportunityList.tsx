// =============================================================================
// features/contracts/WinbackOpportunityList.tsx — Lista de oportunidades win-back (F17-S10).
//
// Filtra tarefas com type = 'winback' da API e apresenta como painel de
// oportunidades de reativação. Importa useTasks de features/tasks (sem editar).
//
// Estados explícitos: loading (skeleton), empty (com CTA), error (com retry), success.
// DS: Bricolage display, tokens sem hex hardcoded, elev-1/2, spotlight nos cards.
// =============================================================================

import * as React from 'react';

import { Button } from '../../components/ui/Button';
import { useTasks } from '../tasks/hooks';

import { WinbackTaskCard } from './WinbackTaskCard';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Skeleton de carregamento (DS: nunca spinner sozinho)
// ---------------------------------------------------------------------------

function WinbackSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md p-5 flex flex-col gap-4 animate-pulse"
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-2)',
      }}
    >
      {/* Ícone + badge */}
      <div className="flex justify-between items-start">
        <div
          className="rounded-full"
          style={{ width: 36, height: 36, background: 'var(--surface-muted)' }}
        />
        <div className="h-5 w-32 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
      </div>
      {/* Título */}
      <div className="h-5 w-3/4 rounded" style={{ background: 'var(--surface-muted)' }} />
      {/* Descrição */}
      <div className="h-4 w-full rounded" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-4 w-2/3 rounded" style={{ background: 'var(--surface-muted)' }} />
      {/* Botões */}
      <div className="flex gap-2 pt-1">
        <div className="h-8 w-28 rounded-sm" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-8 w-28 rounded-sm" style={{ background: 'var(--surface-muted)' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vazio
// ---------------------------------------------------------------------------

function EmptyState(): React.JSX.Element {
  return (
    <div
      className="rounded-md p-12 flex flex-col items-center gap-4 text-center"
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {/* Ícone: check em círculo */}
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
          background: 'var(--success-bg)',
          color: 'var(--success)',
          boxShadow: 'var(--elev-2)',
        }}
        aria-hidden="true"
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>

      <div>
        <p
          className="font-display font-bold"
          style={{
            fontSize: 'var(--text-xl)',
            letterSpacing: '-0.028em',
            color: 'var(--text)',
          }}
        >
          Nenhuma oportunidade de win-back no momento
        </p>
        <p
          className="font-sans mt-1"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
        >
          O sistema gera oportunidades automaticamente quando contratos vencem ou leads ficam
          inativos.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado de erro
// ---------------------------------------------------------------------------

interface ErrorStateProps {
  onRetry: () => void;
}

function ErrorState({ onRetry }: ErrorStateProps): React.JSX.Element {
  return (
    <div
      className="rounded-md p-8 flex flex-col items-center gap-4 text-center"
      style={{
        background: 'var(--danger-bg)',
        border: '1px solid var(--danger)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <p
        className="font-sans font-semibold"
        style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}
      >
        Não foi possível carregar as oportunidades de win-back.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WinbackOpportunityList
// ---------------------------------------------------------------------------

/**
 * Painel de oportunidades de win-back.
 * Filtra tarefas com type = 'winback' e status = 'open' | 'in_progress'.
 * Cada item usa WinbackTaskCard com CTA de nova simulação.
 */
export function WinbackOpportunityList(): React.JSX.Element {
  const [page, setPage] = React.useState(1);

  const { data, isLoading, isError, refetch } = useTasks({
    type: 'winback',
    status: 'open',
    page,
    per_page: PAGE_SIZE,
  });

  // Cabeçalho da seção
  const header = (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h2
          className="font-display font-bold"
          style={{
            fontSize: 'var(--text-2xl)',
            letterSpacing: '-0.04em',
            lineHeight: 1.1,
            color: 'var(--text)',
            fontVariationSettings: "'opsz' 36",
          }}
        >
          Oportunidades de Reativação
        </h2>
        <p
          className="font-sans mt-1"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
        >
          Contratos próximos ao vencimento e leads que podem ser recuperados
        </p>
      </div>

      {/* Contador de oportunidades */}
      {data !== undefined && data.total > 0 && (
        <span
          className="inline-flex items-center px-3 py-1 rounded-pill font-mono font-semibold"
          style={{
            fontSize: 'var(--text-sm)',
            background: 'var(--info-bg)',
            color: 'var(--info)',
            boxShadow: 'var(--elev-1)',
          }}
        >
          {data.total} oportunidade{data.total !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );

  return (
    <section aria-label="Oportunidades de win-back" className="flex flex-col gap-6">
      {header}

      {/* Loading */}
      {isLoading && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <WinbackSkeleton key={String(i)} />
          ))}
        </div>
      )}

      {/* Erro */}
      {isError && <ErrorState onRetry={() => void refetch()} />}

      {/* Conteúdo */}
      {!isLoading && !isError && data !== undefined && (
        <>
          {data.data.length === 0 ? (
            <EmptyState />
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
            >
              {data.data.map((task) => (
                <WinbackTaskCard key={task.id} task={task} />
              ))}
            </div>
          )}

          {/* Paginação simples */}
          {data.total > PAGE_SIZE && (
            <nav
              className="flex items-center justify-center gap-2"
              aria-label="Paginação de oportunidades"
            >
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label="Página anterior"
              >
                Anterior
              </Button>
              <span
                className="font-sans"
                style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
              >
                {page} / {Math.ceil(data.total / PAGE_SIZE)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= Math.ceil(data.total / PAGE_SIZE)}
                onClick={() => setPage((p) => p + 1)}
                aria-label="Próxima página"
              >
                Próxima
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
