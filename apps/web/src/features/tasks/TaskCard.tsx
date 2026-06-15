// =============================================================================
// features/tasks/TaskCard.tsx — Card de uma tarefa individual.
//
// DS §9.3: bg-elev-1, elev-2, hover Spotlight, border var(--border).
// Estados de ação: Assumir (claim), Concluir (complete), Cancelar (cancel).
// Tarefa some da lista só ao concluir ou cancelar — nunca ao assumir.
// Máx ~180 linhas — componente compacto.
// =============================================================================

import type { Task } from '@elemento/shared-schemas';
import * as React from 'react';

import { Button } from '../../components/ui/Button';
import { useAuthStore } from '../../lib/auth-store';
import { cn } from '../../lib/cn';

import { useCancelTask, useClaimTask, useCompleteTask } from './hooks';
import { TaskStatusBadge } from './TaskStatusBadge';

interface TaskCardProps {
  task: Task;
}

// Mapa de label humanizado para o tipo da tarefa
const typeLabel: Record<Task['type'], string> = {
  spc_overdue_15d: 'SPC — Inadimplência 15d+',
  winback: 'Recuperação',
  manual: 'Manual',
};

function formatDate(iso: string | null): string | null {
  if (iso === null) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * Card de tarefa com ações contextuais.
 * Hover Spotlight (halo verde segue cursor) — DS §6.5.
 */
export function TaskCard({ task }: TaskCardProps): React.JSX.Element {
  const claim = useClaimTask();
  const complete = useCompleteTask();
  const cancel = useCancelTask();

  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canClaim = hasPermission('tasks:claim');
  const canComplete = hasPermission('tasks:complete');
  const canCancel = hasPermission('tasks:cancel');

  const isClaimed = task.claimed_by !== null;
  const dueDateStr = formatDate(task.due_date);
  const isOverdue =
    task.due_date !== null && new Date(task.due_date) < new Date() && task.status !== 'done';

  // Spotlight follow-cursor via CSS custom props
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
  };

  return (
    <div
      role="article"
      aria-label={task.title}
      onMouseMove={handleMouseMove}
      className={cn(
        // Base card DS §9.3
        'relative overflow-hidden rounded-md',
        'p-5 flex flex-col gap-3',
        'transition-[transform,box-shadow,border-color] duration-[200ms]',
        'cursor-default',
        // Spotlight + Lift DS §6.5
        'hover:-translate-y-[3px]',
        'hover:[border-color:var(--border-strong)]',
        // Spotlight pseudo-element via before (green halo following cursor)
        'before:absolute before:inset-0 before:pointer-events-none before:rounded-md',
        'before:opacity-0 hover:before:opacity-100',
        'before:transition-opacity before:duration-300',
        'before:[background:radial-gradient(200px_circle_at_var(--mx,50%)_var(--my,50%),rgba(46,155,62,0.08),transparent_70%)]',
      )}
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-2)',
        // @ts-expect-error -- CSS custom props não existem em CSSProperties
        '--mx': '50%',
        '--my': '50%',
      }}
    >
      {/* Cabeçalho: tipo + status */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span
          className="font-sans font-semibold uppercase"
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.1em',
            color: 'var(--text-3)',
          }}
        >
          {typeLabel[task.type]}
        </span>
        <TaskStatusBadge status={task.status} />
      </div>

      {/* Título */}
      <h3
        className="font-display font-bold leading-snug"
        style={{
          fontSize: 'var(--text-xl)',
          letterSpacing: '-0.028em',
          color: 'var(--text)',
        }}
      >
        {task.title}
      </h3>

      {/* Descrição opcional */}
      {task.description !== null && (
        <p
          className="font-sans"
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-2)',
            lineHeight: 1.55,
          }}
        >
          {task.description}
        </p>
      )}

      {/* Metadados: vencimento + responsável */}
      <div className="flex items-center gap-4 flex-wrap" style={{ color: 'var(--text-3)' }}>
        {dueDateStr !== null && (
          <span
            className="font-mono"
            style={{
              fontSize: 'var(--text-xs)',
              color: isOverdue ? 'var(--danger)' : 'var(--text-3)',
            }}
          >
            Prazo: {dueDateStr}
            {isOverdue && ' · Vencida'}
          </span>
        )}
        {isClaimed && (
          <span className="font-sans" style={{ fontSize: 'var(--text-xs)' }}>
            Assumida
          </span>
        )}
      </div>

      {/* Ações */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {/* Assumir — só exibe se o usuário tem permissão e a tarefa não foi assumida */}
        {canClaim && !isClaimed && task.status === 'open' && (
          <Button
            variant="outline"
            size="sm"
            disabled={claim.isPending}
            onClick={() => claim.mutate(task.id)}
          >
            {claim.isPending ? 'Assumindo…' : 'Assumir'}
          </Button>
        )}

        {/* Concluir — disponível quando open ou in_progress e usuário tem permissão */}
        {canComplete && (task.status === 'open' || task.status === 'in_progress') && (
          <Button
            variant="secondary"
            size="sm"
            disabled={complete.isPending}
            onClick={() => complete.mutate(task.id)}
          >
            {complete.isPending ? 'Concluindo…' : 'Concluir'}
          </Button>
        )}

        {/* Cancelar — disponível quando open ou in_progress e usuário tem permissão */}
        {canCancel && (task.status === 'open' || task.status === 'in_progress') && (
          <Button
            variant="ghost"
            size="sm"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(task.id)}
            style={{ color: 'var(--danger)' }}
          >
            {cancel.isPending ? 'Cancelando…' : 'Cancelar'}
          </Button>
        )}
      </div>
    </div>
  );
}
