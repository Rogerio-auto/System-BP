// =============================================================================
// tasks/controller.ts — Handlers HTTP do módulo de tarefas (F15-S05).
//
// Responsabilidades:
//   - Extrair params/body/query do request Fastify.
//   - Montar organizationId + cityScopeIds + actor a partir de request.user.
//   - Extrair Idempotency-Key header quando aplicável.
//   - Delegar ao service; enviar resposta HTTP.
//
// request.user é garantido por authenticate() nos preHandlers de cada rota.
// RBAC é verificado pelo authorize() middleware antes de chegar aqui.
// =============================================================================
import type { FastifyReply, FastifyRequest } from 'fastify';

import { db } from '../../db/client.js';
import { UnauthorizedError } from '../../shared/errors.js';
import { typedBody, typedParams, typedQuery } from '../../shared/fastify-types.js';

import type { TaskCreateBody, TaskIdParam, TasksListQuery } from './schemas.js';
import {
  cancelTaskService,
  claimTaskService,
  completeTaskService,
  createTaskService,
  listMyTasksService,
} from './service.js';

// ---------------------------------------------------------------------------
// Helper — contexto do usuário autenticado
// ---------------------------------------------------------------------------

interface UserContext {
  organizationId: string;
  cityScopeIds: string[] | null;
  userId: string;
  ip: string | null;
}

function getUserContext(request: FastifyRequest): UserContext {
  if (!request.user?.organizationId || !request.user?.id) {
    throw new UnauthorizedError('Contexto de usuário ausente — authenticate() não executou');
  }
  return {
    organizationId: request.user.organizationId,
    cityScopeIds: request.user.cityScopeIds ?? null,
    userId: request.user.id,
    ip: request.ip ?? null,
  };
}

// ---------------------------------------------------------------------------
// Helper — extrai Idempotency-Key header (opcional para tasks)
// ---------------------------------------------------------------------------

function extractIdempotencyKey(request: FastifyRequest): string | undefined {
  const rawKey = request.headers['idempotency-key'];
  if (typeof rawKey === 'string' && rawKey.trim() !== '') {
    return rawKey.trim();
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// GET /api/tasks — minhas tarefas
// ---------------------------------------------------------------------------

export async function listTasksController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, cityScopeIds, userId } = getUserContext(request);
  const query = typedQuery<TasksListQuery>(request);
  const result = await listMyTasksService(db, organizationId, userId, cityScopeIds, query);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/tasks — criar tarefa
// ---------------------------------------------------------------------------

export async function createTaskController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId, ip } = getUserContext(request);
  const body = typedBody<TaskCreateBody>(request);
  const idempotencyKey = extractIdempotencyKey(request);

  const result = await createTaskService(db, organizationId, { userId, ip }, body, idempotencyKey);
  await reply.status(201).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/claim — assumir tarefa
// ---------------------------------------------------------------------------

export async function claimTaskController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId, ip, cityScopeIds } = getUserContext(request);
  const { id } = typedParams<TaskIdParam>(request);

  const result = await claimTaskService(db, organizationId, id, { userId, ip }, cityScopeIds);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/complete — concluir tarefa
// ---------------------------------------------------------------------------

export async function completeTaskController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId, ip } = getUserContext(request);
  const { id } = typedParams<TaskIdParam>(request);
  const idempotencyKey = extractIdempotencyKey(request);

  const result = await completeTaskService(db, organizationId, id, { userId, ip }, idempotencyKey);
  await reply.status(200).send(result);
}

// ---------------------------------------------------------------------------
// POST /api/tasks/:id/cancel — cancelar tarefa
// ---------------------------------------------------------------------------

export async function cancelTaskController(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { organizationId, userId, ip } = getUserContext(request);
  const { id } = typedParams<TaskIdParam>(request);

  const result = await cancelTaskService(db, organizationId, id, { userId, ip });
  await reply.status(200).send(result);
}
