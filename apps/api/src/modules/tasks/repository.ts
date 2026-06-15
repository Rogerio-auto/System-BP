// =============================================================================
// tasks/repository.ts — Queries Drizzle para o módulo de tarefas (F15-S05).
//
// Resolução "minhas tarefas" por role + cidade:
//   O usuário vê uma tarefa quando:
//     1. Tem o role `assignee_role` da tarefa no seu perfil.
//     2. E (tarefa é global: city_id IS NULL)
//        OU (city_id está nos cityScopeIds do usuário).
//
//   cityScopeIds semântica (herdada de billing/repository.ts):
//     null     → acesso global (admin/gestor_geral) — sem filtro de cidade.
//     []       → sem scope → nenhuma tarefa visível (condição 1=0).
//     string[] → WHERE (tasks.city_id IN (...) OR tasks.city_id IS NULL).
//
// Nota sobre "claim":
//   O banco (F15-S03) tem status enum: 'open' | 'done' | 'cancelled'.
//   O estado "assumida" é rastreado por claimedBy/claimedAt, não por um
//   status 'in_progress' — status permanece 'open' quando assumida.
//   Apenas completeTask e cancelTask mudam o status (para done/cancelled).
//
// City scope injetado em toda query — nenhuma rota expõe dados cross-tenant.
// =============================================================================
import { and, count, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { roles, userRoles } from '../../db/schema/index.js';
import { tasks } from '../../db/schema/tasks.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors.js';

import type { TaskCreateBody, TaskResponse, TasksListQuery, TasksListResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Mapper: Drizzle row → TaskResponse
// ---------------------------------------------------------------------------

type TaskRow = typeof tasks.$inferSelect;

function mapTaskRow(row: TaskRow): TaskResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    assigneeRole: row.assigneeRole,
    cityId: row.cityId ?? null,
    // `as` justificado: type é text enum no schema — valor sempre válido se inserido via Zod.
    type: row.type as TaskResponse['type'],
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    title: row.title,
    description: row.description ?? null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    // `as` justificado: status é text enum no schema — valor sempre válido se inserido via Zod.
    status: row.status as TaskResponse['status'],
    claimedBy: row.claimedBy ?? null,
    claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
    completedBy: row.completedBy ?? null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// City-scope helper (padrão: billing/repository.ts §buildCityScopeCondition)
// ---------------------------------------------------------------------------

/**
 * Constrói condição SQL para filtrar tasks por cidade permitida.
 * Inclui tarefas globais (city_id IS NULL) junto com as cidades do usuário.
 *
 * - null     → acesso global — sem filtro adicional.
 * - []       → sem scope de cidade — retorna condição falsa (1=0) mesmo para globais
 *              (array vazio indica que o usuário não tem nenhuma cidade configurada).
 * - string[] → WHERE (tasks.city_id IN (...) OR tasks.city_id IS NULL).
 */
function buildTaskCityScopeCondition(
  cityScopeIds: string[] | null,
): ReturnType<typeof or> | ReturnType<typeof sql> | null {
  if (cityScopeIds === null) {
    // Acesso global — sem filtro adicional
    return null;
  }
  if (cityScopeIds.length === 0) {
    // `as` justificado: sql<boolean> é compatível com SQL condition no Drizzle.
    return sql`1 = 0` as ReturnType<typeof sql>;
  }
  // Vê tarefas da(s) sua(s) cidade(s) + tarefas globais
  return or(inArray(tasks.cityId, cityScopeIds), isNull(tasks.cityId));
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista tarefas visíveis para o usuário autenticado (resolução role + cidade).
 * Apenas tarefas cujo assignee_role bate com o role do usuário
 * e cujo city_id está no scope do usuário (ou é NULL para globais).
 */
export async function listMyTasks(
  db: Database,
  organizationId: string,
  userRoleKeys: string[],
  cityScopeIds: string[] | null,
  query: TasksListQuery,
): Promise<TasksListResponse> {
  if (userRoleKeys.length === 0) {
    return { data: [], total: 0, limit: query.limit, offset: query.offset };
  }

  // Inicia conditions com array vazio para acumular filtros
  const baseConditions = [
    eq(tasks.organizationId, organizationId),
    inArray(tasks.assigneeRole, userRoleKeys),
  ] as ReturnType<typeof eq>[];

  const cityCondition = buildTaskCityScopeCondition(cityScopeIds);
  if (cityCondition !== null) {
    // `as` justificado: condição retornada por buildTaskCityScopeCondition é compatível
    // com SQL expression do Drizzle; cast necessário pela união de tipos de retorno.
    baseConditions.push(cityCondition as ReturnType<typeof eq>);
  }

  const optionalConditions: ReturnType<typeof eq>[] = [];

  if (query.status !== undefined) {
    optionalConditions.push(eq(tasks.status, query.status));
  }
  if (query.type !== undefined) {
    optionalConditions.push(eq(tasks.type, query.type));
  }
  if (query.claimed === 'true') {
    optionalConditions.push(isNotNull(tasks.claimedBy) as ReturnType<typeof eq>);
  } else if (query.claimed === 'false') {
    optionalConditions.push(isNull(tasks.claimedBy) as ReturnType<typeof eq>);
  }

  const allConditions = [...baseConditions, ...optionalConditions];
  const whereClause = and(...allConditions);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(whereClause)
      .limit(query.limit)
      .offset(query.offset)
      .orderBy(tasks.createdAt),
    db.select({ total: count() }).from(tasks).where(whereClause),
  ]);

  return {
    data: rows.map(mapTaskRow),
    total: countRows[0]?.total ?? 0,
    limit: query.limit,
    offset: query.offset,
  };
}

/**
 * Cria uma tarefa nova.
 */
export async function createTask(
  db: Database,
  organizationId: string,
  body: TaskCreateBody,
): Promise<TaskResponse> {
  const now = new Date();

  const [row] = await db
    .insert(tasks)
    .values({
      organizationId,
      assigneeRole: body.assigneeRole,
      cityId: body.cityId ?? null,
      type: body.type,
      title: body.title,
      description: body.description ?? null,
      entityType: body.entityType ?? null,
      entityId: body.entityId ?? null,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      status: 'open',
      claimedBy: null,
      claimedAt: null,
      completedBy: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao criar tarefa');
  }

  return mapTaskRow(row);
}

/**
 * Busca uma tarefa pelo ID garantindo isolamento de organização.
 * Lança NotFoundError se não existir ou pertencer a outra org.
 */
export async function getTaskById(
  db: Database,
  organizationId: string,
  taskId: string,
): Promise<TaskResponse> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);

  if (!row) {
    throw new NotFoundError(`Tarefa ${taskId} não encontrada`);
  }

  return mapTaskRow(row);
}

/**
 * Assume uma tarefa (claim): seta claimedBy e claimedAt (status permanece 'open').
 *
 * O banco (F15-S03) tem status enum: open | done | cancelled — sem 'in_progress'.
 * O estado "assumida" é rastreado apenas por claimedBy IS NOT NULL.
 *
 * Regras:
 *   - Tarefa deve estar 'open' e não ter sido reclamada (claimedBy IS NULL).
 *   - O usuário deve ter o assignee_role da tarefa.
 *   - Tarefa deve estar no scope de cidade do usuário (ou ser global).
 */
export async function claimTask(
  db: Database,
  organizationId: string,
  taskId: string,
  userId: string,
  userRoleKeys: string[],
  cityScopeIds: string[] | null,
): Promise<TaskResponse> {
  const now = new Date();

  // Buscar tarefa (sem lock — usamos condição otimista no UPDATE)
  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);

  if (!task) {
    throw new NotFoundError(`Tarefa ${taskId} não encontrada`);
  }

  // Verificar que o usuário tem o role da tarefa
  if (!userRoleKeys.includes(task.assigneeRole)) {
    throw new ForbiddenError(
      `Seu perfil não tem o role '${task.assigneeRole}' necessário para assumir esta tarefa`,
    );
  }

  // Verificar city scope
  if (cityScopeIds !== null && task.cityId !== null) {
    if (!cityScopeIds.includes(task.cityId)) {
      throw new ForbiddenError('Tarefa fora do seu escopo de cidade');
    }
  }

  // Verificar status
  if (task.status !== 'open') {
    throw new ConflictError(
      `Tarefa não pode ser assumida: status atual é '${task.status}' (esperado: 'open')`,
    );
  }

  // Verificar se já foi reclamada (atomicidade via condição no WHERE)
  if (task.claimedBy !== null) {
    // Idempotência: se o mesmo usuário já reclamou, retornar o estado atual
    if (task.claimedBy === userId) {
      return mapTaskRow(task);
    }
    throw new ConflictError('Tarefa já foi assumida por outro usuário');
  }

  // UPDATE atômico com condição em claimedBy IS NULL (evita race condition)
  const [updated] = await db
    .update(tasks)
    .set({
      claimedBy: userId,
      claimedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(tasks.id, taskId),
        eq(tasks.organizationId, organizationId),
        eq(tasks.status, 'open'),
        isNull(tasks.claimedBy),
      ),
    )
    .returning();

  if (!updated) {
    // Race condition: outra requisição assumiu entre o SELECT e o UPDATE
    throw new ConflictError('Tarefa já foi assumida por outro usuário');
  }

  return mapTaskRow(updated);
}

/**
 * Conclui uma tarefa: open → done, seta completedBy e completedAt.
 *
 * Regras:
 *   - Tarefa deve estar 'open' (status no banco).
 *   - Apenas quem fez o claim (claimedBy) pode concluir.
 */
export async function completeTask(
  db: Database,
  organizationId: string,
  taskId: string,
  userId: string,
): Promise<TaskResponse> {
  const now = new Date();

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);

  if (!task) {
    throw new NotFoundError(`Tarefa ${taskId} não encontrada`);
  }

  if (task.status !== 'open') {
    throw new ConflictError(
      `Tarefa não pode ser concluída: status atual é '${task.status}' (esperado: 'open')`,
    );
  }

  // Apenas quem assumiu pode concluir
  if (task.claimedBy !== userId) {
    throw new ForbiddenError('Apenas o usuário que assumiu a tarefa pode concluí-la');
  }

  const [updated] = await db
    .update(tasks)
    .set({
      status: 'done',
      completedBy: userId,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .returning();

  if (!updated) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao concluir tarefa');
  }

  return mapTaskRow(updated);
}

/**
 * Cancela uma tarefa: open → cancelled, seta completedBy e completedAt.
 *
 * Regras:
 *   - Tarefa não pode estar já 'done' ou 'cancelled'.
 */
export async function cancelTask(
  db: Database,
  organizationId: string,
  taskId: string,
  userId: string,
): Promise<TaskResponse> {
  const now = new Date();

  const [task] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);

  if (!task) {
    throw new NotFoundError(`Tarefa ${taskId} não encontrada`);
  }

  if (task.status === 'done' || task.status === 'cancelled') {
    throw new ConflictError(`Tarefa não pode ser cancelada: status atual é '${task.status}'`);
  }

  const [updated] = await db
    .update(tasks)
    .set({
      status: 'cancelled',
      completedBy: userId,
      completedAt: now,
      updatedAt: now,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .returning();

  if (!updated) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao cancelar tarefa');
  }

  return mapTaskRow(updated);
}

/**
 * Busca os role keys de um usuário para resolução "minhas tarefas".
 * Usado pelo service para determinar quais roles o usuário tem.
 */
export async function getUserRoleKeys(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ key: roles.key })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  return rows.map((r) => r.key);
}
