// =============================================================================
// kanban/repository.ts — Queries Drizzle para o módulo kanban (F1-S13).
//
// City-scope: o escopo de cidade é verificado via lead.city_id.
// O service valida organizationId em ambas as entidades antes de chamar aqui.
//
// Imutabilidade de kanban_stage_history: este módulo expõe apenas
// insertHistory() — nunca update ou delete. Ver kanbanStageHistory.ts.
// =============================================================================
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database } from '../../db/client.js';
import {
  cities,
  kanbanCards,
  kanbanStages,
  kanbanStageHistory,
  leads,
  users,
} from '../../db/schema/index.js';
import type { KanbanCard, KanbanStage, NewKanbanStageHistoryEntry } from '../../db/schema/index.js';
import { applyCityScope } from '../../shared/scope.js';
import type { UserScopeCtx } from '../../shared/scope.js';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface KanbanStageRow {
  id: string;
  name: string;
  orderIndex: number;
  color: string | null;
  organizationId: string;
}

export interface ListCardsFilters {
  organizationId: string;
  stageId?: string | undefined;
  cityId?: string | undefined;
  agentId?: string | undefined;
  page: number;
  limit: number;
}

export interface KanbanCardRow {
  id: string;
  stageId: string;
  leadId: string;
  leadName: string;
  /** phoneE164 bruto — mascaramento ocorre no service antes de retornar ao cliente */
  phoneE164: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  priority: number;
  notes: string | null;
  updatedAt: Date;
  /** city_id nullable no schema (F3-S01): lead pode não ter cidade ainda (agente IA). */
  cityId: string | null;
  /** Nome da cidade (join cities) — para o chip no card (F13-S03). null = sem cidade. */
  cityName: string | null;
}

// ---------------------------------------------------------------------------
// Tipo minimal para transação Drizzle (reutilizável dentro do módulo)
// ---------------------------------------------------------------------------

// Justificativa: Drizzle não exporta tipo público para NodePgTransaction.
// Esta interface estrutural é compatível com db.transaction(tx => ...).
export interface KanbanTx {
  insert: Database['insert'];
  update: Database['update'];
  select: Database['select'];
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * Busca um stage por ID, dentro de uma organização (RBAC/multi-tenant).
 * Retorna undefined se não encontrado ou se pertencer a outra org.
 */
export async function findStageById(
  db: Database | KanbanTx,
  stageId: string,
  organizationId: string,
): Promise<KanbanStage | undefined> {
  const [row] = await (db as Database)
    .select()
    .from(kanbanStages)
    .where(and(eq(kanbanStages.id, stageId), eq(kanbanStages.organizationId, organizationId)))
    .limit(1);
  return row;
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Busca um card por ID, dentro de uma organização.
 * Retorna undefined se não encontrado ou se pertencer a outra org.
 */
export async function findCardById(
  db: Database | KanbanTx,
  cardId: string,
  organizationId: string,
): Promise<KanbanCard | undefined> {
  const [row] = await (db as Database)
    .select()
    .from(kanbanCards)
    .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, organizationId)))
    .limit(1);
  return row;
}

/**
 * Atualiza o stage de um card dentro de uma transação.
 * Também atualiza entered_stage_at e updated_at.
 * Retorna o card atualizado.
 */
export async function updateCardStage(
  tx: KanbanTx,
  cardId: string,
  toStageId: string,
  organizationId: string,
): Promise<KanbanCard> {
  const now = new Date();

  const [updated] = await (tx as Database)
    .update(kanbanCards)
    .set({
      stageId: toStageId,
      enteredStageAt: now,
      updatedAt: now,
    })
    .where(and(eq(kanbanCards.id, cardId), eq(kanbanCards.organizationId, organizationId)))
    .returning();

  // updated cannot be undefined here: the card was just verified to exist
  // by findCardById before entering the transaction.
  // Justificativa do `as`: Drizzle retorna T[] — não temos forma de tipar
  // .returning() como [T, ...T[]] sem cast. A garantia é provida pelo service
  // que valida existência antes de chamar esta função.
  return updated as KanbanCard;
}

// ---------------------------------------------------------------------------
// List: stages do board
// ---------------------------------------------------------------------------

/**
 * Lista todos os stages de uma organização, ordenados por order_index ASC.
 *
 * Não filtra por cidade — stages são globais por org (multi-tenant).
 * City-scope é aplicado na listagem de cards, não de stages.
 */
export async function listStages(db: Database, organizationId: string): Promise<KanbanStageRow[]> {
  return db
    .select({
      id: kanbanStages.id,
      name: kanbanStages.name,
      orderIndex: kanbanStages.orderIndex,
      color: kanbanStages.color,
      organizationId: kanbanStages.organizationId,
    })
    .from(kanbanStages)
    .where(eq(kanbanStages.organizationId, organizationId))
    .orderBy(asc(kanbanStages.orderIndex));
}

// ---------------------------------------------------------------------------
// List: cards do board com city-scope e paginação
// ---------------------------------------------------------------------------

/**
 * Lista cards do Kanban com JOIN em leads (nome, telefone, city_id) e
 * users (nome do assignee). Aplica city-scope via leads.cityId.
 *
 * City-scope: agentes/operadores só veem cards cujos leads pertencem a cidades
 * no seu escopo. Admin/gestor_geral passam cityScopeIds = null → sem filtro.
 *
 * Security note (doc 10 §3.5): se um card não for encontrado após cityScope,
 * o resultado é simplesmente omitido da lista (não lança 404 em listagens).
 *
 * LGPD §8.5: phoneE164 é retornado bruto aqui e mascarado no service layer
 * antes de sair para o cliente. Este repository NUNCA expõe o telefone ao
 * caller sem que o service aplique o redact.
 */
export async function listCards(
  db: Database,
  filters: ListCardsFilters,
  userCtx: UserScopeCtx,
): Promise<{ rows: KanbanCardRow[]; total: number }> {
  const offset = (filters.page - 1) * filters.limit;

  // Condições de filtro (multi-tenant + filtros opcionais)
  const conditions = [
    eq(kanbanCards.organizationId, filters.organizationId),
    isNull(leads.deletedAt),
    ...(filters.stageId !== undefined ? [eq(kanbanCards.stageId, filters.stageId)] : []),
    ...(filters.agentId !== undefined ? [eq(kanbanCards.assigneeUserId, filters.agentId)] : []),
    ...(filters.cityId !== undefined ? [eq(leads.cityId, filters.cityId)] : []),
  ];

  // City-scope via leads.cityId
  // admin/gestor_geral: cityScopeIds === null → sem filtro adicional
  // agente/operador: cityScopeIds = [uuid, ...] → WHERE leads.city_id IN (...)
  // sem cidade: cityScopeIds = [] → WHERE 1=0 → zero linhas
  const scopeCond = applyCityScope(userCtx, leads.cityId);
  if (scopeCond !== undefined) {
    conditions.push(scopeCond);
  }

  // Justificativa do `as` abaixo: Drizzle não infere SQL[] → SQL corretamente
  // quando misturamos condições geradas por applyCityScope com as fixas.
  // A função `and` aceita (SQL | undefined)[] e produz SQL | undefined.
  const whereClause = and(...conditions);

  // Contagem total (sem paginação)
  const [countRow] = await db
    .select({ total: count() })
    .from(kanbanCards)
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    .where(whereClause);

  const total = countRow?.total ?? 0;

  // Cards paginados com dados enriquecidos do lead e assignee
  const rows = await db
    .select({
      id: kanbanCards.id,
      stageId: kanbanCards.stageId,
      leadId: kanbanCards.leadId,
      leadName: leads.name,
      phoneE164: leads.phoneE164,
      assigneeUserId: kanbanCards.assigneeUserId,
      // LEFT JOIN: assignee pode ser null
      assigneeName: users.fullName,
      priority: kanbanCards.priority,
      notes: kanbanCards.notes,
      updatedAt: kanbanCards.updatedAt,
      cityId: leads.cityId,
      cityName: cities.name,
    })
    .from(kanbanCards)
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    // LEFT JOIN em users para obter o nome do assignee sem descartar cards sem assignee
    .leftJoin(users, eq(kanbanCards.assigneeUserId, users.id))
    // LEFT JOIN em cities para o nome da cidade (chip no card)
    .leftJoin(cities, eq(leads.cityId, cities.id))
    .where(whereClause)
    // Ordenar por priority DESC (maior prioridade primeiro), depois por updatedAt DESC
    .orderBy(desc(kanbanCards.priority), desc(kanbanCards.updatedAt))
    .limit(filters.limit)
    .offset(offset);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      stageId: r.stageId,
      leadId: r.leadId,
      leadName: r.leadName,
      phoneE164: r.phoneE164,
      assigneeUserId: r.assigneeUserId ?? null,
      assigneeName: r.assigneeName ?? null,
      priority: r.priority,
      notes: r.notes ?? null,
      updatedAt: r.updatedAt,
      cityId: r.cityId,
      cityName: r.cityName ?? null,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Stage inicial — usado por createLead (cria card automaticamente)
// ---------------------------------------------------------------------------

/**
 * Retorna o stage de menor `order_index` da organização (stage inicial).
 *
 * Convenção: `kanban_stages.order_index = 0` é o stage onde leads recém-criados
 * entram. Definido pelo seed em `apps/api/scripts/seed.ts` como
 * "Pré-atendimento" (doc 01 §72).
 *
 * Retorna `undefined` se a org não tem stages configurados (cenário só possível
 * em DB pré-seed). O caller decide se ignora ou falha.
 */
export async function findInitialStage(
  db: Database | KanbanTx,
  organizationId: string,
): Promise<KanbanStage | undefined> {
  const [row] = await (db as Database)
    .select()
    .from(kanbanStages)
    .where(eq(kanbanStages.organizationId, organizationId))
    .orderBy(asc(kanbanStages.orderIndex))
    .limit(1);
  return row;
}

/**
 * Insere um kanban_card e retorna a linha criada.
 *
 * Usado por createLead para garantir que todo lead novo tenha um card visível
 * no board. Idempotência delegada à constraint uq_kanban_cards_lead — caller
 * deve tratar 23505 como "já existe" se necessário.
 */
export async function insertCard(
  tx: KanbanTx,
  values: {
    organizationId: string;
    leadId: string;
    stageId: string;
    assigneeUserId?: string | null;
    priority?: number;
    notes?: string | null;
  },
): Promise<KanbanCard> {
  const [row] = await (tx as Database)
    .insert(kanbanCards)
    .values({
      organizationId: values.organizationId,
      leadId: values.leadId,
      stageId: values.stageId,
      assigneeUserId: values.assigneeUserId ?? null,
      priority: values.priority ?? 0,
      notes: values.notes ?? null,
    })
    .returning();

  // .returning() em insert sem ON CONFLICT garante exatamente 1 linha
  return row as KanbanCard;
}

// ---------------------------------------------------------------------------
// History (append-only)
// ---------------------------------------------------------------------------

/**
 * Insere uma entrada no histórico de transições.
 * NUNCA atualiza ou deleta linhas desta tabela.
 */
export async function insertHistory(
  tx: KanbanTx,
  entry: Omit<NewKanbanStageHistoryEntry, 'id'>,
): Promise<string> {
  const [row] = await (tx as Database)
    .insert(kanbanStageHistory)
    .values(entry)
    .returning({ id: kanbanStageHistory.id });

  // Justificativa do `as`: mesma razão acima — insert().returning() garante
  // exatamente 1 linha quando não há erro. O undefined só ocorreria se o
  // banco falhasse (exception propagada pelo Drizzle antes deste ponto).
  return (row as { id: string }).id;
}

// ---------------------------------------------------------------------------
// History — leitura (F13-S07)
// ---------------------------------------------------------------------------

export interface CardHistoryRow {
  id: string;
  cardId: string;
  fromStageId: string | null;
  toStageId: string;
  fromStageName: string | null;
  toStageName: string;
  actorName: string | null;
  metadata: Record<string, unknown>;
  transitionedAt: Date;
}

/**
 * Verifica se um card é acessível pelo ator: pertence à org E o lead do card
 * está dentro do city-scope. Retorna { id } se acessível, undefined caso
 * contrário (o service lança 404 — não vaza existência fora do escopo).
 */
export async function findCardInScope(
  db: Database,
  cardId: string,
  organizationId: string,
  userCtx: UserScopeCtx,
): Promise<{ id: string } | undefined> {
  const scopeCond = applyCityScope(userCtx, leads.cityId);
  const conditions = [
    eq(kanbanCards.id, cardId),
    eq(kanbanCards.organizationId, organizationId),
    ...(scopeCond !== undefined ? [scopeCond] : []),
  ];

  const [row] = await db
    .select({ id: kanbanCards.id })
    .from(kanbanCards)
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    .where(and(...conditions))
    .limit(1);

  return row;
}

/**
 * Histórico de transições de stage de um card (append-only), mais recentes
 * primeiro. Não aplica city-scope — o service valida o acesso via
 * findCardInScope ANTES de chamar esta função.
 *
 * Usa aliases de kanban_stages (from/to) para resolver os nomes dos stages
 * e LEFT JOIN em users para o nome do ator (null = transição automática).
 */
export async function findCardHistory(db: Database, cardId: string): Promise<CardHistoryRow[]> {
  const fromStage = alias(kanbanStages, 'from_stage');
  const toStage = alias(kanbanStages, 'to_stage');

  const rows = await db
    .select({
      id: kanbanStageHistory.id,
      cardId: kanbanStageHistory.cardId,
      fromStageId: kanbanStageHistory.fromStageId,
      toStageId: kanbanStageHistory.toStageId,
      fromStageName: fromStage.name,
      toStageName: toStage.name,
      actorName: users.fullName,
      metadata: kanbanStageHistory.metadata,
      transitionedAt: kanbanStageHistory.transitionedAt,
    })
    .from(kanbanStageHistory)
    .leftJoin(fromStage, eq(kanbanStageHistory.fromStageId, fromStage.id))
    .innerJoin(toStage, eq(kanbanStageHistory.toStageId, toStage.id))
    .leftJoin(users, eq(kanbanStageHistory.actorUserId, users.id))
    .where(eq(kanbanStageHistory.cardId, cardId))
    .orderBy(desc(kanbanStageHistory.transitionedAt));

  return rows.map((r) => ({
    id: r.id,
    cardId: r.cardId,
    fromStageId: r.fromStageId,
    toStageId: r.toStageId,
    fromStageName: r.fromStageName,
    toStageName: r.toStageName,
    actorName: r.actorName,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    transitionedAt: r.transitionedAt,
  }));
}
