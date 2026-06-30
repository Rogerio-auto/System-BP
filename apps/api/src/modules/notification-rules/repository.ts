// =============================================================================
// notification-rules/repository.ts — Queries Drizzle para regras de notificação.
//
// Responsabilidades:
//   - CRUD de notification_rules com org-scope obrigatório.
//   - Mapeamento city_scope ↔ filters jsonb (B-08):
//       API expõe city_scope (string[]);
//       DB persiste em filters->>'city_scope' (jsonb).
//   - Todas as queries filtram por organizationId (multi-tenant).
//
// LGPD:
//   - title_template/body_template podem ter PII indireta após interpolação.
//   - Não logar sem redact.
// =============================================================================
import { and, count, desc, eq, ilike, or } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { notificationRules } from '../../db/schema/notificationRules.js';
import type { NotificationRule, NewNotificationRule } from '../../db/schema/notificationRules.js';

// ---------------------------------------------------------------------------
// Tipos de I/O do repositório
// ---------------------------------------------------------------------------

export interface NotificationRuleListQuery {
  page: number;
  per_page: number;
  search?: string | undefined;
  enabled?: boolean | undefined;
}

export interface PaginatedNotificationRules {
  data: NotificationRule[];
  total: number;
}

export interface CreateNotificationRuleInput {
  organizationId: string;
  name: string;
  triggerKind: 'event' | 'stage_inactivity';
  triggerKey: string;
  category: string;
  recipientMode: 'by_role_city' | 'assignee' | 'managers';
  recipientRoles: string[];
  severity: 'info' | 'warning' | 'critical';
  channels: string[];
  titleTemplate: string;
  bodyTemplate: string;
  thresholdHours?: number | null;
  cooldownHours: number;
  enabled: boolean;
  cityScope?: string[] | null;
  createdBy: string | null;
}

export interface UpdateNotificationRuleInput {
  name?: string;
  triggerKind?: 'event' | 'stage_inactivity';
  triggerKey?: string;
  category?: string;
  recipientMode?: 'by_role_city' | 'assignee' | 'managers';
  recipientRoles?: string[];
  severity?: 'info' | 'warning' | 'critical';
  channels?: string[];
  titleTemplate?: string;
  bodyTemplate?: string;
  thresholdHours?: number | null;
  cooldownHours?: number;
  enabled?: boolean;
  cityScope?: string[] | null;
}

// ---------------------------------------------------------------------------
// Helpers — city_scope ↔ filters jsonb (B-08)
// ---------------------------------------------------------------------------

/**
 * Extrai city_scope de filters jsonb.
 * null quando filters não contém city_scope ou o array está vazio.
 */
function extractCityScope(filters: unknown): string[] | null {
  if (filters === null || typeof filters !== 'object') return null;
  const f = filters as Record<string, unknown>;
  const cs = f['city_scope'];
  if (!Array.isArray(cs) || cs.length === 0) return null;
  // `as` justificado: jsonb armazenado por este próprio repositório;
  // o valor sempre é string[] quando presente (garantido pelo service layer).
  return cs as string[];
}

/**
 * Constrói o jsonb de filters a partir de city_scope.
 * Inclui apenas city_scope para não apagar outros filtros futuros.
 */
function buildFilters(cityScope: string[] | null | undefined): Record<string, unknown> {
  if (cityScope === null || cityScope === undefined || cityScope.length === 0) return {};
  return { city_scope: cityScope };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Lista regras da organização com paginação e filtros opcionais.
 */
export async function findNotificationRules(
  db: Database,
  organizationId: string,
  query: NotificationRuleListQuery,
): Promise<PaginatedNotificationRules> {
  const offset = (query.page - 1) * query.per_page;

  // `as` justificado: and() espera SQL<boolean>; eq/ilike/or retornam tipos compatíveis
  const conditions: ReturnType<typeof eq>[] = [
    eq(notificationRules.organizationId, organizationId),
  ];

  if (query.enabled !== undefined) {
    conditions.push(eq(notificationRules.enabled, query.enabled));
  }

  if (query.search !== undefined && query.search.length > 0) {
    const pattern = `%${query.search}%`;
    conditions.push(
      or(
        ilike(notificationRules.name, pattern),
        ilike(notificationRules.triggerKey, pattern),
      ) as ReturnType<typeof eq>,
    );
  }

  const where = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(notificationRules)
      .where(where)
      .orderBy(desc(notificationRules.createdAt))
      .limit(query.per_page)
      .offset(offset),
    db.select({ total: count() }).from(notificationRules).where(where),
  ]);

  return {
    data: rows,
    total: countRows[0]?.total ?? 0,
  };
}

/**
 * Busca uma regra pelo ID dentro da organização.
 * Retorna null se não encontrada ou pertencer a outra org.
 */
export async function findNotificationRuleById(
  db: Database,
  organizationId: string,
  ruleId: string,
): Promise<NotificationRule | null> {
  const rows = await db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.id, ruleId),
        eq(notificationRules.organizationId, organizationId),
      ) as ReturnType<typeof eq>,
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Insere uma nova regra. Deve ser chamado dentro de transação.
 *
 * Mapeia city_scope (API) → filters jsonb (DB) (B-08).
 */
export async function insertNotificationRule(
  db: Database,
  input: CreateNotificationRuleInput,
): Promise<NotificationRule> {
  const values: NewNotificationRule = {
    organizationId: input.organizationId,
    name: input.name,
    triggerKind: input.triggerKind,
    triggerKey: input.triggerKey,
    category: input.category,
    recipientMode: input.recipientMode,
    recipientRoles: input.recipientRoles,
    severity: input.severity,
    channels: input.channels,
    titleTemplate: input.titleTemplate,
    bodyTemplate: input.bodyTemplate,
    cooldownHours: input.cooldownHours,
    enabled: input.enabled,
    filters: buildFilters(input.cityScope),
    // exactOptionalPropertyTypes: campos nullable incluídos condicionalmente
    ...(input.thresholdHours !== undefined && input.thresholdHours !== null
      ? { thresholdHours: input.thresholdHours }
      : {}),
    ...(input.createdBy !== null ? { createdBy: input.createdBy } : {}),
  };

  const rows = await db.insert(notificationRules).values(values).returning();
  const rule = rows[0];
  if (rule === undefined) {
    throw new Error('[notification-rules] Falha ao inserir regra');
  }
  return rule;
}

/**
 * Atualiza uma regra existente. Deve ser chamado dentro de transação.
 *
 * Mapeia city_scope (API) → filters jsonb (DB) (B-08).
 * Retorna null se não encontrada ou pertencer a outra org.
 */
export async function updateNotificationRule(
  db: Database,
  organizationId: string,
  ruleId: string,
  input: UpdateNotificationRuleInput,
): Promise<NotificationRule | null> {
  // Construir payload de update sem incluir campos não fornecidos
  const setValues: Partial<{
    name: string;
    triggerKind: 'event' | 'stage_inactivity';
    triggerKey: string;
    category: string;
    recipientMode: 'by_role_city' | 'assignee' | 'managers';
    recipientRoles: string[];
    severity: 'info' | 'warning' | 'critical';
    channels: string[];
    titleTemplate: string;
    bodyTemplate: string;
    thresholdHours: number | null;
    cooldownHours: number;
    enabled: boolean;
    filters: Record<string, unknown>;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (input.name !== undefined) setValues.name = input.name;
  if (input.triggerKind !== undefined) setValues.triggerKind = input.triggerKind;
  if (input.triggerKey !== undefined) setValues.triggerKey = input.triggerKey;
  if (input.category !== undefined) setValues.category = input.category;
  if (input.recipientMode !== undefined) setValues.recipientMode = input.recipientMode;
  if (input.recipientRoles !== undefined) setValues.recipientRoles = input.recipientRoles;
  if (input.severity !== undefined) setValues.severity = input.severity;
  if (input.channels !== undefined) setValues.channels = input.channels;
  if (input.titleTemplate !== undefined) setValues.titleTemplate = input.titleTemplate;
  if (input.bodyTemplate !== undefined) setValues.bodyTemplate = input.bodyTemplate;
  if (input.thresholdHours !== undefined) setValues.thresholdHours = input.thresholdHours;
  if (input.cooldownHours !== undefined) setValues.cooldownHours = input.cooldownHours;
  if (input.enabled !== undefined) setValues.enabled = input.enabled;
  // B-08: city_scope → filters jsonb
  if (input.cityScope !== undefined) {
    setValues.filters = buildFilters(input.cityScope);
  }

  const rows = await db
    .update(notificationRules)
    .set(setValues)
    .where(
      and(
        eq(notificationRules.id, ruleId),
        eq(notificationRules.organizationId, organizationId),
      ) as ReturnType<typeof eq>,
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Remove uma regra (hard delete). Deve ser chamado dentro de transação.
 * Retorna null se não encontrada ou pertencer a outra org.
 */
export async function deleteNotificationRule(
  db: Database,
  organizationId: string,
  ruleId: string,
): Promise<NotificationRule | null> {
  const rows = await db
    .delete(notificationRules)
    .where(
      and(
        eq(notificationRules.id, ruleId),
        eq(notificationRules.organizationId, organizationId),
      ) as ReturnType<typeof eq>,
    )
    .returning();

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Re-export helper para o service layer
// ---------------------------------------------------------------------------
export { extractCityScope };
