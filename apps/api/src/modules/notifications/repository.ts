// =============================================================================
// notifications/repository.ts — Queries Drizzle do módulo de notificações (F15-S06).
//
// Responsabilidades:
//   - Listar notificações do usuário com paginação + unread_count.
//   - Marcar uma ou todas as notificações como lidas.
//   - Criar uma notificação in-app (usado pelo inApp sender).
//   - Ler e fazer upsert de preferências de canal.
//   - Resolver destinatários por assignee_role + city_id (para fan-out).
//
// City scope: as notificações já são por user_id — o escopo de tenant é
//   garantido por organization_id. Não há applyCityScope aqui porque
//   notificações são pessoais (já filtradas por user_id).
//
// LGPD §8.5: title/body podem ter PII indireta — não logar sem redact.
// =============================================================================
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import {
  notificationPreferences,
  notifications,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../db/schema/index.js';
import { AppError, NotFoundError } from '../../shared/errors.js';

import type {
  Notification,
  NotificationListQuery,
  NotificationListResponse,
  NotificationPreferencesList,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Mapper: Drizzle row → Notification
// ---------------------------------------------------------------------------

type NotificationRow = typeof notifications.$inferSelect;

function mapNotificationRow(row: NotificationRow): Notification {
  // A tabela `notifications` usa `type` para o tipo de notificação (ex: 'task.created').
  // O shared-schema NotificationSchema expõe `channel` (in_app|email|whatsapp).
  // O sender (inApp/email/whatsapp) passa o canal via campo `type` com prefixo:
  // 'in_app:task.created', 'email:task.created', 'whatsapp:task.created'.
  // Para notificações sem prefixo de canal, assume-se 'in_app'.
  const typeStr = row.type;
  let channel: Notification['channel'] = 'in_app';
  if (typeStr.startsWith('email:')) channel = 'email';
  else if (typeStr.startsWith('whatsapp:')) channel = 'whatsapp';

  return {
    id: row.id,
    organization_id: row.organizationId,
    user_id: row.userId,
    channel,
    title: row.title,
    body: row.body,
    entity_type: row.entityType ?? null,
    entity_id: row.entityId ?? null,
    read_at: row.readAt ? row.readAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface CreateNotificationInput {
  organizationId: string;
  userId: string;
  channel: 'in_app' | 'email' | 'whatsapp';
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
}

export interface RecipientUser {
  id: string;
  organizationId: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista notificações do usuário autenticado com paginação.
 * Inclui unread_count total (não afetado pela paginação).
 */
export async function listNotifications(
  db: Database,
  organizationId: string,
  userId: string,
  query: NotificationListQuery,
): Promise<NotificationListResponse> {
  const offset = (query.page - 1) * query.per_page;

  const [rows, countRows, unreadRows] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId)),
      )
      .orderBy(sql`${notifications.createdAt} DESC`)
      .limit(query.per_page)
      .offset(offset),
    db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(eq(notifications.organizationId, organizationId), eq(notifications.userId, userId)),
      ),
    db
      .select({ total: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.organizationId, organizationId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      ),
  ]);

  return {
    data: rows.map(mapNotificationRow),
    unread_count: unreadRows[0]?.total ?? 0,
    total: countRows[0]?.total ?? 0,
    page: query.page,
    per_page: query.per_page,
  };
}

/**
 * Marca uma notificação específica como lida.
 * Lança NotFoundError se não existir ou pertencer a outro usuário/org.
 * Idempotente: se já lida, retorna sem erro.
 */
export async function markNotificationRead(
  db: Database,
  organizationId: string,
  userId: string,
  notificationId: string,
): Promise<Notification> {
  const [existing] = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.organizationId, organizationId),
        eq(notifications.userId, userId),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new NotFoundError(`Notificação ${notificationId} não encontrada`);
  }

  // Idempotente: já lida — retornar sem UPDATE desnecessário
  if (existing.readAt !== null) {
    return mapNotificationRow(existing);
  }

  const [updated] = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.organizationId, organizationId),
        eq(notifications.userId, userId),
      ),
    )
    .returning();

  if (!updated) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao marcar notificação como lida');
  }

  return mapNotificationRow(updated);
}

/**
 * Marca todas as notificações não lidas do usuário como lidas.
 * Retorna o número de notificações marcadas.
 */
export async function markAllNotificationsRead(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<{ marked: number }> {
  const now = new Date();

  const updated = await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.organizationId, organizationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    )
    .returning({ id: notifications.id });

  return { marked: updated.length };
}

/**
 * Cria uma notificação no banco (usado pelo inApp sender).
 * LGPD: title/body podem ter PII indireta — não logar.
 */
export async function createNotification(
  db: Database,
  input: CreateNotificationInput,
): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      readAt: null,
      createdAt: new Date(),
    })
    .returning();

  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao criar notificação');
  }

  return mapNotificationRow(row);
}

/**
 * Retorna preferências de canal do usuário.
 * Canais não configurados são considerados enabled=true (opt-out model).
 */
export async function getNotificationPreferences(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<NotificationPreferencesList> {
  const CHANNELS = ['in_app', 'email', 'whatsapp'] as const;

  const rows = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, organizationId),
        eq(notificationPreferences.userId, userId),
      ),
    );

  // Mescla com defaults (canais não configurados = enabled)
  const data = CHANNELS.map((channel) => {
    const found = rows.find((r) => r.channel === channel);
    return { channel, enabled: found?.enabled ?? true };
  });

  return { data };
}

/**
 * Faz upsert de preferências de canal (um registro por canal por usuário).
 * Usa ON CONFLICT DO UPDATE via unique index (user_id, channel).
 */
export async function upsertNotificationPreferences(
  db: Database,
  organizationId: string,
  userId: string,
  updates: Array<{ channel: 'in_app' | 'email' | 'whatsapp'; enabled: boolean }>,
): Promise<NotificationPreferencesList> {
  const now = new Date();

  for (const update of updates) {
    await db
      .insert(notificationPreferences)
      .values({
        organizationId,
        userId,
        channel: update.channel,
        enabled: update.enabled,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [notificationPreferences.userId, notificationPreferences.channel],
        set: { enabled: update.enabled, updatedAt: now },
      });
  }

  return getNotificationPreferences(db, organizationId, userId);
}

/**
 * Retorna se um canal está habilitado para o usuário.
 * Default: true (opt-out model — sem registro = habilitado).
 */
export async function isChannelEnabled(
  db: Database,
  organizationId: string,
  userId: string,
  channel: 'in_app' | 'email' | 'whatsapp',
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, organizationId),
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channel, channel),
      ),
    )
    .limit(1);

  // Sem registro = canal habilitado (opt-out model)
  return row?.enabled ?? true;
}

/**
 * Resolve destinatários para fan-out de task.created.
 *
 * Retorna todos os usuários que possuem o assignee_role da tarefa
 * e cujo city_scope inclui a city_id da tarefa (ou city_id IS NULL = tarefa global).
 *
 * city_id null = tarefa global → todos com o role na organização recebem.
 */
export async function resolveTaskCreatedRecipients(
  db: Database,
  organizationId: string,
  assigneeRole: string,
  cityId: string | null,
): Promise<RecipientUser[]> {
  // Busca usuários com o role na organização
  const usersWithRole = await db
    .select({ id: users.id, organizationId: users.organizationId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(roles.key, assigneeRole),
        eq(users.status, 'active'),
      ),
    );

  if (usersWithRole.length === 0) return [];

  // Tarefa global (cityId null): todos os usuários com o role
  if (cityId === null) {
    return usersWithRole.map((u) => ({ id: u.id, organizationId: u.organizationId }));
  }

  // Tarefa com cidade: filtrar por city_scope
  const userIds = usersWithRole.map((u) => u.id);

  const usersInCity = await db
    .select({ userId: userCityScopes.userId })
    .from(userCityScopes)
    .where(and(eq(userCityScopes.cityId, cityId), inArray(userCityScopes.userId, userIds)));

  const recipientIds = new Set(usersInCity.map((r) => r.userId));

  return usersWithRole
    .filter((u) => recipientIds.has(u.id))
    .map((u) => ({ id: u.id, organizationId: u.organizationId }));
}

/**
 * Resolve destinatários para fan-out de contract.signed.
 *
 * Retorna os usuários admin/gestor_geral da organização (gerenciam contratos).
 */
export async function resolveContractSignedRecipients(
  db: Database,
  organizationId: string,
): Promise<RecipientUser[]> {
  const MANAGER_ROLES = ['admin', 'gestor_geral'];

  const rows = await db
    .select({ id: users.id, organizationId: users.organizationId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.organizationId, organizationId), inArray(roles.key, MANAGER_ROLES)));

  // Deduplica por user.id (pode ter múltiplos roles)
  const seen = new Set<string>();
  const result: RecipientUser[] = [];
  for (const row of rows) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      result.push({ id: row.id, organizationId: row.organizationId });
    }
  }
  return result;
}
