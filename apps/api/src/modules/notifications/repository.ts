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
// F24-S09 — Preferências por categoria × canal:
//   - getNotificationPreferences: retorna matriz (channel, category).
//   - upsertNotificationPreferences: upsert via partial indexes (category IS NULL /
//     category IS NOT NULL) conforme schema F24-S01.
//   - isCategoryChannelEnabled: resolve habilitação com fallback
//       override de categoria > default do canal (NULL) > true.
//   - isChannelEnabled: mantido para retrocompat com fanout-notification.ts.
//
// City scope: as notificações já são por user_id — o escopo de tenant é
//   garantido por organization_id. Não há applyCityScope aqui porque
//   notificações são pessoais (já filtradas por user_id).
//
// LGPD §8.5: title/body podem ter PII indireta — não logar sem redact.
// =============================================================================
import type { NotificationCategory } from '@elemento/shared-schemas';
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import {
  notificationPreferences,
  notifications,
  pushSubscriptions,
  roles,
  userCityScopes,
  userRoles,
  users,
} from '../../db/schema/index.js';
import type { PushSubscription } from '../../db/schema/pushSubscriptions.js';
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js';

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
    severity: row.severity,
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
  /**
   * Severidade da notificação — mesmo domínio de valores do payload do
   * socket (NotificationSocketSeverity). Default 'info' quando o caller
   * não especifica (retrocompat com senders que ainda não passam severity).
   */
  severity?: 'info' | 'warning' | 'critical';
}

export interface RecipientUser {
  id: string;
  organizationId: string;
}

/** Item de atualização de preferência de notificação. F24-S09: inclui category opcional. */
export interface NotificationPreferenceUpdateItem {
  channel: 'in_app' | 'email' | 'whatsapp';
  enabled: boolean;
  /**
   * Categoria da preferência.
   * - Ausente / undefined / null → preferência genérica do canal (retrocompat, category=NULL no DB).
   * - string → preferência específica para aquela categoria.
   *
   * `| undefined` necessário para compatibilidade com exactOptionalPropertyTypes:
   * Zod's .optional() infere `T | null | undefined` que inclui undefined no value type.
   */
  category?: NotificationCategory | null | undefined;
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
      severity: input.severity ?? 'info',
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
 * Retorna preferências de canal do usuário — matriz (channel × category).
 *
 * F24-S09: Inclui tanto as preferências genéricas de canal (category=NULL,
 * sempre presentes — padrão habilitado) quanto as preferências específicas
 * por categoria configuradas pelo usuário.
 *
 * Estrutura da resposta:
 *   - 3 itens com category=null (um por canal — default do canal).
 *   - 0..N itens com category preenchida (overrides de categoria).
 *
 * Canais sem registro configurado têm enabled=true (opt-out model).
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
    )
    .orderBy(notificationPreferences.channel, notificationPreferences.category);

  // Separa: defaults de canal (category=null) vs overrides de categoria
  const channelDefaultMap = new Map<string, boolean>();
  const categoryItems: Array<{ channel: string; enabled: boolean; category: string }> = [];

  for (const row of rows) {
    const cat = row.category;
    if (cat === null) {
      channelDefaultMap.set(row.channel, row.enabled);
    } else {
      categoryItems.push({ channel: row.channel, enabled: row.enabled, category: cat });
    }
  }

  // Defaults de canal: sempre 1 por canal, habilitado se não configurado
  const channelDefaults = CHANNELS.map((ch) => ({
    channel: ch,
    enabled: channelDefaultMap.get(ch) ?? true,
    category: null as null,
  }));

  // Overrides de categoria: `as NotificationCategory` justificado —
  // os valores são escritos apenas via `upsertNotificationPreferences`
  // que valida a categoria via Zod antes de persisti-la.
  const categoryOverrides = categoryItems.map((item) => ({
    channel: item.channel as 'in_app' | 'email' | 'whatsapp',
    enabled: item.enabled,
    category: item.category as NotificationCategory,
  }));

  return { data: [...channelDefaults, ...categoryOverrides] };
}

/**
 * Faz upsert de preferências de canal (F24-S09: suporte a category).
 *
 * Usa dois partial unique indexes distintos (schema F24-S01):
 *   - category IS NULL     → uq_notification_preferences_user_channel_null_cat
 *                            target: (user_id, channel)
 *   - category IS NOT NULL → uq_notification_preferences_user_channel_cat
 *                            target: (user_id, channel, category)
 *
 * Item sem category (ou category=null) → atualiza/insere o default do canal.
 * Item com category → atualiza/insere override de categoria.
 *
 * Idempotente: re-enviar o mesmo payload é no-op.
 */
export async function upsertNotificationPreferences(
  db: Database,
  organizationId: string,
  userId: string,
  updates: NotificationPreferenceUpdateItem[],
): Promise<NotificationPreferencesList> {
  const now = new Date();

  for (const update of updates) {
    // Normaliza undefined/null → null (preferência genérica de canal)
    const categoryValue = update.category ?? null;

    if (categoryValue === null) {
      // Caminho: preferência genérica de canal (category=NULL)
      // Conflito detectado pelo índice parcial WHERE category IS NULL
      await db
        .insert(notificationPreferences)
        .values({
          organizationId,
          userId,
          channel: update.channel,
          category: null,
          enabled: update.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.channel],
          targetWhere: sql`${notificationPreferences.category} IS NULL`,
          set: { enabled: update.enabled, updatedAt: now },
        });
    } else {
      // Caminho: override de categoria específica (category IS NOT NULL)
      // Conflito detectado pelo índice parcial WHERE category IS NOT NULL
      await db
        .insert(notificationPreferences)
        .values({
          organizationId,
          userId,
          channel: update.channel,
          category: categoryValue,
          enabled: update.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreferences.userId,
            notificationPreferences.channel,
            notificationPreferences.category,
          ],
          targetWhere: sql`${notificationPreferences.category} IS NOT NULL`,
          set: { enabled: update.enabled, updatedAt: now },
        });
    }
  }

  return getNotificationPreferences(db, organizationId, userId);
}

/**
 * Resolve se o canal está habilitado para o usuário levando em conta a categoria.
 *
 * F24-S09 — Lógica de fallback (opt-out model):
 *   1. Override de categoria (user_id, channel, category IS NOT NULL) — mais específico.
 *   2. Default do canal    (user_id, channel, category IS NULL)       — fallback.
 *   3. true (habilitado)                                               — sem registro.
 *
 * Busca ambos em uma única query ordenando por especificidade:
 *   ORDER BY (category IS NULL) ASC
 *   → category=valor (específico, IS NULL=false=0) vem antes de category=NULL (genérico, IS NULL=true=1).
 *   LIMIT 1 → retorna o mais específico disponível.
 *
 * Usado pelo worker de fan-out (F24-S10+) e pelo serviço de notificações.
 */
export async function isCategoryChannelEnabled(
  db: Database,
  organizationId: string,
  userId: string,
  channel: 'in_app' | 'email' | 'whatsapp',
  category: NotificationCategory,
): Promise<boolean> {
  const [row] = await db
    .select({ enabled: notificationPreferences.enabled })
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.organizationId, organizationId),
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.channel, channel),
        or(
          eq(notificationPreferences.category, category),
          isNull(notificationPreferences.category),
        ),
      ),
    )
    // ORDER BY (category IS NULL) ASC: IS NULL=false(0)=específico, IS NULL=true(1)=genérico
    // Specific override vem primeiro → LIMIT 1 já devolve o override se existir.
    .orderBy(sql`(${notificationPreferences.category} IS NULL) ASC`)
    .limit(1);

  // Sem registro = canal habilitado (opt-out model)
  return row?.enabled ?? true;
}

/**
 * Retorna se um canal está habilitado para o usuário (sem levar em conta categoria).
 * Mantido para retrocompat com fanout-notification.ts (F15-S06).
 * @deprecated Prefer isCategoryChannelEnabled for category-aware resolution.
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
        isNull(notificationPreferences.category),
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

// ---------------------------------------------------------------------------
// Web Push subscriptions (F27-S06 — doc 24 §5/§8)
//
// LGPD: endpoint/p256dh/auth são DADO PESSOAL (device) — nunca logados aqui;
// pino.redact cobre esses campos em app.ts (borda HTTP) e no sender dedicado
// (senders/webPush.ts).
// ---------------------------------------------------------------------------

export interface UpsertPushSubscriptionInput {
  organizationId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

/**
 * Upsert idempotente de uma subscription de push por `endpoint` (índice único
 * parcial `uq_push_subscriptions_endpoint_active WHERE deleted_at IS NULL`,
 * F27-S05).
 *
 * Reenviar a mesma subscription é no-op efetivo (apenas atualiza keys/
 * updatedAt). Se o endpoint já existia como soft-deleted, revive a linha
 * (deletedAt=null) — cenário de reinstalação do PWA / novo opt-in.
 *
 * Reassoca `userId`/`organizationId` ao dono mais recente da requisição: um
 * mesmo endpoint de browser reutilizado por outro usuário autenticado no
 * mesmo device (ex.: troca de operador num terminal compartilhado) passa a
 * notificar o usuário atualmente logado — mesmo raciocínio de "subscribe
 * sempre vincula ao usuário autenticado no momento".
 *
 * Guarda de isolamento cross-org (F27-S06 hardening): a reatribuição só é
 * permitida DENTRO da mesma organização. Um endpoint ativo pertencente a OUTRA
 * organização não pode ser reivindicado — sem isso, quem conhecesse um endpoint
 * ativo de outra org poderia "roubar" a linha (o índice único em `endpoint` não
 * é escopado por org). Rejeita com 403 antes de qualquer escrita.
 */
export async function upsertPushSubscription(
  db: Database,
  input: UpsertPushSubscriptionInput,
): Promise<{ id: string }> {
  const now = new Date();

  // Isolamento cross-org: se o endpoint já tem uma linha ATIVA de outra
  // organização, recusa (não reatribui). Dentro da mesma org, a reatribuição
  // (terminal compartilhado entre colegas) segue permitida via onConflict.
  const [existing] = await db
    .select({ organizationId: pushSubscriptions.organizationId })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, input.endpoint), isNull(pushSubscriptions.deletedAt)))
    .limit(1);

  if (existing && existing.organizationId !== input.organizationId) {
    throw new ForbiddenError('Endpoint de push já registrado em outra organização');
  }

  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      targetWhere: sql`${pushSubscriptions.deletedAt} IS NULL`,
      set: {
        organizationId: input.organizationId,
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        updatedAt: now,
        deletedAt: null,
      },
    })
    .returning({ id: pushSubscriptions.id });

  if (!row) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Falha ao registrar subscription de push');
  }

  return { id: row.id };
}

/**
 * Soft-delete de uma subscription de push por `endpoint`.
 *
 * Usado em dois contextos:
 *   - Opt-out/logout do próprio usuário (rota DELETE) — escopo por
 *     (organizationId, userId, endpoint), evitando remoção cross-user.
 *   - Sender removendo subscription morta (404/410) — mesmo escopo,
 *     usando o (organizationId, userId) já resolvido da subscription.
 *
 * Idempotente: se não encontrar linha ativa (já removida ou inexistente),
 * retorna `null` sem lançar — o caller trata como no-op bem-sucedido.
 *
 * @returns UUID da subscription removida, ou `null` se nada foi removido.
 */
export async function softDeletePushSubscriptionByEndpoint(
  db: Database,
  organizationId: string,
  userId: string,
  endpoint: string,
): Promise<string | null> {
  const [row] = await db
    .update(pushSubscriptions)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(pushSubscriptions.organizationId, organizationId),
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
        isNull(pushSubscriptions.deletedAt),
      ),
    )
    .returning({ id: pushSubscriptions.id });

  return row?.id ?? null;
}

/**
 * Retorna as subscriptions ATIVAS (deletedAt IS NULL) de um usuário —
 * usado pelo sender de push para saber a quais devices entregar.
 */
export async function getActivePushSubscriptionsByUser(
  db: Database,
  organizationId: string,
  userId: string,
): Promise<PushSubscription[]> {
  return db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.organizationId, organizationId),
        eq(pushSubscriptions.userId, userId),
        isNull(pushSubscriptions.deletedAt),
      ),
    );
}
