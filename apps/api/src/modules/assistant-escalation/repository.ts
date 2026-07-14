// =============================================================================
// assistant-escalation/repository.ts — Queries Drizzle de POST /api/assistant/escalate (F6-S30).
//
// Cobre:
//   - findLeadForEscalation  — lead + city-scope (404 fora do escopo, doc 10 §3.5).
//   - findRecentEscalation   — idempotência: escalação recente do mesmo lead.
//   - fetchCreditEscalationConfig — config-driven: organizations.settings.credit_escalation.
//   - findRoleKeysWithPermission  — fallback: roles que detêm uma permissão.
//
// Config `organizations.settings.credit_escalation` (jsonb livre, opcional):
//   { "city_id": "<uuid da matriz>", "role_keys": ["agente"] }
//   Setada manualmente em produção via SQL (fora do escopo desta migration/slot).
//   Ausente ou malformada -> service cai no fallback por permissão (ver service.ts).
//
// Segurança (doc 10 §3.4/§3.5): city-scope aplicado via cityScope() em leads.city_id.
// LGPD §8.5: nenhuma query aqui lê/retorna PII do lead — apenas IDs e city_id.
// =============================================================================
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../../db/client.js';
import {
  auditLogs,
  leads,
  organizations,
  permissions,
  rolePermissions,
  roles,
} from '../../db/schema/index.js';
import { cityScope } from '../../shared/scope.js';

// ---------------------------------------------------------------------------
// Ação canônica gravada em audit_logs (idempotência + painel de auditoria)
// ---------------------------------------------------------------------------

export const ASSISTANT_ESCALATE_ACTION = 'assistant.lead_escalated';

// ---------------------------------------------------------------------------
// Lead + city-scope
// ---------------------------------------------------------------------------

export interface LeadForEscalationRow {
  id: string;
  cityId: string | null;
}

/**
 * Busca o lead a ser escalado, já aplicando city-scope do usuário.
 * Retorna null se o lead não existe, está soft-deleted OU está fora do
 * escopo de cidade do usuário — o caller sempre trata como 404 (doc 10 §3.5),
 * nunca 403 (não vaza existência do recurso fora do escopo).
 */
export async function findLeadForEscalation(
  db: Database,
  organizationId: string,
  leadId: string,
  cityScopeIds: string[] | null,
): Promise<LeadForEscalationRow | null> {
  const conditions = [
    eq(leads.id, leadId),
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt),
  ];
  const scopeCondition = cityScope({ cityScopeIds }, leads.cityId);
  if (scopeCondition !== undefined) conditions.push(scopeCondition);

  const rows = await db
    .select({ id: leads.id, cityId: leads.cityId })
    .from(leads)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Idempotência — escalação recente do mesmo lead
// ---------------------------------------------------------------------------

export interface RecentEscalationRow {
  escalationId: string;
  recipientCount: number;
  createdAt: Date;
}

/**
 * Extrai recipient_count de audit_logs.after com type guard conservador.
 * `after` é jsonb livre — nunca confiar no shape sem checar.
 */
function extractRecipientCount(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const count = (value as Record<string, unknown>)['recipient_count'];
  return typeof count === 'number' ? count : 0;
}

/**
 * Busca a escalação mais recente do lead dentro da janela informada.
 * Usado para deduplicar POST /api/assistant/escalate repetido (idempotência).
 */
export async function findRecentEscalation(
  db: Database,
  organizationId: string,
  leadId: string,
  sinceDate: Date,
): Promise<RecentEscalationRow | null> {
  const rows = await db
    .select({ id: auditLogs.id, after: auditLogs.after, createdAt: auditLogs.createdAt })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        eq(auditLogs.action, ASSISTANT_ESCALATE_ACTION),
        eq(auditLogs.resourceType, 'lead'),
        eq(auditLogs.resourceId, leadId),
        gte(auditLogs.createdAt, sinceDate),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    escalationId: row.id,
    recipientCount: extractRecipientCount(row.after),
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Config-driven: organizations.settings.credit_escalation
// ---------------------------------------------------------------------------

const CreditEscalationConfigSchema = z.object({
  city_id: z.string().uuid().optional(),
  role_keys: z.array(z.string().min(1)).min(1).optional(),
});

export interface CreditEscalationConfig {
  /** null quando a config não define cidade — o caller trata como contexto global. */
  cityId: string | null;
  /** null quando a config não define role_keys — o caller cai no fallback por permissão. */
  roleKeys: string[] | null;
}

/**
 * Lê e valida `organizations.settings.credit_escalation` (jsonb livre, opcional).
 *
 * Retorna null quando a config está ausente OU malformada — o service trata
 * ambos os casos como "sem config", caindo no fallback por permissão
 * (roles que detêm credit_analyses:decide, escopo global). Nunca lança —
 * settings é jsonb aberto e não deve derrubar o fluxo de escalação por
 * um valor inválido setado manualmente em produção.
 */
export async function fetchCreditEscalationConfig(
  db: Database,
  organizationId: string,
): Promise<CreditEscalationConfig | null> {
  const rows = await db
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;

  const settings: unknown = row.settings;
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return null;

  const raw = (settings as Record<string, unknown>)['credit_escalation'];
  if (raw === undefined || raw === null) return null;

  const parsed = CreditEscalationConfigSchema.safeParse(raw);
  if (!parsed.success) return null;

  return {
    cityId: parsed.data.city_id ?? null,
    roleKeys: parsed.data.role_keys ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fallback: roles que detêm uma permissão
// ---------------------------------------------------------------------------

/**
 * Retorna as role keys (deduplicadas) que detêm a permissão informada.
 * Usado como fallback de destinatários quando `credit_escalation.role_keys`
 * não está configurado — evita hardcode de role keys que podem divergir da
 * concessão real em role_permissions (ver migration 0033).
 */
export async function findRoleKeysWithPermission(
  db: Database,
  permissionKey: string,
): Promise<string[]> {
  const rows = await db
    .select({ key: roles.key })
    .from(roles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(eq(permissions.key, permissionKey));

  return Array.from(new Set(rows.map((r) => r.key)));
}
