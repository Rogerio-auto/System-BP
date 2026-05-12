// =============================================================================
// kanban/repository.ts — Queries Drizzle para o módulo kanban (F1-S13).
//
// City-scope: o escopo de cidade é verificado via lead.city_id.
// O service valida organizationId em ambas as entidades antes de chamar aqui.
//
// Imutabilidade de kanban_stage_history: este módulo expõe apenas
// insertHistory() — nunca update ou delete. Ver kanbanStageHistory.ts.
// =============================================================================
import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { kanbanCards, kanbanStages, kanbanStageHistory } from '../../db/schema/index.js';
import type { KanbanCard, KanbanStage, NewKanbanStageHistoryEntry } from '../../db/schema/index.js';

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
