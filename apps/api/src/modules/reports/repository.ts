// reports/repository.ts (F23-S03)
// Todas as queries contra MVs usam sql`` parametrizado — sem sql.raw(), sem interpolação
// de string crua, sem sanitizadores manuais. Valores entram via placeholders do Drizzle
// (parametrizados pelo driver pg). Padrão: dashboard/repository.ts §buildCollectionCityFragment.
import { and, count, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { conversations } from '../../db/schema/conversations.js';
import { leads } from '../../db/schema/leads.js';
import { messages } from '../../db/schema/messages.js';
import type { UserScopeCtx } from '../../shared/scope.js';
import { cityScope } from '../../shared/scope.js';

export interface DateRange {
  from: Date;
  to: Date;
}
export interface OverviewLeadsResult {
  total: number;
  newInPeriod: number;
  closedWon: number;
  closedLost: number;
  conversionRate: number;
}
export interface OverviewSimulationsResult {
  total: number;
  amountSum: number;
  amountAvg: number;
}
export interface OverviewContractsResult {
  active: number;
  settled: number;
  defaulted: number;
  activePrincipalSum: number;
}
export interface OverviewConversationsResult {
  open: number;
  resolved: number;
}
export interface FunnelStageRow {
  stageId: string;
  stageName: string;
  stageOrder: number;
  cardCount: number;
  staleCardCount: number;
  avgDwellHours: number | null;
  medianDwellHours: number | null;
}
export interface AttendanceByChannelRow {
  channel: string;
  conversationCount: number;
  messageCount: number;
}
export interface AttendanceTotalsResult {
  conversationsOpened: number;
  conversationsResolved: number;
  messagesTotal: number;
}
export interface AttendanceTimingsResult {
  firstResponseAvgSec: number | null;
  firstResponseP90Sec: number | null;
  resolutionAvgSec: number | null;
  resolutionP90Sec: number | null;
}

// ---------------------------------------------------------------------------
// Helpers de fragmento SQL parametrizado para city scope nas MVs
// ---------------------------------------------------------------------------

/**
 * Constrói fragmentos SQL parametrizados de city scope para queries contra MVs.
 * O alias da tabela (ex: 'f', 'mv') é um valor literal do código — nunca input do usuário.
 * Padrão idêntico a dashboard/repository.ts§buildCollectionCityFragment.
 *
 * Semântica de cityScopeIds:
 *   null     → acesso global: fragmento vazio (sem filtro).
 *   []       → sem acesso: AND 1 = 0.
 *   string[] → AND city_id IN ($1, $2, ...) com placeholders parametrizados.
 */
function mvCityScopeClause(
  cityScopeIds: string[] | null,
  filterCityIds: string[] | undefined,
): {
  scopeFrag: ReturnType<typeof sql>;
  filterFrag: ReturnType<typeof sql>;
} {
  let scopeFrag: ReturnType<typeof sql>;
  if (cityScopeIds === null) {
    scopeFrag = sql``;
  } else if (cityScopeIds.length === 0) {
    scopeFrag = sql`AND 1 = 0`;
  } else {
    scopeFrag = sql`AND city_id IN (${sql.join(
      cityScopeIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  let filterFrag: ReturnType<typeof sql>;
  if (filterCityIds === undefined || filterCityIds.length === 0) {
    filterFrag = sql``;
  } else {
    filterFrag = sql`AND city_id IN (${sql.join(
      filterCityIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  return { scopeFrag, filterFrag };
}

/**
 * Variante com prefixo de alias explícito (para queries com múltiplos JOINs).
 * alias é um literal de código (ex: 'f', 'c') — nunca input do usuário.
 */
function mvCityScopeClauseAliased(
  cityScopeIds: string[] | null,
  filterCityIds: string[] | undefined,
  alias: 'f' | 'c' | 'mv',
): {
  scopeFrag: ReturnType<typeof sql>;
  filterFrag: ReturnType<typeof sql>;
} {
  // alias é controlado pelo código — uso de sql.raw justificado (não é input de usuário).
  const col = sql.raw(`${alias}.city_id`) as ReturnType<typeof sql>;

  let scopeFrag: ReturnType<typeof sql>;
  if (cityScopeIds === null) {
    scopeFrag = sql``;
  } else if (cityScopeIds.length === 0) {
    scopeFrag = sql`AND 1 = 0`;
  } else {
    scopeFrag = sql`AND ${col} IN (${sql.join(
      cityScopeIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  let filterFrag: ReturnType<typeof sql>;
  if (filterCityIds === undefined || filterCityIds.length === 0) {
    filterFrag = sql``;
  } else {
    filterFrag = sql`AND ${col} IN (${sql.join(
      filterCityIds.map((id) => sql`${id}`),
      sql`, `,
    )})`;
  }

  return { scopeFrag, filterFrag };
}

export async function getOverviewLeads(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  selfUserId: string | null,
  filterCityIds?: string[],
  filterAgentIds?: string[],
): Promise<OverviewLeadsResult> {
  const conds = [eq(leads.organizationId, organizationId), isNull(leads.deletedAt)];
  const cityCond = cityScope(scopeCtx, leads.cityId);
  if (cityCond !== undefined) conds.push(cityCond);
  if (filterCityIds !== undefined && filterCityIds.length > 0) {
    conds.push(inArray(leads.cityId, filterCityIds));
  }
  if (selfUserId !== null) {
    conds.push(eq(leads.agentId, selfUserId));
  } else if (filterAgentIds !== undefined && filterAgentIds.length > 0) {
    conds.push(inArray(leads.agentId, filterAgentIds));
  }
  const [totalsRow] = await db
    .select({
      total: count(leads.id),
      closedWon: sql<number>`COUNT(${leads.id}) FILTER (WHERE ${leads.status} = 'closed_won')`,
      closedLost: sql<number>`COUNT(${leads.id}) FILTER (WHERE ${leads.status} = 'closed_lost')`,
    })
    .from(leads)
    .where(and(...conds));
  const [newRow] = await db
    .select({ newInPeriod: count(leads.id) })
    .from(leads)
    .where(and(...conds, gte(leads.createdAt, dateRange.from), lte(leads.createdAt, dateRange.to)));
  const total = Number(totalsRow?.total ?? 0);
  const closedWon = Number(totalsRow?.closedWon ?? 0);
  const closedLost = Number(totalsRow?.closedLost ?? 0);
  const qualified = closedWon + closedLost;
  return {
    total,
    newInPeriod: Number(newRow?.newInPeriod ?? 0),
    closedWon,
    closedLost,
    conversionRate: qualified > 0 ? Math.round((closedWon / qualified) * 10000) / 100 : 0,
  };
}

export async function getOverviewSimulations(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  filterCityIds?: string[],
): Promise<OverviewSimulationsResult> {
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0)
    return { total: 0, amountSum: 0, amountAvg: 0 };

  const { scopeFrag, filterFrag } = mvCityScopeClause(scopeCtx.cityScopeIds, filterCityIds);

  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(total_simulations), 0) AS total_sims,
      COALESCE(SUM(simulations_amount_sum), 0) AS amount_sum
    FROM mv_reports_overview
    WHERE organization_id = ${organizationId}
      ${scopeFrag}
      ${filterFrag}
      AND day >= ${dateRange.from.toISOString().split('T')[0] ?? ''}::date
      AND day <= ${dateRange.to.toISOString().split('T')[0] ?? ''}::date
  `);

  // `as` justificado: db.execute retorna unknown[] — tipamos o shape esperado da MV
  const row = result.rows[0] as
    | { total_sims: string | number; amount_sum: string | number }
    | undefined;
  return {
    total: Number(row?.total_sims ?? 0),
    amountSum: Number(row?.amount_sum ?? 0),
    amountAvg:
      Number(row?.total_sims ?? 0) > 0
        ? Math.round((Number(row?.amount_sum ?? 0) / Number(row?.total_sims ?? 0)) * 100) / 100
        : 0,
  };
}

export async function getOverviewContracts(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  filterCityIds?: string[],
): Promise<OverviewContractsResult> {
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0)
    return { active: 0, settled: 0, defaulted: 0, activePrincipalSum: 0 };

  const { scopeFrag, filterFrag } = mvCityScopeClause(scopeCtx.cityScopeIds, filterCityIds);

  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(contracts_active), 0) AS active,
      COALESCE(SUM(contracts_settled), 0) AS settled,
      COALESCE(SUM(contracts_defaulted), 0) AS defaulted,
      COALESCE(SUM(contracts_amount_sum), 0) AS principal_sum
    FROM mv_reports_overview
    WHERE organization_id = ${organizationId}
      ${scopeFrag}
      ${filterFrag}
      AND day >= ${dateRange.from.toISOString().split('T')[0] ?? ''}::date
      AND day <= ${dateRange.to.toISOString().split('T')[0] ?? ''}::date
  `);

  // `as` justificado: db.execute retorna unknown[] — tipamos o shape esperado da MV
  const row = result.rows[0] as
    | {
        active: string | number;
        settled: string | number;
        defaulted: string | number;
        principal_sum: string | number;
      }
    | undefined;
  return {
    active: Number(row?.active ?? 0),
    settled: Number(row?.settled ?? 0),
    defaulted: Number(row?.defaulted ?? 0),
    activePrincipalSum: Number(row?.principal_sum ?? 0),
  };
}

export async function getOverviewConversations(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  filterCityIds?: string[],
): Promise<OverviewConversationsResult> {
  const conds = [eq(conversations.organizationId, organizationId), isNull(conversations.deletedAt)];
  const cityCond = cityScope(scopeCtx, conversations.cityId);
  if (cityCond !== undefined) conds.push(cityCond);
  if (filterCityIds !== undefined && filterCityIds.length > 0) {
    conds.push(inArray(conversations.cityId, filterCityIds));
  }
  const [row] = await db
    .select({
      open: sql<number>`COUNT(${conversations.id}) FILTER (WHERE ${conversations.status} = 'open')`,
      resolved: sql<number>`COUNT(${conversations.id}) FILTER (WHERE ${conversations.status} = 'resolved')`,
    })
    .from(conversations)
    .where(and(...conds));
  return { open: Number(row?.open ?? 0), resolved: Number(row?.resolved ?? 0) };
}

export async function getFunnelStages(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  filterCityIds?: string[],
): Promise<FunnelStageRow[]> {
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return [];

  const { scopeFrag, filterFrag } = mvCityScopeClauseAliased(
    scopeCtx.cityScopeIds,
    filterCityIds,
    'f',
  );

  const result = await db.execute(sql`
    SELECT
      f.stage_id,
      f.stage_name,
      f.stage_order,
      SUM(f.card_count) AS card_count,
      SUM(f.stale_card_count) AS stale_card_count,
      AVG(d.avg_dwell_hours) AS avg_dwell_hours,
      AVG(d.median_dwell_hours) AS median_dwell_hours
    FROM mv_reports_funnel f
    LEFT JOIN mv_reports_stage_dwell d
      ON d.stage_id = f.stage_id
     AND d.organization_id = f.organization_id
     AND (d.city_id = f.city_id OR (d.city_id IS NULL AND f.city_id IS NULL))
    WHERE f.organization_id = ${organizationId}
      ${scopeFrag}
      ${filterFrag}
    GROUP BY f.stage_id, f.stage_name, f.stage_order
    ORDER BY f.stage_order ASC
  `);

  // `as` justificado: db.execute retorna unknown[] — tipamos o shape das MVs mv_reports_funnel + mv_reports_stage_dwell
  return (
    result.rows as Array<{
      stage_id: string;
      stage_name: string;
      stage_order: string | number;
      card_count: string | number;
      stale_card_count: string | number;
      avg_dwell_hours: string | number | null;
      median_dwell_hours: string | number | null;
    }>
  ).map((r) => ({
    stageId: String(r.stage_id),
    stageName: String(r.stage_name),
    stageOrder: Number(r.stage_order),
    cardCount: Number(r.card_count ?? 0),
    staleCardCount: Number(r.stale_card_count ?? 0),
    avgDwellHours: r.avg_dwell_hours !== null ? Number(r.avg_dwell_hours) : null,
    medianDwellHours: r.median_dwell_hours !== null ? Number(r.median_dwell_hours) : null,
  }));
}

export async function getAttendanceTotals(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  selfUserId: string | null,
  filterCityIds?: string[],
): Promise<AttendanceTotalsResult> {
  const conds = [
    eq(conversations.organizationId, organizationId),
    isNull(conversations.deletedAt),
    gte(conversations.createdAt, dateRange.from),
    lte(conversations.createdAt, dateRange.to),
  ];
  const cityCond = cityScope(scopeCtx, conversations.cityId);
  if (cityCond !== undefined) conds.push(cityCond);
  if (filterCityIds !== undefined && filterCityIds.length > 0) {
    conds.push(inArray(conversations.cityId, filterCityIds));
  }
  if (selfUserId !== null) {
    conds.push(eq(conversations.assignedUserId, selfUserId));
  }
  const [totalsRow] = await db
    .select({
      opened: count(conversations.id),
      resolved: sql<number>`COUNT(${conversations.id}) FILTER (WHERE ${conversations.status} = 'resolved')`,
    })
    .from(conversations)
    .where(and(...conds));
  const [msgRow] = await db
    .select({ total: count(messages.id) })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(and(...conds));
  return {
    conversationsOpened: Number(totalsRow?.opened ?? 0),
    conversationsResolved: Number(totalsRow?.resolved ?? 0),
    messagesTotal: Number(msgRow?.total ?? 0),
  };
}

export async function getAttendanceByChannel(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  selfUserId: string | null,
  filterCityIds?: string[],
  filterChannel?: string,
): Promise<AttendanceByChannelRow[]> {
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return [];

  const { scopeFrag, filterFrag } = mvCityScopeClauseAliased(
    scopeCtx.cityScopeIds,
    filterCityIds,
    'c',
  );

  // selfUserId e filterChannel são valores parametrizados — nunca interpolados
  const selfFrag = selfUserId !== null ? sql`AND c.assigned_user_id = ${selfUserId}` : sql``;

  // filterChannel: o valor vem de query param validado por Zod enum no controller
  // (valores permitidos: meta_whatsapp, meta_instagram, waha).
  // Passa como placeholder parametrizado — o DB valida via CHECK constraint.
  const channelFrag = filterChannel !== undefined ? sql`AND ch.provider = ${filterChannel}` : sql``;

  const result = await db.execute(sql`
    SELECT
      ch.provider AS channel,
      COUNT(DISTINCT c.id) AS conv_count,
      COUNT(m.id) AS msg_count
    FROM conversations c
    JOIN channels ch ON ch.id = c.channel_id
    LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE c.organization_id = ${organizationId}
      AND c.deleted_at IS NULL
      AND c.created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND c.created_at <= ${dateRange.to.toISOString()}::timestamptz
      ${scopeFrag}
      ${filterFrag}
      ${selfFrag}
      ${channelFrag}
    GROUP BY ch.provider
    ORDER BY COUNT(DISTINCT c.id) DESC
  `);

  // `as` justificado: db.execute retorna unknown[] — tipamos o shape esperado das tabelas conversations + channels
  return (
    result.rows as Array<{
      channel: string;
      conv_count: string | number;
      msg_count: string | number;
    }>
  ).map((r) => ({
    channel: String(r.channel),
    conversationCount: Number(r.conv_count ?? 0),
    messageCount: Number(r.msg_count ?? 0),
  }));
}

export async function getAttendanceTimings(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  selfUserId: string | null,
  filterCityIds?: string[],
): Promise<AttendanceTimingsResult> {
  const empty: AttendanceTimingsResult = {
    firstResponseAvgSec: null,
    firstResponseP90Sec: null,
    resolutionAvgSec: null,
    resolutionP90Sec: null,
  };
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return empty;

  const { scopeFrag, filterFrag } = mvCityScopeClauseAliased(
    scopeCtx.cityScopeIds,
    filterCityIds,
    'c',
  );

  const selfFrag = selfUserId !== null ? sql`AND c.assigned_user_id = ${selfUserId}` : sql``;

  const result = await db.execute(sql`
    WITH fr AS (
      SELECT
        c.id,
        EXTRACT(EPOCH FROM (
          MIN(m.created_at) FILTER (WHERE m.direction = 'out') - c.created_at
        )) AS first_sec,
        EXTRACT(EPOCH FROM (c.updated_at - c.created_at)) AS res_sec
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      WHERE c.organization_id = ${organizationId}
        AND c.deleted_at IS NULL
        AND c.created_at >= ${dateRange.from.toISOString()}::timestamptz
        AND c.created_at <= ${dateRange.to.toISOString()}::timestamptz
        AND c.status = 'resolved'
        ${scopeFrag}
        ${filterFrag}
        ${selfFrag}
      GROUP BY c.id, c.created_at, c.updated_at
    )
    SELECT
      AVG(first_sec) AS first_response_avg_sec,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY first_sec) AS first_response_p90_sec,
      AVG(res_sec) AS resolution_avg_sec,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY res_sec) AS resolution_p90_sec
    FROM fr
    WHERE first_sec IS NOT NULL AND first_sec >= 0
  `);

  if (result.rows.length === 0) return empty;

  // `as` justificado: db.execute retorna unknown[] — tipamos o shape esperado do CTE fr
  const row = result.rows[0] as
    | {
        first_response_avg_sec: string | number | null;
        first_response_p90_sec: string | number | null;
        resolution_avg_sec: string | number | null;
        resolution_p90_sec: string | number | null;
      }
    | undefined;

  if (row === undefined) return empty;
  return {
    firstResponseAvgSec:
      row.first_response_avg_sec !== null ? Number(row.first_response_avg_sec) : null,
    firstResponseP90Sec:
      row.first_response_p90_sec !== null ? Number(row.first_response_p90_sec) : null,
    resolutionAvgSec: row.resolution_avg_sec !== null ? Number(row.resolution_avg_sec) : null,
    resolutionP90Sec: row.resolution_p90_sec !== null ? Number(row.resolution_p90_sec) : null,
  };
}

// ============================================================
// F23-S04 - Credit (4-E), Collection (4-F), Productivity (4-G)
// SQL tagged templates, parametrized. No sql.raw() with user input.
// Verified vs 0071_reports_materialized_views.sql and Drizzle schemas.
// ============================================================

export interface CreditAggregateResult {
  simulations: number;
  simulationsAmountSum: number;
  simulationsAmountAvg: number;
  simulationsTermAvg: number;
  analyses: number;
  analysesApproved: number;
  analysesRefused: number;
  analysesInProgress: number;
  analysesApprovedAmountAvg: number;
  contracts: number;
  contractsActive: number;
  contractsSettled: number;
  contractsDefaulted: number;
  contractsPrincipalSum: number;
}

export interface CreditByProductRow {
  productId: string | null;
  simulations: number;
  analyses: number;
  analysesApproved: number;
  contracts: number;
  principalSum: number;
}

export async function getCreditAggregate(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  filterCityIds?: string[],
  filterProductIds?: string[],
): Promise<CreditAggregateResult> {
  const empty: CreditAggregateResult = {
    simulations: 0,
    simulationsAmountSum: 0,
    simulationsAmountAvg: 0,
    simulationsTermAvg: 0,
    analyses: 0,
    analysesApproved: 0,
    analysesRefused: 0,
    analysesInProgress: 0,
    analysesApprovedAmountAvg: 0,
    contracts: 0,
    contractsActive: 0,
    contractsSettled: 0,
    contractsDefaulted: 0,
    contractsPrincipalSum: 0,
  };
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return empty;
  const { scopeFrag, filterFrag } = mvCityScopeClause(scopeCtx.cityScopeIds, filterCityIds);
  const productFrag =
    filterProductIds !== undefined && filterProductIds.length > 0
      ? sql`AND product_id IN (${sql.join(
          filterProductIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(simulations_count), 0)       AS simulations_count,
      COALESCE(SUM(simulations_amount_sum), 0)  AS simulations_amount_sum,
      CASE WHEN COALESCE(SUM(simulations_count),0)>0
        THEN SUM(simulations_amount_sum)/SUM(simulations_count) ELSE 0
      END                                       AS simulations_amount_avg,
      CASE WHEN COALESCE(SUM(simulations_count),0)>0
        THEN SUM(simulations_term_avg*simulations_count)/SUM(simulations_count) ELSE 0
      END                                       AS simulations_term_avg,
      COALESCE(SUM(analyses_count), 0)          AS analyses_count,
      COALESCE(SUM(analyses_approved), 0)       AS analyses_approved,
      COALESCE(SUM(analyses_refused), 0)        AS analyses_refused,
      COALESCE(SUM(analyses_in_progress), 0)    AS analyses_in_progress,
      CASE WHEN COALESCE(SUM(analyses_approved),0)>0
        THEN SUM(analyses_approved_amount_avg*analyses_approved)/SUM(analyses_approved) ELSE 0
      END                                       AS analyses_approved_amount_avg,
      COALESCE(SUM(contracts_count), 0)         AS contracts_count,
      COALESCE(SUM(contracts_active), 0)        AS contracts_active,
      COALESCE(SUM(contracts_settled), 0)       AS contracts_settled,
      COALESCE(SUM(contracts_defaulted), 0)     AS contracts_defaulted,
      COALESCE(SUM(contracts_principal_sum), 0) AS contracts_principal_sum
    FROM mv_reports_credit
    WHERE organization_id = ${organizationId}
      ${scopeFrag}
      ${filterFrag}
      ${productFrag}
  `);
  // as justified: db.execute returns unknown[] typed to mv shape
  const row = result.rows[0] as
    | {
        simulations_count: string | number;
        simulations_amount_sum: string | number;
        simulations_amount_avg: string | number;
        simulations_term_avg: string | number;
        analyses_count: string | number;
        analyses_approved: string | number;
        analyses_refused: string | number;
        analyses_in_progress: string | number;
        analyses_approved_amount_avg: string | number;
        contracts_count: string | number;
        contracts_active: string | number;
        contracts_settled: string | number;
        contracts_defaulted: string | number;
        contracts_principal_sum: string | number;
      }
    | undefined;
  if (!row) return empty;
  return {
    simulations: Number(row.simulations_count ?? 0),
    simulationsAmountSum: Number(row.simulations_amount_sum ?? 0),
    simulationsAmountAvg: Number(row.simulations_amount_avg ?? 0),
    simulationsTermAvg: Number(row.simulations_term_avg ?? 0),
    analyses: Number(row.analyses_count ?? 0),
    analysesApproved: Number(row.analyses_approved ?? 0),
    analysesRefused: Number(row.analyses_refused ?? 0),
    analysesInProgress: Number(row.analyses_in_progress ?? 0),
    analysesApprovedAmountAvg: Number(row.analyses_approved_amount_avg ?? 0),
    contracts: Number(row.contracts_count ?? 0),
    contractsActive: Number(row.contracts_active ?? 0),
    contractsSettled: Number(row.contracts_settled ?? 0),
    contractsDefaulted: Number(row.contracts_defaulted ?? 0),
    contractsPrincipalSum: Number(row.contracts_principal_sum ?? 0),
  };
}

export async function getCreditByProduct(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  filterCityIds?: string[],
  filterProductIds?: string[],
): Promise<CreditByProductRow[]> {
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return [];
  const { scopeFrag, filterFrag } = mvCityScopeClause(scopeCtx.cityScopeIds, filterCityIds);
  const productFrag =
    filterProductIds !== undefined && filterProductIds.length > 0
      ? sql`AND product_id IN (${sql.join(
          filterProductIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const result = await db.execute(sql`
    SELECT
      product_id,
      COALESCE(SUM(simulations_count), 0)      AS simulations,
      COALESCE(SUM(analyses_count), 0)          AS analyses,
      COALESCE(SUM(analyses_approved), 0)       AS analyses_approved,
      COALESCE(SUM(contracts_count), 0)         AS contracts,
      COALESCE(SUM(contracts_principal_sum), 0) AS principal_sum
    FROM mv_reports_credit
    WHERE organization_id = ${organizationId}
      ${scopeFrag}
      ${filterFrag}
      ${productFrag}
    GROUP BY product_id
    ORDER BY SUM(simulations_count) DESC
  `);
  // as justified: db.execute returns unknown[] typed to mv shape
  return (
    result.rows as Array<{
      product_id: string | null;
      simulations: string | number;
      analyses: string | number;
      analyses_approved: string | number;
      contracts: string | number;
      principal_sum: string | number;
    }>
  ).map((r) => ({
    productId: r.product_id ?? null,
    simulations: Number(r.simulations ?? 0),
    analyses: Number(r.analyses ?? 0),
    analysesApproved: Number(r.analyses_approved ?? 0),
    contracts: Number(r.contracts ?? 0),
    principalSum: Number(r.principal_sum ?? 0),
  }));
}

export interface CollectionWalletResult {
  pending: number;
  pendingAmountSum: number;
  overdue: number;
  overdueAmountSum: number;
  paid: number;
  paidAmountSum: number;
  renegotiated: number;
  cancelled: number;
  avgDaysOverdue: number;
}

export interface CollectionJobsResult {
  scheduled: number;
  sent: number;
  failed: number;
  paidBeforeSend: number;
}

export async function getCollectionWallet(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  filterCityIds?: string[],
): Promise<CollectionWalletResult> {
  const empty: CollectionWalletResult = {
    pending: 0,
    pendingAmountSum: 0,
    overdue: 0,
    overdueAmountSum: 0,
    paid: 0,
    paidAmountSum: 0,
    renegotiated: 0,
    cancelled: 0,
    avgDaysOverdue: 0,
  };
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return empty;
  const { scopeFrag, filterFrag } = mvCityScopeClause(scopeCtx.cityScopeIds, filterCityIds);
  const result = await db.execute(sql`
    SELECT
      status,
      COALESCE(SUM(dues_count), 0)       AS dues_count,
      COALESCE(SUM(dues_amount_sum), 0)  AS dues_amount_sum,
      COALESCE(AVG(avg_days_overdue), 0) AS avg_days_overdue
    FROM mv_reports_collection
    WHERE organization_id = ${organizationId}
      ${scopeFrag}
      ${filterFrag}
    GROUP BY status
  `);
  // as justified: db.execute returns unknown[] typed to mv_reports_collection shape
  const rows = result.rows as Array<{
    status: string;
    dues_count: string | number;
    dues_amount_sum: string | number;
    avg_days_overdue: string | number;
  }>;
  const out = { ...empty };
  for (const r of rows) {
    const cnt = Number(r.dues_count ?? 0);
    const amt = Number(r.dues_amount_sum ?? 0);
    if (r.status === 'pending') {
      out.pending = cnt;
      out.pendingAmountSum = amt;
    } else if (r.status === 'overdue') {
      out.overdue = cnt;
      out.overdueAmountSum = amt;
      out.avgDaysOverdue = Number(r.avg_days_overdue ?? 0);
    } else if (r.status === 'paid') {
      out.paid = cnt;
      out.paidAmountSum = amt;
    } else if (r.status === 'renegotiated') {
      out.renegotiated = cnt;
    } else if (r.status === 'cancelled') {
      out.cancelled = cnt;
    }
  }
  return out;
}

export async function getCollectionJobsStats(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<CollectionJobsResult> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'scheduled')        AS scheduled,
      COUNT(*) FILTER (WHERE status = 'sent')             AS sent,
      COUNT(*) FILTER (WHERE status = 'failed')           AS failed,
      COUNT(*) FILTER (WHERE status = 'paid_before_send') AS paid_before_send
    FROM collection_jobs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
  `);
  // as justified: db.execute returns unknown[] typed to collection_jobs shape
  const row = result.rows[0] as
    | {
        scheduled: string | number;
        sent: string | number;
        failed: string | number;
        paid_before_send: string | number;
      }
    | undefined;
  return {
    scheduled: Number(row?.scheduled ?? 0),
    sent: Number(row?.sent ?? 0),
    failed: Number(row?.failed ?? 0),
    paidBeforeSend: Number(row?.paid_before_send ?? 0),
  };
}

export interface ProductivityAgentRow {
  agentId: string;
  displayName: string | null;
  leadsClosedWon: number;
  simulationsCreated: number;
  conversationsResolved: number;
  contractsOriginated: number;
  avgFirstResponseSec: number | null;
}

export interface ProductivityTeamAverageResult {
  leadsClosedWon: number;
  simulationsCreated: number;
  conversationsResolved: number;
  contractsOriginated: number;
}

export async function getProductivityByAgent(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  selfUserId: string | null,
  includeDisplayName: boolean,
  filterCityIds?: string[],
): Promise<ProductivityAgentRow[]> {
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return [];
  const cityScopeIds = scopeCtx.cityScopeIds;
  const leadScopeFrag =
    cityScopeIds === null
      ? sql``
      : cityScopeIds.length === 0
        ? sql`AND 1 = 0`
        : sql`AND l.city_id IN (${sql.join(
            cityScopeIds.map((id) => sql`${id}`),
            sql`, `,
          )})`;
  const leadFilterFrag =
    filterCityIds !== undefined && filterCityIds.length > 0
      ? sql`AND l.city_id IN (${sql.join(
          filterCityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const convScopeFrag =
    cityScopeIds === null
      ? sql``
      : cityScopeIds.length === 0
        ? sql`AND 1 = 0`
        : sql`AND conv.city_id IN (${sql.join(
            cityScopeIds.map((id) => sql`${id}`),
            sql`, `,
          )})`;
  const convFilterFrag =
    filterCityIds !== undefined && filterCityIds.length > 0
      ? sql`AND conv.city_id IN (${sql.join(
          filterCityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  // selfUserId: parametrized - never interpolated as raw string
  const selfAgentFrag = selfUserId !== null ? sql`AND a.user_id = ${selfUserId}` : sql``;
  // displayName col: sql.raw justified - code-controlled literal, not user input
  const displayNameCol = includeDisplayName
    ? (sql.raw('a.display_name') as ReturnType<typeof sql>)
    : (sql.raw('NULL::text') as ReturnType<typeof sql>);
  const result = await db.execute(sql`
    WITH
    leads_won AS (
      SELECT l.agent_id, COUNT(l.id) AS leads_closed_won
      FROM leads l
      JOIN agents a ON a.id = l.agent_id AND a.organization_id = ${organizationId}
      WHERE l.organization_id = ${organizationId}
        AND l.status = 'closed_won'
        AND l.updated_at >= ${dateRange.from.toISOString()}::timestamptz
        AND l.updated_at <= ${dateRange.to.toISOString()}::timestamptz
        AND l.deleted_at IS NULL
        ${leadScopeFrag}
        ${leadFilterFrag}
        ${selfAgentFrag}
      GROUP BY l.agent_id
    ),
    sims_created AS (
      SELECT a.id AS agent_id, COUNT(cs.id) AS simulations_count
      FROM credit_simulations cs
      JOIN leads l ON l.id = cs.lead_id AND l.deleted_at IS NULL
      JOIN agents a ON a.user_id = cs.created_by_user_id AND a.organization_id = ${organizationId}
      WHERE cs.organization_id = ${organizationId}
        AND cs.created_at >= ${dateRange.from.toISOString()}::timestamptz
        AND cs.created_at <= ${dateRange.to.toISOString()}::timestamptz
        ${leadScopeFrag}
        ${leadFilterFrag}
        ${selfAgentFrag}
      GROUP BY a.id
    ),
    convs_resolved AS (
      SELECT a.id AS agent_id, COUNT(conv.id) AS conversations_resolved
      FROM conversations conv
      JOIN agents a ON a.user_id = conv.assigned_user_id AND a.organization_id = ${organizationId}
      WHERE conv.organization_id = ${organizationId}
        AND conv.status = 'resolved'
        AND conv.updated_at >= ${dateRange.from.toISOString()}::timestamptz
        AND conv.updated_at <= ${dateRange.to.toISOString()}::timestamptz
        AND conv.deleted_at IS NULL
        ${convScopeFrag}
        ${convFilterFrag}
        ${selfAgentFrag}
      GROUP BY a.id
    ),
    contracts_orig AS (
      SELECT l.agent_id, COUNT(ct.id) AS contracts_originated
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
      JOIN leads l ON l.id = cu.primary_lead_id AND l.deleted_at IS NULL
      JOIN agents a ON a.id = l.agent_id AND a.organization_id = ${organizationId}
      WHERE ct.organization_id = ${organizationId}
        AND ct.created_at >= ${dateRange.from.toISOString()}::timestamptz
        AND ct.created_at <= ${dateRange.to.toISOString()}::timestamptz
        ${leadScopeFrag}
        ${leadFilterFrag}
        ${selfAgentFrag}
      GROUP BY l.agent_id
    ),
    first_resp AS (
      SELECT agent_id, AVG(sec) AS avg_sec
      FROM (
        SELECT
          a.id AS agent_id,
          EXTRACT(EPOCH FROM (
            MIN(m.created_at) FILTER (WHERE m.direction = 'out') - conv.created_at
          )) AS sec
        FROM conversations conv
        JOIN agents a ON a.user_id = conv.assigned_user_id AND a.organization_id = ${organizationId}
        LEFT JOIN messages m ON m.conversation_id = conv.id
        WHERE conv.organization_id = ${organizationId}
          AND conv.status = 'resolved'
          AND conv.updated_at >= ${dateRange.from.toISOString()}::timestamptz
          AND conv.updated_at <= ${dateRange.to.toISOString()}::timestamptz
          AND conv.deleted_at IS NULL
          ${convScopeFrag}
          ${convFilterFrag}
          ${selfAgentFrag}
        GROUP BY a.id, conv.id, conv.created_at
      ) per_conv
      WHERE sec IS NOT NULL AND sec >= 0
      GROUP BY agent_id
    )
    SELECT
      a.id                                    AS agent_id,
      ${displayNameCol}                       AS display_name,
      COALESCE(lw.leads_closed_won, 0)        AS leads_closed_won,
      COALESCE(sc.simulations_count, 0)       AS simulations_created,
      COALESCE(cr.conversations_resolved, 0)  AS conversations_resolved,
      COALESCE(co.contracts_originated, 0)    AS contracts_originated,
      fr.avg_sec                              AS avg_first_response_sec
    FROM agents a
    LEFT JOIN leads_won lw      ON lw.agent_id = a.id
    LEFT JOIN sims_created sc   ON sc.agent_id = a.id
    LEFT JOIN convs_resolved cr ON cr.agent_id = a.id
    LEFT JOIN contracts_orig co ON co.agent_id = a.id
    LEFT JOIN first_resp fr     ON fr.agent_id = a.id
    WHERE a.organization_id = ${organizationId}
      AND a.is_active = true AND a.deleted_at IS NULL
      ${selfAgentFrag}
    ORDER BY COALESCE(lw.leads_closed_won, 0) DESC
  `);
  // as justified: db.execute returns unknown[] typed to agents+CTEs shape
  return (
    result.rows as Array<{
      agent_id: string;
      display_name: string | null;
      leads_closed_won: string | number;
      simulations_created: string | number;
      conversations_resolved: string | number;
      contracts_originated: string | number;
      avg_first_response_sec: string | number | null;
    }>
  ).map((r) => ({
    agentId: String(r.agent_id),
    displayName: r.display_name ?? null,
    leadsClosedWon: Number(r.leads_closed_won ?? 0),
    simulationsCreated: Number(r.simulations_created ?? 0),
    conversationsResolved: Number(r.conversations_resolved ?? 0),
    contractsOriginated: Number(r.contracts_originated ?? 0),
    avgFirstResponseSec:
      r.avg_first_response_sec !== null ? Number(r.avg_first_response_sec) : null,
  }));
}

export async function getProductivityTeamAverage(
  db: Database,
  organizationId: string,
  scopeCtx: UserScopeCtx,
  dateRange: DateRange,
  excludeUserId: string,
  filterCityIds?: string[],
): Promise<ProductivityTeamAverageResult> {
  const empty: ProductivityTeamAverageResult = {
    leadsClosedWon: 0,
    simulationsCreated: 0,
    conversationsResolved: 0,
    contractsOriginated: 0,
  };
  if (scopeCtx.cityScopeIds !== null && scopeCtx.cityScopeIds.length === 0) return empty;
  const cityScopeIds = scopeCtx.cityScopeIds;
  const leadScopeFrag =
    cityScopeIds === null
      ? sql``
      : cityScopeIds.length === 0
        ? sql`AND 1 = 0`
        : sql`AND l.city_id IN (${sql.join(
            cityScopeIds.map((id) => sql`${id}`),
            sql`, `,
          )})`;
  const leadFilterFrag =
    filterCityIds !== undefined && filterCityIds.length > 0
      ? sql`AND l.city_id IN (${sql.join(
          filterCityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  const convScopeFrag =
    cityScopeIds === null
      ? sql``
      : cityScopeIds.length === 0
        ? sql`AND 1 = 0`
        : sql`AND conv.city_id IN (${sql.join(
            cityScopeIds.map((id) => sql`${id}`),
            sql`, `,
          )})`;
  const convFilterFrag =
    filterCityIds !== undefined && filterCityIds.length > 0
      ? sql`AND conv.city_id IN (${sql.join(
          filterCityIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql``;
  // excludeUserId: parametrized - excludes requester from peer average (D3)
  const excludeFrag = sql`AND a.user_id != ${excludeUserId}`;
  const result = await db.execute(sql`
    WITH
    team_leads AS (
      SELECT l.agent_id, COUNT(l.id) AS n
      FROM leads l
      JOIN agents a ON a.id = l.agent_id AND a.organization_id = ${organizationId}
      WHERE l.organization_id = ${organizationId}
        AND l.status = 'closed_won'
        AND l.updated_at >= ${dateRange.from.toISOString()}::timestamptz
        AND l.updated_at <= ${dateRange.to.toISOString()}::timestamptz
        AND l.deleted_at IS NULL
        ${leadScopeFrag}
        ${leadFilterFrag}
        ${excludeFrag}
      GROUP BY l.agent_id
    ),
    team_sims AS (
      SELECT a.id AS agent_id, COUNT(cs.id) AS n
      FROM credit_simulations cs
      JOIN leads l ON l.id = cs.lead_id AND l.deleted_at IS NULL
      JOIN agents a ON a.user_id = cs.created_by_user_id AND a.organization_id = ${organizationId}
      WHERE cs.organization_id = ${organizationId}
        AND cs.created_at >= ${dateRange.from.toISOString()}::timestamptz
        AND cs.created_at <= ${dateRange.to.toISOString()}::timestamptz
        ${leadScopeFrag}
        ${leadFilterFrag}
        ${excludeFrag}
      GROUP BY a.id
    ),
    team_convs AS (
      SELECT a.id AS agent_id, COUNT(conv.id) AS n
      FROM conversations conv
      JOIN agents a ON a.user_id = conv.assigned_user_id AND a.organization_id = ${organizationId}
      WHERE conv.organization_id = ${organizationId}
        AND conv.status = 'resolved'
        AND conv.updated_at >= ${dateRange.from.toISOString()}::timestamptz
        AND conv.updated_at <= ${dateRange.to.toISOString()}::timestamptz
        AND conv.deleted_at IS NULL
        ${convScopeFrag}
        ${convFilterFrag}
        ${excludeFrag}
      GROUP BY a.id
    ),
    team_contracts AS (
      SELECT l.agent_id, COUNT(ct.id) AS n
      FROM contracts ct
      JOIN customers cu ON cu.id = ct.customer_id
      JOIN leads l ON l.id = cu.primary_lead_id AND l.deleted_at IS NULL
      JOIN agents a ON a.id = l.agent_id AND a.organization_id = ${organizationId}
      WHERE ct.organization_id = ${organizationId}
        AND ct.created_at >= ${dateRange.from.toISOString()}::timestamptz
        AND ct.created_at <= ${dateRange.to.toISOString()}::timestamptz
        ${leadScopeFrag}
        ${leadFilterFrag}
        ${excludeFrag}
      GROUP BY l.agent_id
    )
    SELECT
      COALESCE(AVG(tl.n), 0) AS avg_leads,
      COALESCE(AVG(ts.n), 0) AS avg_sims,
      COALESCE(AVG(tc.n), 0) AS avg_convs,
      COALESCE(AVG(tk.n), 0) AS avg_contracts
    FROM (
      SELECT a.id AS agent_id
      FROM agents a
      WHERE a.organization_id = ${organizationId}
        AND a.is_active = true AND a.deleted_at IS NULL
        AND a.user_id != ${excludeUserId}
    ) all_agents
    LEFT JOIN team_leads tl     ON tl.agent_id = all_agents.agent_id
    LEFT JOIN team_sims ts      ON ts.agent_id = all_agents.agent_id
    LEFT JOIN team_convs tc     ON tc.agent_id = all_agents.agent_id
    LEFT JOIN team_contracts tk ON tk.agent_id = all_agents.agent_id
  `);
  // as justified: db.execute returns unknown[] typed to CTE averages shape
  const row = result.rows[0] as
    | {
        avg_leads: string | number;
        avg_sims: string | number;
        avg_convs: string | number;
        avg_contracts: string | number;
      }
    | undefined;
  return {
    leadsClosedWon: Math.round(Number(row?.avg_leads ?? 0) * 100) / 100,
    simulationsCreated: Math.round(Number(row?.avg_sims ?? 0) * 100) / 100,
    conversationsResolved: Math.round(Number(row?.avg_convs ?? 0) * 100) / 100,
    contractsOriginated: Math.round(Number(row?.avg_contracts ?? 0) * 100) / 100,
  };
}

// =============================================================================
// F23-S05 --- AI/Pre-attendance + Audit & Operations
// SQL: sql parametrizado. Sem sql.raw() com input de usuario.
// Estas tabelas nao tem city_id --- scope e por organization_id apenas.
// =============================================================================

const LLM_PRICING_USD_PER_1M: Readonly<Record<string, { input: number; output: number }>> = {
  'anthropic/claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'anthropic/claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },
  'anthropic/claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
  'anthropic/claude-3-opus': { input: 15.0, output: 75.0 },
  'anthropic/claude-3-opus-20240229': { input: 15.0, output: 75.0 },
  'openai/gpt-4o': { input: 2.5, output: 10.0 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
  'openai/gpt-4-turbo': { input: 10.0, output: 30.0 },
  'openai/gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'google/gemini-flash-1.5': { input: 0.075, output: 0.3 },
  'google/gemini-pro-1.5': { input: 1.25, output: 5.0 },
};

function computeLlmCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
): { costUsd: number; available: boolean } {
  const pricing = LLM_PRICING_USD_PER_1M[model];
  if (pricing === undefined) return { costUsd: 0, available: false };
  const cost = (tokensIn / 1_000_000) * pricing.input + (tokensOut / 1_000_000) * pricing.output;
  return { costUsd: cost, available: true };
}

export interface AiConversationHealthResult {
  total: number;
  active: number;
  handoffed: number;
  handoffRate: number;
  completedWithoutHandoff: number;
}

export interface AiHandoffReasonRow {
  reason: string;
  count: number;
  rate: number;
}

export interface AiNodeDistributionRow {
  nodeName: string;
  callCount: number;
  errorCount: number;
  errorRate: number;
  avgLatencyMs: number | null;
}

export interface AiLlmMetricsResult {
  totalTokensIn: number;
  totalTokensOut: number;
  totalCalls: number;
  estimatedCostUsd: number | null;
  costAvailable: boolean;
  avgLatencyMs: number | null;
  p90LatencyMs: number | null;
  errorRate: number;
}

export interface AiModelBreakdownRow {
  model: string;
  callCount: number;
  tokensIn: number;
  tokensOut: number;
  estimatedCostUsd: number | null;
  costAvailable: boolean;
}

export interface AiHandoffSlaResult {
  avgTimeToAcceptSec: number | null;
  p90TimeToAcceptSec: number | null;
  pendingHandoffs: number;
}

export interface AuditVolumeResult {
  total: number;
  byResourceType: Array<{ resourceType: string; count: number }>;
}

export interface AuditActionRow {
  action: string;
  count: number;
}

export interface AuditCriticalActionRow {
  action: string;
  count: number;
  actorCount: number;
}

export interface EventOutboxHealthResult {
  totalCreated: number;
  totalProcessed: number;
  totalPending: number;
  totalFailed: number;
  successRate: number;
  avgProcessingLatencySec: number | null;
}

export interface EventDlqSnapshotResult {
  pendingReprocess: number;
  totalMoved: number;
  topEventNames: Array<{ eventName: string; count: number }>;
}
const CRITICAL_ACTION_PREFIXES = [
  'user.',
  'feature_flag.',
  'rbac.',
  'organization.',
  'auth.',
] as const;

export async function getAiConversationHealth(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AiConversationHealthResult> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (
        WHERE created_at >= ${dateRange.from.toISOString()}::timestamptz
          AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      ) AS total,
      COUNT(*) FILTER (
        WHERE deleted_at IS NULL
          AND created_at >= ${dateRange.from.toISOString()}::timestamptz
          AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      ) AS active,
      COUNT(*) FILTER (
        WHERE deleted_at IS NOT NULL
          AND created_at >= ${dateRange.from.toISOString()}::timestamptz
          AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      ) AS soft_deleted
    FROM ai_conversation_states
    WHERE organization_id = ${organizationId}
  `);

  const handoffResult = await db.execute(sql`
    SELECT COUNT(DISTINCT conversation_id) AS handoffed
    FROM chatwoot_handoffs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      AND deleted_at IS NULL
  `);

  // `as` justificado: db.execute retorna unknown[] --- tipamos shape das queries acima
  const row = result.rows[0] as
    | { total: string | number; active: string | number; soft_deleted: string | number }
    | undefined;
  const handoffRow = handoffResult.rows[0] as { handoffed: string | number } | undefined;
  const total = Number(row?.total ?? 0);
  const active = Number(row?.active ?? 0);
  const handoffed = Number(handoffRow?.handoffed ?? 0);
  const completedWithoutHandoff = Math.max(0, total - active - handoffed);
  const handoffRate = total > 0 ? Math.round((handoffed / total) * 10000) / 100 : 0;
  return { total, active, handoffed, handoffRate, completedWithoutHandoff };
}

export async function getAiHandoffReasons(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AiHandoffReasonRow[]> {
  const result = await db.execute(sql`
    SELECT reason, COUNT(*) AS reason_count
    FROM chatwoot_handoffs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      AND deleted_at IS NULL
    GROUP BY reason
    ORDER BY reason_count DESC
  `);
  // `as` justificado: db.execute retorna unknown[]
  const rows = result.rows as Array<{ reason: string; reason_count: string | number }>;
  const total = rows.reduce((sum, r) => sum + Number(r.reason_count), 0);
  return rows.map((r) => ({
    reason: String(r.reason),
    count: Number(r.reason_count),
    rate: total > 0 ? Math.round((Number(r.reason_count) / total) * 10000) / 100 : 0,
  }));
}

export async function getAiNodeDistribution(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AiNodeDistributionRow[]> {
  const result = await db.execute(sql`
    SELECT
      node_name,
      COUNT(*) AS call_count,
      COUNT(*) FILTER (WHERE error IS NOT NULL) AS error_count,
      AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL) AS avg_latency_ms
    FROM ai_decision_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
    GROUP BY node_name
    ORDER BY call_count DESC
  `);
  // `as` justificado: db.execute retorna unknown[]
  const rows = result.rows as Array<{
    node_name: string;
    call_count: string | number;
    error_count: string | number;
    avg_latency_ms: string | number | null;
  }>;
  return rows.map((r) => {
    const callCount = Number(r.call_count);
    const errorCount = Number(r.error_count);
    return {
      nodeName: String(r.node_name),
      callCount,
      errorCount,
      errorRate: callCount > 0 ? Math.round((errorCount / callCount) * 10000) / 100 : 0,
      avgLatencyMs:
        r.avg_latency_ms !== null && r.avg_latency_ms !== undefined
          ? Math.round(Number(r.avg_latency_ms))
          : null,
    };
  });
}

export async function getAiLlmMetrics(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AiLlmMetricsResult> {
  // Query 1: per-model aggregation; cost computed in TS via LLM_PRICING_USD_PER_1M
  const byModelResult = await db.execute(sql`
    SELECT model,
      COUNT(*) AS call_count,
      COALESCE(SUM(tokens_in), 0) AS tokens_in_sum,
      COALESCE(SUM(tokens_out), 0) AS tokens_out_sum,
      COUNT(*) FILTER (WHERE error IS NOT NULL) AS error_count
    FROM ai_decision_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      AND model IS NOT NULL
      AND tokens_in IS NOT NULL
      AND tokens_out IS NOT NULL
    GROUP BY model
  `);

  // Query 2: overall latency stats (sem aggregate aninhado)
  const latencyResult = await db.execute(sql`
    SELECT
      COUNT(*) AS total_calls,
      COUNT(*) FILTER (WHERE error IS NOT NULL) AS total_errors,
      AVG(latency_ms) AS avg_latency_ms,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY latency_ms)
        FILTER (WHERE latency_ms IS NOT NULL) AS p90_latency_ms
    FROM ai_decision_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
  `);

  // `as` justificado: db.execute retorna unknown[]
  const modelRows = byModelResult.rows as Array<{
    model: string;
    call_count: string | number;
    tokens_in_sum: string | number;
    tokens_out_sum: string | number;
    error_count: string | number;
  }>;
  const latencyRow = (
    latencyResult.rows as Array<{
      total_calls: string | number;
      total_errors: string | number;
      avg_latency_ms: string | number | null;
      p90_latency_ms: string | number | null;
    }>
  )[0];

  // Compute total cost in TS using pricing catalog
  let totalCostUsd = 0;
  let costAvailable = true;

  for (const r of modelRows) {
    const computed = computeLlmCost(r.model, Number(r.tokens_in_sum), Number(r.tokens_out_sum));
    if (!computed.available) {
      costAvailable = false;
    } else {
      totalCostUsd += computed.costUsd;
    }
  }

  const totalTokensIn = modelRows.reduce((sum, r) => sum + Number(r.tokens_in_sum), 0);
  const totalTokensOut = modelRows.reduce((sum, r) => sum + Number(r.tokens_out_sum), 0);
  const totalCalls = latencyRow ? Number(latencyRow.total_calls) : 0;

  return {
    totalCalls,
    errorRate:
      totalCalls > 0 && latencyRow
        ? Math.round((Number(latencyRow.total_errors) / totalCalls) * 10000) / 100
        : 0,
    totalTokensIn,
    totalTokensOut,
    estimatedCostUsd: costAvailable ? Math.round(totalCostUsd * 1e6) / 1e6 : null,
    costAvailable,
    avgLatencyMs:
      latencyRow !== undefined && latencyRow.avg_latency_ms !== null
        ? Math.round(Number(latencyRow.avg_latency_ms))
        : null,
    p90LatencyMs:
      latencyRow !== undefined && latencyRow.p90_latency_ms !== null
        ? Math.round(Number(latencyRow.p90_latency_ms))
        : null,
  };
}
export async function getAiModelBreakdown(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AiModelBreakdownRow[]> {
  const result = await db.execute(sql`
    SELECT model,
      COUNT(*) AS call_count,
      COALESCE(SUM(tokens_in), 0) AS tokens_in_sum,
      COALESCE(SUM(tokens_out), 0) AS tokens_out_sum,
      COUNT(*) FILTER (WHERE error IS NOT NULL) AS error_count
    FROM ai_decision_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      AND model IS NOT NULL
    GROUP BY model
    ORDER BY call_count DESC
  `);

  // `as` justificado: db.execute retorna unknown[]
  const rows = result.rows as Array<{
    model: string;
    call_count: string | number;
    tokens_in_sum: string | number;
    tokens_out_sum: string | number;
    error_count: string | number;
  }>;

  return rows.map((r) => {
    const callCount = Number(r.call_count);
    const tokensIn = Number(r.tokens_in_sum);
    const tokensOut = Number(r.tokens_out_sum);
    const computed = computeLlmCost(r.model, tokensIn, tokensOut);
    return {
      model: String(r.model),
      callCount,
      tokensIn,
      tokensOut,
      estimatedCostUsd: computed.available ? Math.round(computed.costUsd * 1e6) / 1e6 : null,
      costAvailable: computed.available,
    };
  });
}
export async function getAiHandoffSla(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AiHandoffSlaResult> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) AS total_handoffs,
      COUNT(*) FILTER (WHERE status IN ('accepted', 'resolved')) AS completed_handoffs,
      COUNT(*) FILTER (WHERE status = 'requested') AS pending_handoffs,
      AVG(
        EXTRACT(EPOCH FROM (updated_at - created_at))
      ) FILTER (WHERE status IN ('accepted', 'resolved')) AS avg_resolution_secs,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at - created_at)))
        FILTER (WHERE status IN ('accepted', 'resolved')) AS p90_resolution_secs
    FROM chatwoot_handoffs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      AND deleted_at IS NULL
  `);

  // as justificado: db.execute retorna unknown[]
  const row = (
    result.rows as Array<{
      total_handoffs: string | number;
      completed_handoffs: string | number;
      pending_handoffs: string | number;
      avg_resolution_secs: string | number | null;
      p90_resolution_secs: string | number | null;
    }>
  )[0];

  if (!row) {
    return {
      pendingHandoffs: 0,
      avgTimeToAcceptSec: null,
      p90TimeToAcceptSec: null,
    };
  }

  return {
    pendingHandoffs: Number(row.pending_handoffs),
    avgTimeToAcceptSec:
      row.avg_resolution_secs !== null ? Math.round(Number(row.avg_resolution_secs)) : null,
    p90TimeToAcceptSec:
      row.p90_resolution_secs !== null ? Math.round(Number(row.p90_resolution_secs)) : null,
  };
}
// ---------------------------------------------------------------------------
// Audit and Operations (section 4-H)
// ---------------------------------------------------------------------------

export async function getAuditVolume(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AuditVolumeResult> {
  const totalResult = await db.execute(sql`
    SELECT COUNT(*) AS total_events
    FROM audit_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
  `);

  const byResourceResult = await db.execute(sql`
    SELECT resource_type, COUNT(*) AS event_count
    FROM audit_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
    GROUP BY resource_type
    ORDER BY event_count DESC
    LIMIT 20
  `);

  // as justificado: db.execute retorna unknown[]
  const totalRow = (totalResult.rows as Array<{ total_events: string | number }>)[0];
  const byResourceRows = byResourceResult.rows as Array<{
    resource_type: string;
    event_count: string | number;
  }>;

  return {
    total: totalRow ? Number(totalRow.total_events) : 0,
    byResourceType: byResourceRows.map((r) => ({
      resourceType: String(r.resource_type),
      count: Number(r.event_count),
    })),
  };
}
export async function getAuditTopActions(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
  limit = 20,
): Promise<AuditActionRow[]> {
  // sql.raw justificado: limit e number controlado por codigo (Math.floor + clamp [1,100]), sem input externo
  const limitLiteral = sql.raw(String(Math.max(1, Math.min(100, Math.floor(limit)))));
  const result = await db.execute(sql`
    SELECT action, COUNT(*) AS event_count
    FROM audit_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
    GROUP BY action
    ORDER BY event_count DESC
    LIMIT ${limitLiteral}
  `);

  // as justificado: db.execute retorna unknown[]
  const rows = result.rows as Array<{ action: string; event_count: string | number }>;
  return rows.map((r) => ({
    action: String(r.action),
    count: Number(r.event_count),
  }));
}
export async function getAuditCriticalActions(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<AuditCriticalActionRow[]> {
  // CRITICAL_ACTION_PREFIXES parametrizados via sql.join com LIKE --- sem sql.raw com dados externos
  const likeConditions = CRITICAL_ACTION_PREFIXES.map((prefix) => sql`action LIKE ${prefix + '%'}`);
  const criticalCondition = sql.join(likeConditions, sql` OR `);

  const result = await db.execute(sql`
    SELECT action,
      COUNT(*) AS event_count,
      COUNT(DISTINCT actor_user_id) AS actor_count
    FROM audit_logs
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
      AND (${criticalCondition})
    GROUP BY action
    ORDER BY event_count DESC
    LIMIT 50
  `);

  // as justificado: db.execute retorna unknown[]
  const rows = result.rows as Array<{
    action: string;
    event_count: string | number;
    actor_count: string | number;
  }>;
  return rows.map((r) => ({
    action: String(r.action),
    count: Number(r.event_count),
    actorCount: Number(r.actor_count),
  }));
}
export async function getEventOutboxHealth(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<EventOutboxHealthResult> {
  const outboxResult = await db.execute(sql`
    SELECT
      COUNT(*) AS total_events,
      COUNT(*) FILTER (WHERE processed_at IS NOT NULL) AS processed_count,
      COUNT(*) FILTER (WHERE failed_at IS NOT NULL AND processed_at IS NULL) AS failed_count,
      COUNT(*) FILTER (WHERE processed_at IS NULL AND failed_at IS NULL) AS pending_count
    FROM event_outbox
    WHERE organization_id = ${organizationId}
      AND created_at >= ${dateRange.from.toISOString()}::timestamptz
      AND created_at <= ${dateRange.to.toISOString()}::timestamptz
  `);

  const latencyResult = await db.execute(sql`
    SELECT
      AVG(duration_ms) AS avg_duration_ms,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY duration_ms)
        FILTER (WHERE duration_ms IS NOT NULL) AS p90_duration_ms,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed_handler_count
    FROM event_processing_logs epl
    INNER JOIN event_outbox eo ON eo.id = epl.event_id
    WHERE eo.organization_id = ${organizationId}
      AND epl.processed_at >= ${dateRange.from.toISOString()}::timestamptz
      AND epl.processed_at <= ${dateRange.to.toISOString()}::timestamptz
  `);

  // as justificado: db.execute retorna unknown[]
  const outboxRow = (
    outboxResult.rows as Array<{
      total_events: string | number;
      processed_count: string | number;
      failed_count: string | number;
      pending_count: string | number;
    }>
  )[0];

  const latencyRow = (
    latencyResult.rows as Array<{
      avg_duration_ms: string | number | null;
      p90_duration_ms: string | number | null;
      failed_handler_count: string | number;
    }>
  )[0];

  const totalCreated = outboxRow ? Number(outboxRow.total_events) : 0;
  const totalProcessed = outboxRow ? Number(outboxRow.processed_count) : 0;

  return {
    totalCreated,
    totalProcessed,
    totalFailed: outboxRow ? Number(outboxRow.failed_count) : 0,
    totalPending: outboxRow ? Number(outboxRow.pending_count) : 0,
    successRate: totalCreated > 0 ? Math.round((totalProcessed / totalCreated) * 10000) / 100 : 0,
    avgProcessingLatencySec:
      latencyRow !== undefined && latencyRow.avg_duration_ms !== null
        ? Math.round(Number(latencyRow.avg_duration_ms) / 10) / 100
        : null,
  };
}
export async function getEventDlqSnapshot(
  db: Database,
  organizationId: string,
  dateRange: DateRange,
): Promise<EventDlqSnapshotResult> {
  const totalResult = await db.execute(sql`
    SELECT
      COUNT(*) AS total_dlq,
      COUNT(*) FILTER (WHERE reprocessed = true) AS reprocessed_count
    FROM event_dlq
    WHERE organization_id = ${organizationId}
      AND moved_at >= ${dateRange.from.toISOString()}::timestamptz
      AND moved_at <= ${dateRange.to.toISOString()}::timestamptz
  `);

  const topEventNamesResult = await db.execute(sql`
    SELECT event_name, COUNT(*) AS dlq_count
    FROM event_dlq
    WHERE organization_id = ${organizationId}
      AND moved_at >= ${dateRange.from.toISOString()}::timestamptz
      AND moved_at <= ${dateRange.to.toISOString()}::timestamptz
    GROUP BY event_name
    ORDER BY dlq_count DESC
    LIMIT 10
  `);

  // as justificado: db.execute retorna unknown[]
  const totalRow = (
    totalResult.rows as Array<{
      total_dlq: string | number;
      reprocessed_count: string | number;
    }>
  )[0];

  const topRows = topEventNamesResult.rows as Array<{
    event_name: string;
    dlq_count: string | number;
  }>;

  return {
    totalMoved: totalRow ? Number(totalRow.total_dlq) : 0,
    pendingReprocess: totalRow
      ? Number(totalRow.total_dlq) - Number(totalRow.reprocessed_count)
      : 0,
    topEventNames: topRows.map((r) => ({
      eventName: String(r.event_name),
      count: Number(r.dlq_count),
    })),
  };
}
