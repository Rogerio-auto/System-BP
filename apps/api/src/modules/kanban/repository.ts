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

import type { Database } from '../../db/client.js';
import {
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
  cityId: string;
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
    })
    .from(kanbanCards)
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    // LEFT JOIN em users para obter o nome do assignee sem descartar cards sem assignee
    .leftJoin(users, eq(kanbanCards.assigneeUserId, users.id))
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
