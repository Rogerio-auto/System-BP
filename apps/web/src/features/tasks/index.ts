// =============================================================================
// features/tasks/index.ts — Barrel de exports públicos do domínio de tarefas.
// =============================================================================

export { TasksPage } from './TasksPage';
export { TaskCard } from './TaskCard';
export { TaskStatusBadge } from './TaskStatusBadge';
export { useTasks, useClaimTask, useCompleteTask, useCancelTask } from './hooks';
