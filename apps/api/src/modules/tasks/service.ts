// =============================================================================
// tasks/service.ts — Regras de negócio do módulo de tarefas (F15-S05).
//
// Responsabilidades:
//   - Resolver "minhas tarefas": role + cidade do usuário autenticado.
//   - Criar tarefa com outbox task.created (sem PII bruta no payload).
//   - Claim/complete/cancel com audit + idempotência em transação única.
//   - RBAC verificado nas rotas — não aqui.
//
// Idempotência:
//   - POST /api/tasks        → Idempotency-Key opcional (evita duplicatas).
//   - POST /api/tasks/:id/complete → Idempotency-Key opcional.
//   - claim/cancel: idempotência via estado do banco (claim em 'open' apenas).
//
// LGPD §8.5: payload do evento task.created sem PII bruta.
//   title/description NÃO entram no evento — apenas IDs opacos + classificação.
// =============================================================================
import crypto from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { idempotencyKeys } from '../../db/schema/idempotencyKeys.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import type { TaskCreatedData } from '../../events/types.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditTx } from '../../lib/audit.js';

import {
  cancelTask,
  claimTask,
  completeTask,
  createTask,
  getUserRoleKeys,
  listMyTasks,
} from './repository.js';
import type { TaskCreateBody, TaskResponse, TasksListQuery, TasksListResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Idempotency-key helpers (padrão: billing/service.ts)
// ---------------------------------------------------------------------------

/**
 * Verifica se uma chave de idempotência já existe.
 * Retorna a resposta cacheada ou null.
 * LGPD: response_body armazena apenas { task_id: uuid } — sem PII.
 */
async function checkTaskIdempotencyKey(db: Database, key: string): Promise<TaskResponse | null> {
  const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);

  if (rows.length === 0) return null;

  const cached = rows[0]!.responseBody;
  // `as` justificado: responseBody é JSONB armazenado pelo próprio service
  // com estrutura TaskResponse — sem PII, apenas IDs e metadados operacionais.
  return cached as TaskResponse;
}

/**
 * Persiste a chave de idempotência na mesma transação da mutação.
 * LGPD: armazena apenas { task_id: uuid } — sem PII bruta.
 */
async function persistTaskIdempotencyKey(
  tx: Database,
  key: string,
  endpoint: string,
  response: TaskResponse,
): Promise<void> {
  const requestHash = crypto.createHash('sha256').update(key).digest('hex');

  await tx.insert(idempotencyKeys).values({
    key,
    endpoint,
    requestHash,
    responseStatus: 201,
    // LGPD: armazena apenas { task_id: uuid } — sem PII bruta.
    responseBody: { task_id: response.id },
  });
}

// ---------------------------------------------------------------------------
// Tipo de transação unificado (suporta AuditTx + DrizzleTx + insert)
// ---------------------------------------------------------------------------

type ServiceTx = AuditTx & DrizzleTx & Database;

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------

/**
 * Lista tarefas visíveis para o usuário (role + cidade).
 *
 * Resolução:
 *   1. Busca os role keys do usuário no banco.
 *   2. Filtra tarefas onde assignee_role está nos roles do usuário.
 *   3. Aplica filtro de cidade (city_id in scope ou NULL para globais).
 */
export async function listMyTasksService(
  db: Database,
  organizationId: string,
  userId: string,
  cityScopeIds: string[] | null,
  query: TasksListQuery,
): Promise<TasksListResponse> {
  const userRoleKeys = await getUserRoleKeys(db, userId);
  return listMyTasks(db, organizationId, userRoleKeys, cityScopeIds, query);
}

/**
 * Cria uma tarefa.
 *
 * Fluxo transacional:
 *   1. Verifica idempotency key (fora da tx).
 *   2. Em transação: createTask + auditLog + emit(task.created) + persistIdempotencyKey.
 *
 * LGPD: evento task.created sem title/description — apenas IDs opacos.
 */
export async function createTaskService(
  db: Database,
  organizationId: string,
  actor: { userId: string; ip: string | null },
  body: TaskCreateBody,
  idempotencyKey: string | undefined,
): Promise<TaskResponse> {
  // Verificar chave fora da transação (leitura rápida)
  if (idempotencyKey !== undefined) {
    const cached = await checkTaskIdempotencyKey(db, idempotencyKey);
    if (cached !== null) return cached;
  }

  return db.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + AuditTx + DrizzleTx.
    const txDb = tx as unknown as ServiceTx;

    const task = await createTask(txDb, organizationId, body);

    // Audit log na transação
    await auditLog(txDb, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'task.created',
      resource: { type: 'task', id: task.id },
      // LGPD: apenas IDs e classificação — sem título ou descrição
      after: {
        task_id: task.id,
        type: task.type,
        assignee_role: task.assigneeRole,
        city_id: task.cityId,
        status: task.status,
      },
    });

    // Evento outbox task.created (sem PII bruta: sem title/description)
    const eventData: TaskCreatedData = {
      task_id: task.id,
      assignee_role: task.assigneeRole,
      city_id: task.cityId,
      type: task.type,
      entity_type: task.entityType,
      entity_id: task.entityId,
      organization_id: organizationId,
    };

    await emit(txDb, {
      eventName: 'task.created',
      aggregateType: 'task',
      aggregateId: task.id,
      organizationId,
      actor: { kind: 'user', id: actor.userId, ip: actor.ip },
      idempotencyKey: `task.created:${task.id}`,
      data: eventData,
    });

    // Idempotência na transação
    if (idempotencyKey !== undefined) {
      await persistTaskIdempotencyKey(txDb, idempotencyKey, 'POST /api/tasks', task);
    }

    return task;
  });
}

/**
 * Assume uma tarefa (claim): open → in_progress.
 *
 * Regras:
 *   - O usuário deve ter o assignee_role da tarefa.
 *   - A tarefa deve estar no scope de cidade do usuário (ou ser global).
 *   - Status deve ser 'open'.
 *
 * Idempotência via estado do banco: se já claimed_by == userId e status == in_progress,
 * retorna o estado atual sem erro.
 */
export async function claimTaskService(
  db: Database,
  organizationId: string,
  taskId: string,
  actor: { userId: string; ip: string | null },
  cityScopeIds: string[] | null,
): Promise<TaskResponse> {
  const userRoleKeys = await getUserRoleKeys(db, actor.userId);

  return db.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + AuditTx.
    const txDb = tx as unknown as ServiceTx;

    const task = await claimTask(
      txDb,
      organizationId,
      taskId,
      actor.userId,
      userRoleKeys,
      cityScopeIds,
    );

    await auditLog(txDb, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'task.claimed',
      resource: { type: 'task', id: taskId },
      after: { task_id: taskId, status: 'in_progress', claimed_by: actor.userId },
    });

    return task;
  });
}

/**
 * Conclui uma tarefa: in_progress → done.
 *
 * Idempotency-Key suportada: se mesma chave, retorna resposta cacheada.
 *
 * Regras:
 *   - Apenas quem fez o claim pode concluir.
 *   - Status deve ser 'in_progress'.
 */
export async function completeTaskService(
  db: Database,
  organizationId: string,
  taskId: string,
  actor: { userId: string; ip: string | null },
  idempotencyKey: string | undefined,
): Promise<TaskResponse> {
  // Verificar chave fora da transação
  if (idempotencyKey !== undefined) {
    const cached = await checkTaskIdempotencyKey(db, idempotencyKey);
    if (cached !== null) return cached;
  }

  return db.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + AuditTx + DrizzleTx.
    const txDb = tx as unknown as ServiceTx;

    const task = await completeTask(txDb, organizationId, taskId, actor.userId);

    await auditLog(txDb, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'task.completed',
      resource: { type: 'task', id: taskId },
      after: { task_id: taskId, status: 'done', completed_by: actor.userId },
    });

    if (idempotencyKey !== undefined) {
      const requestHash = crypto.createHash('sha256').update(idempotencyKey).digest('hex');
      await txDb.insert(idempotencyKeys).values({
        key: idempotencyKey,
        endpoint: `POST /api/tasks/${taskId}/complete`,
        requestHash,
        responseStatus: 200,
        // LGPD: apenas { task_id } — sem PII
        responseBody: { task_id: taskId },
      });
    }

    return task;
  });
}

/**
 * Cancela uma tarefa: open|in_progress → cancelled.
 *
 * Idempotência via estado: se já 'cancelled', lança ConflictError.
 */
export async function cancelTaskService(
  db: Database,
  organizationId: string,
  taskId: string,
  actor: { userId: string; ip: string | null },
): Promise<TaskResponse> {
  return db.transaction(async (tx) => {
    // `as` justificado: transação Drizzle implementa estruturalmente Database + AuditTx.
    const txDb = tx as unknown as ServiceTx;

    const task = await cancelTask(txDb, organizationId, taskId, actor.userId);

    await auditLog(txDb, {
      organizationId,
      actor: { userId: actor.userId, role: 'user', ip: actor.ip },
      action: 'task.cancelled',
      resource: { type: 'task', id: taskId },
      after: { task_id: taskId, status: 'cancelled', completed_by: actor.userId },
    });

    return task;
  });
}
