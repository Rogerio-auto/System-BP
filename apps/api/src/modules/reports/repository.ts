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
