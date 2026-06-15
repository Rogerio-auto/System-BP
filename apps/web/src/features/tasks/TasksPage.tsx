// =============================================================================
// features/tasks/TasksPage.tsx — Rota /tarefas: "Minhas Tarefas".
//
// Lista tarefas abertas (open + in_progress) com paginação.
// Estados explícitos: loading (skeleton), empty, error, success.
// DS: Bricolage h1, cards com profundidade, tokens sem hex hardcoded.
// =============================================================================

import * as React from 'react';

import { Button } from '../../components/ui/Button';

import { useTasks } from './hooks';
import { TaskCard } from './TaskCard';

const PAGE_SIZE = 12;

// ---------------------------------------------------------------------------
// Skeleton de carregamento (DS: nunca spinner sozinho)
// ---------------------------------------------------------------------------

function TaskSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md p-5 flex flex-col gap-3 animate-pulse"
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-2)',
      }}
    >
      {/* Tipo + status */}
      <div className="flex justify-between">
        <div className="h-3 w-28 rounded" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-4 w-20 rounded-pill" style={{ background: 'var(--surface-muted)' }} />
      </div>
      {/* Título */}
      <div className="h-5 w-3/4 rounded" style={{ background: 'var(--surface-muted)' }} />
      {/* Descrição */}
      <div className="h-4 w-full rounded" style={{ background: 'var(--surface-muted)' }} />
      <div className="h-4 w-2/3 rounded" style={{ background: 'var(--surface-muted)' }} />
      {/* Botões */}
      <div className="flex gap-2 pt-1">
        <div className="h-8 w-20 rounded-sm" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-8 w-20 rounded-sm" style={{ background: 'var(--surface-muted)' }} />
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
          style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.028em', color: 'var(--text)' }}
        >
          Tudo em dia!
        </p>
        <p
          className="font-sans mt-1"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
        >
          Não há tarefas abertas para você no momento.
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
        Não foi possível carregar as tarefas.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paginação
// ---------------------------------------------------------------------------

interface PaginationProps {
  page: number;
  total: number;
  perPage: number;
  onPage: (p: number) => void;
}

function Pagination({ page, total, perPage, onPage }: PaginationProps): React.JSX.Element | null {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  return (
    <nav className="flex items-center justify-center gap-2" aria-label="Paginação de tarefas">
      <Button
        variant="ghost"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Página anterior"
      >
        Anterior
      </Button>

      <span className="font-sans" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>
        {page} / {totalPages}
      </span>

      <Button
        variant="ghost"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label="Próxima página"
      >
        Próxima
      </Button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// TasksPage
// ---------------------------------------------------------------------------

/**
 * Painel "Minhas Tarefas" — lista tarefas abertas com paginação.
 * Rota: /tarefas
 */
export function TasksPage(): React.JSX.Element {
  const [page, setPage] = React.useState(1);

  const { data, isLoading, isError, refetch } = useTasks({
    status: 'open',
    page,
    per_page: PAGE_SIZE,
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Cabeçalho da página */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="font-display font-bold"
            style={{
              fontSize: 'var(--text-3xl)',
              letterSpacing: '-0.045em',
              lineHeight: 1.05,
              color: 'var(--text)',
              fontVariationSettings: "'opsz' 48",
            }}
          >
            Minhas Tarefas
          </h1>
          <p
            className="font-sans mt-1"
            style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
          >
            Tarefas abertas atribuídas ao seu perfil
          </p>
        </div>

        {/* Contador de tarefas */}
        {data !== undefined && (
          <span
            className="inline-flex items-center px-3 py-1 rounded-pill font-mono font-semibold"
            style={{
              fontSize: 'var(--text-sm)',
              background: 'var(--info-bg)',
              color: 'var(--info)',
              boxShadow: 'var(--elev-1)',
            }}
          >
            {data.total} tarefa{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Conteúdo */}
      {isLoading && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <TaskSkeleton key={String(i)} />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => void refetch()} />}

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
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}

          <Pagination
            page={data.page}
            total={data.total}
            perPage={data.per_page}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
