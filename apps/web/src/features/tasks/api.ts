// =============================================================================
// features/tasks/api.ts — Funções de acesso à API de tarefas.
//
// Todas as chamadas passam por lib/api.ts (único ponto de rede).
// Tipos derivados de packages/shared-schemas/src/tasks.ts.
// =============================================================================

import type { Task, TaskListResponse } from '@elemento/shared-schemas';

import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Tipos de query
// ---------------------------------------------------------------------------

export interface TasksQueryParams {
  status?: 'open' | 'in_progress' | 'done' | 'cancelled';
  type?: 'spc_overdue_15d' | 'winback' | 'manual';
  city_id?: string;
  page?: number;
  per_page?: number;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/**
 * GET /api/tasks — lista paginada de tarefas.
 * Aplica filtros via query string.
 */
export async function fetchTasks(params: TasksQueryParams = {}): Promise<TaskListResponse> {
  const qs = new URLSearchParams();
  if (params.status !== undefined) qs.set('status', params.status);
  if (params.type !== undefined) qs.set('type', params.type);
  if (params.city_id !== undefined) qs.set('city_id', params.city_id);
  if (params.page !== null && params.page !== undefined) qs.set('page', String(params.page));
  if (params.per_page !== null && params.per_page !== undefined)
    qs.set('per_page', String(params.per_page));

  const query = qs.toString();
  return api.get<TaskListResponse>(`/api/tasks${query ? `?${query}` : ''}`);
}

/**
 * POST /api/tasks/:id/claim — agente assume a tarefa.
 * A tarefa permanece visível após assumida (apenas claimed_by é atualizado).
 */
export async function claimTask(id: string): Promise<Task> {
  return api.post<Task>(`/api/tasks/${encodeURIComponent(id)}/claim`, {});
}

/**
 * POST /api/tasks/:id/complete — marca tarefa como concluída.
 * Após isso a tarefa some da lista open/in_progress.
 */
export async function completeTask(id: string): Promise<Task> {
  return api.post<Task>(`/api/tasks/${encodeURIComponent(id)}/complete`, {});
}

/**
 * POST /api/tasks/:id/cancel — cancela a tarefa.
 * Após isso a tarefa some da lista open/in_progress.
 */
export async function cancelTask(id: string): Promise<Task> {
  return api.post<Task>(`/api/tasks/${encodeURIComponent(id)}/cancel`, {});
}
