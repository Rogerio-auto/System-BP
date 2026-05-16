// =============================================================================
// dashboard/repository.ts — Queries Drizzle agregadas para KPIs do dashboard.
//
// Todas as queries recebem `db` por injeção de dependência para facilitar
// testes unitários (mock do db).
//
// City Scope:
//   - cityScopeIds === null  → acesso global (admin/gestor_geral): sem filtro.
//   - cityScopeIds === []    → sem acesso a cidade alguma: consultas retornam vazio.
//   - cityScopeIds: string[] → WHERE city_id IN (...) aplicado automaticamente.
//
// LGPD (doc 17):
//   - Queries NUNCA retornam name, phone_e164, email, cpf_hash de leads.
//   - Somente contagens e IDs opacos são retornados.
//   - display_name de agentes é dado de colaborador (não PII de cidadão).
//
// Performance:
//   - Índices usados: idx_leads_org_status_created, idx_leads_org_city,
//     idx_interactions_org_channel_created.
//   - Todas as queries agregam diretamente com GROUP BY — sem subqueries N+1.
//   - Promise.all paralleliza as consultas independentes.
// =============================================================================
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { agents } from '../../db/schema/agents.js';
import { cities } from '../../db/schema/cities.js';
import { interactions } from '../../db/schema/interactions.js';
import { kanbanCards } from '../../db/schema/kanbanCards.js';
import { kanbanStages } from '../../db/schema/kanbanStages.js';
import { leads } from '../../db/schema/leads.js';

import type { InteractionChannel, LeadSource, LeadStatus } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

export interface DateRange {
  from: Date;
  to: Date;
}

export interface LeadsByStatusRow {
  status: LeadStatus;
  count: number;
}

export interface LeadsByCityRow {
  cityId: string;
  cityName: string;
  count: number;
}

export interface LeadsBySourceRow {
  source: LeadSource;
  count: number;
}

export interface InteractionsByChannelRow {
  channel: InteractionChannel;
  count: number;
}

export interface KanbanCardsByStageRow {
  stageId: string;
  stageName: string;
  count: number;
}

export interface KanbanAvgDaysRow {
  stageId: string;
  days: number;
}

export interface TopAgentRow {
  agentId: string;
  displayName: string;
  closedWon: number;
}

// ---------------------------------------------------------------------------
// City scope helper
// ---------------------------------------------------------------------------

/**
 * Constrói condição SQL de city scope para leads.cityId.
 * Segue o mesmo padrão de leads/repository.ts e shared/scope.ts.
 */
function buildLeadsCityScope(
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): ReturnType<typeof inArray> | ReturnType<typeof sql> | ReturnType<typeof eq> | null {
  // Se cityIdOverride informado, filtra só essa cidade (scope já validado no service)
  if (cityIdOverride !== undefined) {
    return eq(leads.cityId, cityIdOverride);
  }

  if (cityScopeIds === null) {
    // Acesso global — sem filtro
    return null;
  }

  if (cityScopeIds.length === 0) {
    // `as` justificado: sql<boolean> é compatível com condição Drizzle
    return sql`1 = 0` as ReturnType<typeof sql>;
  }

  return inArray(leads.cityId, cityScopeIds);
}

/**
 * Constrói condição SQL de city scope para interactions via lead.
 * interactions não tem city_id direto — filtramos via JOIN ou subquery.
 * Usamos leads.cityId via JOIN em vez de denormalização.
 */
function buildInteractionsCityScope(
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): ReturnType<typeof inArray> | ReturnType<typeof sql> | ReturnType<typeof eq> | null {
  if (cityIdOverride !== undefined) {
    return eq(leads.cityId, cityIdOverride);
  }

  if (cityScopeIds === null) {
    return null;
  }

  if (cityScopeIds.length === 0) {
    return sql`1 = 0` as ReturnType<typeof sql>;
  }

  return inArray(leads.cityId, cityScopeIds);
}

// ---------------------------------------------------------------------------
// Leads — contagem total
// ---------------------------------------------------------------------------

/**
 * Conta total de leads ativos (não deletados) no escopo.
 */
export async function countTotalLeads(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): Promise<number> {
  const conditions = [
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildLeadsCityScope(cityScopeIds, cityIdOverride);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ count: count() })
    .from(leads)
    .where(and(...conditions));

  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Leads — novos no intervalo
// ---------------------------------------------------------------------------

/**
 * Conta leads criados no intervalo.
 */
export async function countNewLeadsInRange(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  range: DateRange,
  cityIdOverride?: string,
): Promise<number> {
  const conditions = [
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
    // `as` justificado: sql<boolean> é condição Drizzle válida
    sql`${leads.createdAt} >= ${range.from.toISOString()}::timestamptz` as ReturnType<typeof eq>,
    sql`${leads.createdAt} <= ${range.to.toISOString()}::timestamptz` as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildLeadsCityScope(cityScopeIds, cityIdOverride);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ count: count() })
    .from(leads)
    .where(and(...conditions));

  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Leads — distribuição por status
// ---------------------------------------------------------------------------

/**
 * Conta leads ativos por status no escopo.
 */
export async function countLeadsByStatus(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): Promise<LeadsByStatusRow[]> {
  const conditions = [
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildLeadsCityScope(cityScopeIds, cityIdOverride);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ status: leads.status, count: count() })
    .from(leads)
    .where(and(...conditions))
    .groupBy(leads.status);

  // `as` justificado: DB enforça o enum via check constraint — valor é sempre LeadStatus
  return rows.map((r) => ({ status: r.status as LeadStatus, count: r.count }));
}

// ---------------------------------------------------------------------------
// Leads — distribuição por cidade
// ---------------------------------------------------------------------------

/**
 * Conta leads ativos por cidade com nome da cidade.
 * JOIN com cities para obter cityName.
 * LGPD: retorna só cityId + cityName (não PII de leads).
 */
export async function countLeadsByCity(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): Promise<LeadsByCityRow[]> {
  const conditions = [
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildLeadsCityScope(cityScopeIds, cityIdOverride);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({
      cityId: leads.cityId,
      cityName: cities.name,
      count: count(),
    })
    .from(leads)
    .innerJoin(cities, eq(leads.cityId, cities.id))
    .where(and(...conditions))
    .groupBy(leads.cityId, cities.name)
    .orderBy(sql`count(*) DESC`);

  return rows.map((r) => ({
    cityId: r.cityId,
    cityName: r.cityName,
    count: r.count,
  }));
}

// ---------------------------------------------------------------------------
// Leads — distribuição por source
// ---------------------------------------------------------------------------

/**
 * Conta leads ativos por canal de origem.
 */
export async function countLeadsBySource(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): Promise<LeadsBySourceRow[]> {
  const conditions = [
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildLeadsCityScope(cityScopeIds, cityIdOverride);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({ source: leads.source, count: count() })
    .from(leads)
    .where(and(...conditions))
    .groupBy(leads.source);

  // `as` justificado: DB enforça o enum via check constraint
  return rows.map((r) => ({ source: r.source as LeadSource, count: r.count }));
}

// ---------------------------------------------------------------------------
// Leads — stale count
// ---------------------------------------------------------------------------

/**
 * Conta leads sem interação há mais de 7 dias (stale).
 *
 * Algoritmo:
 *   - Leads sem nenhuma interação: stale se created_at < now() - 7 days.
 *   - Leads com interações: stale se MAX(interactions.created_at) < now() - 7 days.
 *
 * Usa LEFT JOIN para incluir leads sem interações.
 * LGPD: retorna apenas contagem.
 */
export async function countStaleLeads(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const conditions = [
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildLeadsCityScope(cityScopeIds, cityIdOverride);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  // Stale = lead ativo onde a última interação (ou, se nenhuma, criação do lead) é > 7 dias atrás.
  // Usamos SQL nativo para a lógica COALESCE(MAX(interactions.created_at), leads.created_at).
  const rows = await db
    .select({ count: count() })
    .from(leads)
    .leftJoin(interactions, eq(interactions.leadId, leads.id))
    .where(and(...conditions))
    .groupBy(leads.id)
    .having(
      // `as` justificado: sql<boolean> é condição Drizzle válida em HAVING
      sql`COALESCE(MAX(${interactions.createdAt}), ${leads.createdAt}) < ${sevenDaysAgo.toISOString()}::timestamptz` as ReturnType<
        typeof eq
      >,
    );

  return rows.length;
}

// ---------------------------------------------------------------------------
// Interactions — total no intervalo
// ---------------------------------------------------------------------------

/**
 * Conta interações totais no intervalo para a org, com city scope via JOIN em leads.
 */
export async function countInteractionsInRange(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  range: DateRange,
  cityIdOverride?: string,
): Promise<number> {
  const baseConditions = [
    eq(interactions.organizationId, organizationId),
    sql`${interactions.createdAt} >= ${range.from.toISOString()}::timestamptz` as ReturnType<
      typeof eq
    >,
    sql`${interactions.createdAt} <= ${range.to.toISOString()}::timestamptz` as ReturnType<
      typeof eq
    >,
  ];

  const scopeCondition = buildInteractionsCityScope(cityScopeIds, cityIdOverride);

  if (scopeCondition !== null) {
    // Precisa JOIN com leads para filtrar por city_id
    const rows = await db
      .select({ count: count() })
      .from(interactions)
      .innerJoin(leads, eq(interactions.leadId, leads.id))
      .where(
        and(
          ...baseConditions,
          scopeCondition as ReturnType<typeof eq>,
          isNull(leads.deletedAt) as ReturnType<typeof eq>,
        ),
      );

    return rows[0]?.count ?? 0;
  }

  // Sem city scope — não precisa de JOIN (mais rápido)
  const rows = await db
    .select({ count: count() })
    .from(interactions)
    .where(and(...baseConditions));

  return rows[0]?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Interactions — distribuição por canal
// ---------------------------------------------------------------------------

/**
 * Conta interações no intervalo por canal, com city scope.
 */
export async function countInteractionsByChannel(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  range: DateRange,
  cityIdOverride?: string,
): Promise<InteractionsByChannelRow[]> {
  const baseConditions = [
    eq(interactions.organizationId, organizationId),
    sql`${interactions.createdAt} >= ${range.from.toISOString()}::timestamptz` as ReturnType<
      typeof eq
    >,
    sql`${interactions.createdAt} <= ${range.to.toISOString()}::timestamptz` as ReturnType<
      typeof eq
    >,
  ];

  const scopeCondition = buildInteractionsCityScope(cityScopeIds, cityIdOverride);

  let rows: Array<{ channel: string; count: number }>;

  if (scopeCondition !== null) {
    rows = await db
      .select({ channel: interactions.channel, count: count() })
      .from(interactions)
      .innerJoin(leads, eq(interactions.leadId, leads.id))
      .where(
        and(
          ...baseConditions,
          scopeCondition as ReturnType<typeof eq>,
          isNull(leads.deletedAt) as ReturnType<typeof eq>,
        ),
      )
      .groupBy(interactions.channel);
  } else {
    rows = await db
      .select({ channel: interactions.channel, count: count() })
      .from(interactions)
      .where(and(...baseConditions))
      .groupBy(interactions.channel);
  }

  // `as` justificado: DB enforça o enum via check constraint
  return rows.map((r) => ({ channel: r.channel as InteractionChannel, count: r.count }));
}

// ---------------------------------------------------------------------------
// Interactions — ratio inbound/outbound
// ---------------------------------------------------------------------------

/**
 * Conta interações inbound e outbound no intervalo.
 */
export async function countInteractionsByDirection(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  range: DateRange,
  cityIdOverride?: string,
): Promise<{ inbound: number; outbound: number }> {
  const baseConditions = [
    eq(interactions.organizationId, organizationId),
    sql`${interactions.createdAt} >= ${range.from.toISOString()}::timestamptz` as ReturnType<
      typeof eq
    >,
    sql`${interactions.createdAt} <= ${range.to.toISOString()}::timestamptz` as ReturnType<
      typeof eq
    >,
  ];

  const scopeCondition = buildInteractionsCityScope(cityScopeIds, cityIdOverride);

  let rows: Array<{ direction: string; count: number }>;

  if (scopeCondition !== null) {
    rows = await db
      .select({ direction: interactions.direction, count: count() })
      .from(interactions)
      .innerJoin(leads, eq(interactions.leadId, leads.id))
      .where(
        and(
          ...baseConditions,
          scopeCondition as ReturnType<typeof eq>,
          isNull(leads.deletedAt) as ReturnType<typeof eq>,
        ),
      )
      .groupBy(interactions.direction);
  } else {
    rows = await db
      .select({ direction: interactions.direction, count: count() })
      .from(interactions)
      .where(and(...baseConditions))
      .groupBy(interactions.direction);
  }

  const inboundRow = rows.find((r) => r.direction === 'inbound');
  const outboundRow = rows.find((r) => r.direction === 'outbound');

  return {
    inbound: inboundRow?.count ?? 0,
    outbound: outboundRow?.count ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Kanban — cards por stage
// ---------------------------------------------------------------------------

/**
 * Conta kanban cards por stage para a org.
 * City scope: via JOIN em leads (kanban_cards.lead_id → leads.city_id).
 */
export async function countKanbanCardsByStage(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): Promise<KanbanCardsByStageRow[]> {
  const baseConditions = [eq(kanbanCards.organizationId, organizationId)];

  const scopeCondition =
    cityScopeIds === null
      ? null
      : cityIdOverride !== undefined
        ? eq(leads.cityId, cityIdOverride)
        : cityScopeIds.length === 0
          ? sql`1 = 0`
          : inArray(leads.cityId, cityScopeIds);

  let rows: Array<{ stageId: string; stageName: string; count: number }>;

  if (scopeCondition !== null) {
    rows = await db
      .select({
        stageId: kanbanCards.stageId,
        stageName: kanbanStages.name,
        count: count(),
      })
      .from(kanbanCards)
      .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
      .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
      .where(
        and(
          ...baseConditions,
          scopeCondition as ReturnType<typeof eq>,
          isNull(leads.deletedAt) as ReturnType<typeof eq>,
        ),
      )
      .groupBy(kanbanCards.stageId, kanbanStages.name)
      .orderBy(kanbanStages.orderIndex);
  } else {
    rows = await db
      .select({
        stageId: kanbanCards.stageId,
        stageName: kanbanStages.name,
        count: count(),
      })
      .from(kanbanCards)
      .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
      .where(and(...baseConditions))
      .groupBy(kanbanCards.stageId, kanbanStages.name)
      .orderBy(kanbanStages.orderIndex);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Kanban — tempo médio por stage
// ---------------------------------------------------------------------------

/**
 * Calcula o tempo médio (em dias) que cards ficam em cada stage,
 * a partir de kanban_stage_history.
 *
 * Algoritmo:
 *   Para cada transição em stage_history:
 *     - Duração = próxima transição deste card - transição atual.
 *     - Se não houver próxima transição, usa COALESCE(now(), ...) para cards ainda no stage.
 *   Agrupa por to_stage_id e calcula a média.
 *
 * City scope: via JOIN kanban_cards → leads.
 */
export async function getAvgDaysInStage(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  cityIdOverride?: string,
): Promise<KanbanAvgDaysRow[]> {
  // Usamos SQL nativo para a janela de tempo (LEAD window function)
  // Drizzle não suporta LEAD/LAG nativamente em modo type-safe — justificado.
  const cityScopeSql =
    cityScopeIds === null
      ? ''
      : cityIdOverride !== undefined
        ? `AND l.city_id = '${cityIdOverride}'`
        : cityScopeIds.length === 0
          ? 'AND 1 = 0'
          : `AND l.city_id IN (${cityScopeIds.map((id) => `'${id}'`).join(', ')})`;

  // `as` justificado: sql`` retorna SQL<unknown> mas Drizzle aceita para execute()
  const result = await db.execute(sql`
    WITH transitions AS (
      SELECT
        ksh.card_id,
        ksh.to_stage_id,
        ksh.transitioned_at,
        LEAD(ksh.transitioned_at) OVER (
          PARTITION BY ksh.card_id
          ORDER BY ksh.transitioned_at ASC
        ) AS next_transitioned_at
      FROM kanban_stage_history ksh
      INNER JOIN kanban_cards kc ON kc.id = ksh.card_id
      INNER JOIN leads l ON l.id = kc.lead_id
      WHERE kc.organization_id = ${organizationId}
        AND (l.deleted_at IS NULL)
        ${sql.raw(cityScopeSql)}
    ),
    durations AS (
      SELECT
        to_stage_id,
        EXTRACT(EPOCH FROM (
          COALESCE(next_transitioned_at, NOW()) - transitioned_at
        )) / 86400.0 AS days_in_stage
      FROM transitions
    )
    SELECT
      to_stage_id AS "stageId",
      ROUND(AVG(days_in_stage)::numeric, 2) AS "avgDays"
    FROM durations
    GROUP BY to_stage_id
  `);

  // `as` justificado: sql.execute retorna unknown[] — precisamos tipar os rows
  return (result.rows as Array<{ stageId: string; avgDays: string | number }>).map((r) => ({
    stageId: r.stageId,
    days: typeof r.avgDays === 'string' ? parseFloat(r.avgDays) : r.avgDays,
  }));
}

// ---------------------------------------------------------------------------
// Agents — top por leads closed_won no intervalo
// ---------------------------------------------------------------------------

/**
 * Retorna os top agentes por quantidade de leads fechados como ganho (closed_won)
 * no intervalo de tempo, para a org.
 *
 * City scope: via leads.city_id.
 * LGPD: retorna agent_id + display_name (dado de colaborador, não PII de cidadão).
 */
export async function getTopAgentsByLeadsClosed(
  db: Database,
  organizationId: string,
  cityScopeIds: string[] | null,
  range: DateRange,
  cityIdOverride?: string,
  limit = 5,
): Promise<TopAgentRow[]> {
  const conditions = [
    eq(leads.organizationId, organizationId),
    eq(leads.status, 'closed_won' as const),
    isNull(leads.deletedAt) as ReturnType<typeof eq>,
    sql`${leads.updatedAt} >= ${range.from.toISOString()}::timestamptz` as ReturnType<typeof eq>,
    sql`${leads.updatedAt} <= ${range.to.toISOString()}::timestamptz` as ReturnType<typeof eq>,
    // Só leads com agente atribuído
    sql`${leads.agentId} IS NOT NULL` as ReturnType<typeof eq>,
  ];

  const scopeCondition = buildLeadsCityScope(cityScopeIds, cityIdOverride);
  if (scopeCondition !== null) {
    conditions.push(scopeCondition as ReturnType<typeof eq>);
  }

  const rows = await db
    .select({
      agentId: agents.id,
      displayName: agents.displayName,
      closedWon: count(),
    })
    .from(leads)
    .innerJoin(agents, eq(leads.agentId, agents.id))
    .where(and(...conditions))
    .groupBy(agents.id, agents.displayName)
    .orderBy(sql`count(*) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    agentId: r.agentId,
    displayName: r.displayName,
    closedWon: r.closedWon,
  }));
}
