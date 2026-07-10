// =============================================================================
// ai-actions/repository.ts — Queries Drizzle do painel "IA nas últimas 24h" (F25-S06).
//
// Fonte: audit_logs (actor_type='ai' OU actor_role='ai' — ver nota abaixo) +
// leads (join mínimo para nome mascarado + city_id de escopo).
//
// NOTA — gap conhecido de actor_type (docs/22 §8.A, migration 0078):
//   `qualifyLead` (F25-S03, leads/service.ts) insere audit_logs diretamente com
//   actor_type='ai'. Já `funnel-housekeeping` (F25-S05) usa o helper auditLog()
//   passando `actor: { role: 'ai' }` — mas lib/audit.ts (fora do escopo deste
//   slot) não expõe actor_type como parâmetro, então essas linhas ficam com
//   actor_type='user' (default da coluna). Para não perder leads.stagnant/
//   leads.abandoned do painel, filtramos por `actor_type = 'ai' OR actor_role
//   = 'ai'` — actor_role é setado corretamente pelo helper em ambos os casos.
//   Corrigir a raiz (lib/audit.ts aceitar actor_type) fica para slot futuro.
//
// Segurança (doc 10 §3.4/§3.5): city-scope aplicado via JOIN leads.city_id.
// Linhas sem lead correspondente (órfãs) são excluídas para usuários com
// escopo restrito — nunca vazam para fora do escopo por ausência de dado.
//
// LGPD §8.5: nenhuma PII bruta sai desta camada — apenas leads.name (mascarado
// pelo service antes de sair da API) e IDs opacos.
// =============================================================================
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { auditLogs, kanbanCards, kanbanStages, leads } from '../../db/schema/index.js';
import type { Lead } from '../../db/schema/index.js';
import { cityScope } from '../../shared/scope.js';

import { AI_ACTION_NAMES, REVERTIBLE_AI_ACTION_NAMES } from './schemas.js';
import type { AiActionName } from './schemas.js';

// ---------------------------------------------------------------------------
// GET /api/ai-actions — listagem
// ---------------------------------------------------------------------------

export interface AiActionListRow {
  actionId: string;
  action: AiActionName;
  leadId: string;
  leadName: string | null;
  cityId: string | null;
  occurredAt: Date;
  reverted: boolean;
}

export interface ListAiActionsParams {
  organizationId: string;
  /** null = escopo global (admin/gestor_geral). [] = sem cidade — zero linhas. */
  cityScopeIds: string[] | null;
  sinceDate: Date;
  limit: number;
  offset: number;
}

/**
 * Fragmento WHERE compartilhado entre a query de contagem e a de dados.
 * `al` = alias de audit_logs, `l` = alias de leads (LEFT JOIN).
 */
function buildAiActionsWhereFragment(
  organizationId: string,
  sinceDate: Date,
  cityScopeIds: string[] | null,
): ReturnType<typeof sql> {
  let cityFrag: ReturnType<typeof sql>;
  if (cityScopeIds === null) {
    cityFrag = sql``;
  } else if (cityScopeIds.length === 0) {
    cityFrag = sql`AND 1 = 0`;
  } else {
    cityFrag = sql`AND l.city_id IN (${sql.join(
      cityScopeIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  // Lista de actions parametrizada — nunca sql.raw() com input de usuário.
  const actionsFrag = sql.join(
    AI_ACTION_NAMES.map((name) => sql`${name}`),
    sql`, `,
  );

  return sql`
    al.organization_id = ${organizationId}
      AND al.resource_type = 'lead'
      AND al.action IN (${actionsFrag})
      AND (al.actor_type = 'ai' OR al.actor_role = 'ai')
      AND al.created_at >= ${sinceDate.toISOString()}::timestamptz
      ${cityFrag}
  `;
}

/**
 * Lista as ações da IA no funil dentro da janela informada, city-scoped.
 * Retorna também `reverted` (EXISTS de um audit_log 'ai_actions.reverted'
 * correlacionado) para a UI já saber quais ações já foram desfeitas.
 */
export async function listAiActionsRaw(
  db: Database,
  params: ListAiActionsParams,
): Promise<{ rows: AiActionListRow[]; total: number }> {
  const { organizationId, cityScopeIds, sinceDate, limit, offset } = params;

  // Curto-circuito: sem cidade nenhuma no escopo, sem consulta ao banco.
  if (cityScopeIds !== null && cityScopeIds.length === 0) {
    return { rows: [], total: 0 };
  }

  const whereFrag = buildAiActionsWhereFragment(organizationId, sinceDate, cityScopeIds);

  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS total
    FROM audit_logs al
    LEFT JOIN leads l ON l.id = al.resource_id::uuid
    WHERE ${whereFrag}
  `);
  // `as` justificado: db.execute retorna unknown[] — tipamos o shape da agregação acima.
  const total = Number((countResult.rows[0] as { total: string | number } | undefined)?.total ?? 0);

  if (total === 0) {
    return { rows: [], total: 0 };
  }

  const dataResult = await db.execute(sql`
    SELECT
      al.id AS action_id,
      al.action AS action,
      al.resource_id AS lead_id,
      al.created_at AS occurred_at,
      l.name AS lead_name,
      l.city_id AS city_id,
      EXISTS (
        SELECT 1 FROM audit_logs r
        WHERE r.organization_id = ${organizationId}
          AND r.action = 'ai_actions.reverted'
          AND r.correlation_id = al.id
      ) AS reverted
    FROM audit_logs al
    LEFT JOIN leads l ON l.id = al.resource_id::uuid
    WHERE ${whereFrag}
    ORDER BY al.created_at DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `);

  // `as` justificado: db.execute retorna unknown[] — tipamos o shape do SELECT acima.
  const rows = (
    dataResult.rows as Array<{
      action_id: string;
      action: string;
      lead_id: string;
      occurred_at: string | Date;
      lead_name: string | null;
      city_id: string | null;
      reverted: boolean;
    }>
  ).map((r) => ({
    actionId: r.action_id,
    // `as` justificado: al.action já filtrado por WHERE ... IN (AI_ACTION_NAMES) acima.
    action: r.action as AiActionName,
    leadId: r.lead_id,
    leadName: r.lead_name,
    cityId: r.city_id,
    occurredAt: r.occurred_at instanceof Date ? r.occurred_at : new Date(r.occurred_at),
    reverted: Boolean(r.reverted),
  }));

  return { rows, total };
}

// ---------------------------------------------------------------------------
// POST /api/ai-actions/:id/revert — leituras de apoio
// ---------------------------------------------------------------------------

export interface AiActionAuditRow {
  id: string;
  action: AiActionName;
  leadId: string;
  /** `status` extraído de audit_logs.before, quando presente. */
  beforeStatus: string | null;
  createdAt: Date;
}

function extractStatus(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null;
  const status = (value as Record<string, unknown>)['status'];
  return typeof status === 'string' ? status : null;
}

/**
 * Busca uma ação da IA por id (audit_logs.id), restrita à organização e ao
 * conjunto de ações cobertas pelo painel. Retorna null se não existir —
 * o service decide se isso vira 404 (nunca vaza detalhe do motivo).
 */
export async function findAiActionById(
  db: Database,
  organizationId: string,
  actionId: string,
): Promise<AiActionAuditRow | null> {
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      leadId: auditLogs.resourceId,
      before: auditLogs.before,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.id, actionId),
        eq(auditLogs.organizationId, organizationId),
        eq(auditLogs.resourceType, 'lead'),
        inArray(auditLogs.action, [...AI_ACTION_NAMES]),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    // `as` justificado: filtrado por inArray(AI_ACTION_NAMES) na query acima.
    action: row.action as AiActionName,
    leadId: row.leadId,
    beforeStatus: extractStatus(row.before),
    createdAt: row.createdAt,
  };
}

export interface LeadForRevertRow {
  id: string;
  cityId: string | null;
  status: Lead['status'];
}

/**
 * Busca o lead associado a uma ação da IA, já aplicando city-scope.
 * Retorna null se o lead não existe, está soft-deleted OU está fora do
 * escopo de cidade do usuário — o caller sempre trata como 404 (doc 10 §3.5).
 */
export async function findLeadForRevert(
  db: Database,
  organizationId: string,
  leadId: string,
  cityScopeIds: string[] | null,
): Promise<LeadForRevertRow | null> {
  const conditions = [
    eq(leads.id, leadId),
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt),
  ];
  const scopeCondition = cityScope({ cityScopeIds }, leads.cityId);
  if (scopeCondition !== undefined) conditions.push(scopeCondition);

  const rows = await db
    .select({ id: leads.id, cityId: leads.cityId, status: leads.status })
    .from(leads)
    .where(and(...conditions))
    .limit(1);

  return rows[0] ?? null;
}

export interface KanbanCardForRevertRow {
  priority: number;
  canonicalRole: string | null;
}

/**
 * Busca priority + canonical_role do stage atual do card do lead.
 * Usado para derivar um status não-terminal coerente ao reabrir um lead
 * abandonado (doc 22 §11 — "closed_lost -> stage não-terminal").
 */
export async function findKanbanCardForLead(
  db: Database,
  organizationId: string,
  leadId: string,
): Promise<KanbanCardForRevertRow | null> {
  const rows = await db
    .select({ priority: kanbanCards.priority, canonicalRole: kanbanStages.canonicalRole })
    .from(kanbanCards)
    .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
    .where(and(eq(kanbanCards.leadId, leadId), eq(kanbanCards.organizationId, organizationId)))
    .limit(1);

  return rows[0] ?? null;
}

export interface ExistingRevertRow {
  leadId: string;
  previousStatus: string | null;
  currentStatus: string | null;
  createdAt: Date;
}

/**
 * Verifica se a ação já foi revertida antes (idempotência de
 * POST /api/ai-actions/:id/revert). Correlaciona via audit_logs.correlation_id
 * = id da ação original.
 */
export async function findExistingRevert(
  db: Database,
  organizationId: string,
  originalActionId: string,
): Promise<ExistingRevertRow | null> {
  const rows = await db
    .select({
      resourceId: auditLogs.resourceId,
      before: auditLogs.before,
      after: auditLogs.after,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.organizationId, organizationId),
        eq(auditLogs.action, 'ai_actions.reverted'),
        eq(auditLogs.correlationId, originalActionId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    leadId: row.resourceId,
    previousStatus: extractStatus(row.before),
    currentStatus: extractStatus(row.after),
    createdAt: row.createdAt,
  };
}

// Reexport para o service não precisar importar de schemas.js diretamente
// só para checar revertibilidade (mantém a lista canônica em um único lugar).
export { REVERTIBLE_AI_ACTION_NAMES };
