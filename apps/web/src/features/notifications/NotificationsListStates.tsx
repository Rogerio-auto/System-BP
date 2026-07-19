// =============================================================================
// features/notifications/NotificationsListStates.tsx — Estados explícitos da
// central (F26-S04): loading (skeleton), empty (com contexto de filtro) e
// error (com retry). Nunca spinner sozinho (norma do projeto).
// =============================================================================

import * as React from 'react';

import { Button } from '../../components/ui/Button';

/** Skeleton de linha — usado enquanto a 1ª página carrega. */
export function NotificationRowSkeleton(): React.JSX.Element {
  return (
    <div
      className="px-4 py-3 flex gap-3 animate-pulse border-b last:border-b-0"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div
        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex-1 flex flex-col gap-2">
        <div className="h-3.5 rounded w-1/2" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-3 rounded w-full" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-2.5 rounded w-1/4" style={{ background: 'var(--surface-muted)' }} />
      </div>
    </div>
  );
}

interface EmptyStateProps {
  hasFilters: boolean;
}

/** Estado vazio — mensagem muda conforme há filtro ativo ou não. */
export function NotificationsEmptyState({ hasFilters }: EmptyStateProps): React.JSX.Element {
  return (
    <div
      className="rounded-md p-12 flex flex-col items-center gap-3 text-center"
      style={{ background: 'var(--bg-elev-1)', border: '1px solid var(--border)' }}
    >
      <p
        className="font-display font-bold"
        style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.028em', color: 'var(--text)' }}
      >
        {hasFilters ? 'Nenhuma notificação com esses filtros' : 'Nenhuma notificação'}
      </p>
      <p className="font-sans" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}>
        {hasFilters
          ? 'Tente outra categoria ou status, ou limpe os filtros.'
          : 'Você está em dia — nada por aqui ainda.'}
      </p>
    </div>
  );
}

interface ErrorStateProps {
  onRetry: () => void;
}

/** Estado de erro — mensagem clara + retry (norma do projeto). */
export function NotificationsErrorState({ onRetry }: ErrorStateProps): React.JSX.Element {
  return (
    <div
      className="rounded-md p-8 flex flex-col items-center gap-4 text-center"
      style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)' }}
    >
      <p
        className="font-sans font-semibold"
        style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}
      >
        Não foi possível carregar suas notificações.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}
