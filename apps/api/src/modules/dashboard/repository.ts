// =============================================================================
// dashboard/repository.ts — Queries Drizzle agregadas para KPIs do dashboard
//                           e dashboard de cobrança (F15-S09).
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
import { customers } from '../../db/schema/customers.js';
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
    // `as` justificado: INNER JOIN em cities garante cityId não-nulo no resultado.
    // city_id é nullable no schema (F3-S01) mas o INNER JOIN filtra leads sem cidade.
    cityId: r.cityId as string,
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
      .groupBy(kanbanCards.stageId, kanbanStages.name, kanbanStages.orderIndex)
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
      .groupBy(kanbanCards.stageId, kanbanStages.name, kanbanStages.orderIndex)
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
  // City scope como fragmento SQL PARAMETRIZADO — nada de interpolação de string
  // crua: os UUIDs entram via placeholders, não concatenados no texto da query.
  const cityScopeFragment =
    cityScopeIds === null
      ? sql``
      : cityIdOverride !== undefined
        ? sql`AND l.city_id = ${cityIdOverride}`
        : cityScopeIds.length === 0
          ? sql`AND 1 = 0`
          : sql`AND l.city_id IN (${sql.join(
              cityScopeIds.map((id) => sql`${id}`),
              sql`, `,
            )})`;

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
        ${cityScopeFragment}
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

// =============================================================================
// Cobrança — Dashboard de métricas (F15-S09)
//
// Todas as queries filtram por organization_id.
// city_id é opcional — quando fornecido, filtra via JOIN em customers→leads.
//
// LGPD (doc 17):
//   - Retornam apenas count + total_amount agregados — sem PII individual.
//   - customer_id, contract_reference: IDs opacos ou dado financeiro operacional.
//   - Nenhuma query expõe CPF, nome, telefone, email.
//
// Performance:
//   - Usa índices: idx_payment_dues_status_due, idx_payment_dues_customer.
//   - Queries com NOT EXISTS são executadas via SQL nativo para controle fino.
//   - Promise.all no service paralleliza as 5 queries independentes.
// =============================================================================

/**
 * Resultado de um card do dashboard de cobrança.
 * `total_amount` é string para preservar precisão numeric(14,2) do PostgreSQL.
 */
export interface CollectionCardResult {
  count: number;
  total_amount: string;
}

// ---------------------------------------------------------------------------
// due_soon: parcelas vencendo em até 7 dias
// ---------------------------------------------------------------------------

/**
 * Conta parcelas status IN ('pending','overdue') com due_date entre hoje e today+7.
 * Usa índice idx_payment_dues_status_due (status, due_date).
 *
 * city_id opcional: quando fornecido, aplica JOIN em customers→leads para filtrar
 * pela cidade do lead original do customer.
 */
export async function countDueSoon(
  db: Database,
  organizationId: string,
  cityId?: string,
): Promise<CollectionCardResult> {
  // Calculamos as datas no lado da aplicação — evita depender de now() imutável em testes
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayPlus7 = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  const cityFragment =
    cityId !== undefined
      ? sql`
          AND pd.customer_id IN (
            SELECT c.id FROM customers c
            INNER JOIN leads l ON l.id = c.primary_lead_id
            WHERE l.city_id = ${cityId}
              AND l.deleted_at IS NULL
          )`
      : sql``;

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS count,
      COALESCE(SUM(pd.amount), 0)::text AS total_amount
    FROM payment_dues pd
    WHERE pd.organization_id = ${organizationId}
      AND pd.status IN ('pending', 'overdue')
      AND pd.due_date >= ${today.toISOString().slice(0, 10)}
      AND pd.due_date <= ${todayPlus7.toISOString().slice(0, 10)}
      ${cityFragment}
  `);

  const row = result.rows[0] as { count: number; total_amount: string } | undefined;
  return { count: row?.count ?? 0, total_amount: row?.total_amount ?? '0' };
}

// ---------------------------------------------------------------------------
// overdue_uncollected: vencidos sem collection_job ativo
// ---------------------------------------------------------------------------

/**
 * Conta parcelas vencidas (status='overdue') SEM collection_job ativo.
 * "Ativo" = status IN ('scheduled', 'triggered', 'sent').
 * Parcelas com jobs apenas em ('failed', 'cancelled', 'paid_before_send')
 * também contam como "uncollected" — job falhou ou foi cancelado.
 *
 * Usa NOT EXISTS para evitar N+1 e aproveitar idx_collection_jobs_payment_due.
 */
export async function countOverdueUncollected(
  db: Database,
  organizationId: string,
  cityId?: string,
): Promise<CollectionCardResult> {
  const cityFragment =
    cityId !== undefined
      ? sql`
          AND pd.customer_id IN (
            SELECT c.id FROM customers c
            INNER JOIN leads l ON l.id = c.primary_lead_id
            WHERE l.city_id = ${cityId}
              AND l.deleted_at IS NULL
          )`
      : sql``;

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS count,
      COALESCE(SUM(pd.amount), 0)::text AS total_amount
    FROM payment_dues pd
    WHERE pd.organization_id = ${organizationId}
      AND pd.status = 'overdue'
      AND NOT EXISTS (
        SELECT 1 FROM collection_jobs cj
        WHERE cj.payment_due_id = pd.id
          AND cj.status IN ('scheduled', 'triggered', 'sent')
      )
      ${cityFragment}
  `);

  const row = result.rows[0] as { count: number; total_amount: string } | undefined;
  return { count: row?.count ?? 0, total_amount: row?.total_amount ?? '0' };
}

// ---------------------------------------------------------------------------
// in_collection: parcelas com collection_job ativo
// ---------------------------------------------------------------------------

/**
 * Conta parcelas (qualquer status ativo de cobrança) COM collection_job ativo.
 * "Ativo" = status IN ('scheduled', 'triggered', 'sent').
 * Agrupa por payment_due_id para não contar a mesma parcela múltiplas vezes
 * quando há mais de um job ativo (raro, mas possível em reenvios).
 */
export async function countInCollection(
  db: Database,
  organizationId: string,
  cityId?: string,
): Promise<CollectionCardResult> {
  const cityFragment =
    cityId !== undefined
      ? sql`
          AND pd.customer_id IN (
            SELECT c.id FROM customers c
            INNER JOIN leads l ON l.id = c.primary_lead_id
            WHERE l.city_id = ${cityId}
              AND l.deleted_at IS NULL
          )`
      : sql``;

  const result = await db.execute(sql`
    SELECT
      COUNT(DISTINCT pd.id)::int AS count,
      COALESCE(SUM(DISTINCT pd.amount), 0)::text AS total_amount
    FROM payment_dues pd
    WHERE pd.organization_id = ${organizationId}
      AND pd.status IN ('pending', 'overdue')
      AND EXISTS (
        SELECT 1 FROM collection_jobs cj
        WHERE cj.payment_due_id = pd.id
          AND cj.status IN ('scheduled', 'triggered', 'sent')
      )
      ${cityFragment}
  `);

  const row = result.rows[0] as { count: number; total_amount: string } | undefined;
  return { count: row?.count ?? 0, total_amount: row?.total_amount ?? '0' };
}

// ---------------------------------------------------------------------------
// overdue_15d: inadimplentes há 15+ dias
// ---------------------------------------------------------------------------

/**
 * Conta parcelas vencidas há 15 dias ou mais (status='overdue' AND due_date <= today-15).
 * Candidatos prioritários para inclusão no SPC ou escalonamento jurídico.
 */
export async function countOverdue15d(
  db: Database,
  organizationId: string,
  cityId?: string,
): Promise<CollectionCardResult> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000);

  const cityFragment =
    cityId !== undefined
      ? sql`
          AND pd.customer_id IN (
            SELECT c.id FROM customers c
            INNER JOIN leads l ON l.id = c.primary_lead_id
            WHERE l.city_id = ${cityId}
              AND l.deleted_at IS NULL
          )`
      : sql``;

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS count,
      COALESCE(SUM(pd.amount), 0)::text AS total_amount
    FROM payment_dues pd
    WHERE pd.organization_id = ${organizationId}
      AND pd.status = 'overdue'
      AND pd.due_date <= ${cutoff.toISOString().slice(0, 10)}
      ${cityFragment}
  `);

  const row = result.rows[0] as { count: number; total_amount: string } | undefined;
  return { count: row?.count ?? 0, total_amount: row?.total_amount ?? '0' };
}

// ---------------------------------------------------------------------------
// in_spc: clientes negativados no SPC
// ---------------------------------------------------------------------------

/**
 * Conta clientes com spc_status='included' e soma suas parcelas ativas (status IN
 * ('pending','overdue')) como total_amount de risco.
 *
 * Retorna count de clientes (não de parcelas) — alinhado com o significado do card.
 * total_amount = soma de payment_dues pending/overdue dos clientes incluídos.
 *
 * city_id opcional: filtra clientes via JOIN em leads.
 */
export async function countInSpc(
  db: Database,
  organizationId: string,
  cityId?: string,
): Promise<CollectionCardResult> {
  // city_id filtra clientes via JOIN customers→leads
  if (cityId !== undefined) {
    // Com filtro de cidade: duas queries paralelas (count + sum)
    const [countResult, amountResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM customers c
        INNER JOIN leads l ON l.id = c.primary_lead_id
        WHERE c.organization_id = ${organizationId}
          AND c.spc_status = 'included'
          AND l.city_id = ${cityId}
          AND l.deleted_at IS NULL
      `),
      db.execute(sql`
        SELECT COALESCE(SUM(pd.amount), 0)::text AS total_amount
        FROM payment_dues pd
        INNER JOIN customers c ON c.id = pd.customer_id
        INNER JOIN leads l ON l.id = c.primary_lead_id
        WHERE pd.organization_id = ${organizationId}
          AND pd.status IN ('pending', 'overdue')
          AND c.spc_status = 'included'
          AND l.city_id = ${cityId}
          AND l.deleted_at IS NULL
      `),
    ]);

    const cRow = countResult.rows[0] as { count: number } | undefined;
    const aRow = amountResult.rows[0] as { total_amount: string } | undefined;
    return { count: cRow?.count ?? 0, total_amount: aRow?.total_amount ?? '0' };
  }

  // Sem filtro de cidade: query mais simples com JOIN em payment_dues
  const [countResult, amountResult] = await Promise.all([
    db
      .select({ count: count() })
      .from(customers)
      .where(
        and(eq(customers.organizationId, organizationId), eq(customers.spcStatus, 'included')),
      ),
    db.execute(sql`
      SELECT COALESCE(SUM(pd.amount), 0)::text AS total_amount
      FROM payment_dues pd
      INNER JOIN customers c ON c.id = pd.customer_id
      WHERE pd.organization_id = ${organizationId}
        AND pd.status IN ('pending', 'overdue')
        AND c.spc_status = 'included'
    `),
  ]);

  const aRow = amountResult.rows[0] as { total_amount: string } | undefined;
  return {
    count: countResult[0]?.count ?? 0,
    total_amount: aRow?.total_amount ?? '0',
  };
}
