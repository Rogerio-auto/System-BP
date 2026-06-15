// =============================================================================
// features/tasks/TaskStatusBadge.tsx — Badge visual do status de uma tarefa.
//
// Mapeia TaskStatus → variante do Badge canônico (DS §9.5).
// =============================================================================

import type { TaskStatus } from '@elemento/shared-schemas';
import * as React from 'react';

import { Badge } from '../../components/ui/Badge';
import type { BadgeVariant } from '../../components/ui/Badge';

interface TaskStatusBadgeProps {
  status: TaskStatus;
  className?: string;
}

const statusVariant: Record<TaskStatus, BadgeVariant> = {
  open: 'info',
  in_progress: 'warning',
  done: 'success',
  cancelled: 'neutral',
};

const statusLabel: Record<TaskStatus, string> = {
  open: 'Aberta',
  in_progress: 'Em andamento',
  done: 'Concluída',
  cancelled: 'Cancelada',
};

/**
 * Badge de status de tarefa — usa o Badge canônico do DS (§9.5).
 */
export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps): React.JSX.Element {
  // Spread condicional para respeitar exactOptionalPropertyTypes do tsconfig
  const optionalProps = className !== undefined ? { className } : ({} as Record<string, never>);
  return (
    <Badge variant={statusVariant[status]} {...optionalProps}>
      {statusLabel[status]}
    </Badge>
  );
}
