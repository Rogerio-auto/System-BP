// =============================================================================
// kanbanStageHistory.ts — Schema Drizzle para kanban_stage_history (F1-S13).
//
// Tabela append-only: cada linha registra uma transição de stage de um card.
// NUNCA deve ser atualizada ou deletada por código de aplicação.
//
// Decisão de design — imutabilidade garantida em camada de aplicação:
//   Não implementamos trigger PostgreSQL nem regra DENY UPDATE/DELETE nesta migration
//   para manter o schema portável e testável sem dependência de PL/pgSQL.
//   A imutabilidade é garantida por:
//     1. O service só usa insertHistory() — sem updateHistory() ou deleteHistory().
//     2. O repository expõe apenas insert e select (nunca update/delete).
//     3. Esta decisão está documentada aqui e nos testes (service.test.ts).
//   Alternativa rejeitada: trigger BEFORE UPDATE/DELETE com RAISE EXCEPTION —
//   aumentaria a carga cognitiva de manutenção e dificultaria fixtures de teste.
//
// Colunas:
//   - from_stage_id: NULL na entrada inicial (card criado diretamente no stage).
//   - metadata:      jsonb livre para context adicional (ex: { reason: 'manual' }).
//
// LGPD: nenhuma PII direta. actor_user_id é UUID opaco.
//       metadata NÃO deve conter PII bruta — usar IDs.
// =============================================================================
import { sql } from 'drizzle-orm';
import { foreignKey, index, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { kanbanCards } from './kanbanCards.js';
import { kanbanStages } from './kanbanStages.js';
import { users } from './users.js';

export const kanbanStageHistory = pgTable(
  'kanban_stage_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Card que realizou esta transição.
     * ON DELETE CASCADE: excluir card limpa o histórico associado.
     */
    cardId: uuid('card_id').notNull(),

    /**
     * Stage de origem da transição.
     * NULL indica criação inicial do card (não há stage anterior).
     * ON DELETE RESTRICT: stage não pode ser removido se há histórico referenciando-o.
     */
    fromStageId: uuid('from_stage_id'),

    /**
     * Stage de destino da transição.
     * Nunca nulo — toda transição registrada tem um destino.
     * ON DELETE RESTRICT: stage não pode ser removido se há histórico referenciando-o.
     */
    toStageId: uuid('to_stage_id').notNull(),

    /**
     * Usuário que realizou a transição.
     * null = transição automática por sistema/worker.
     * ON DELETE SET NULL: desativação de usuário preserva histórico.
     */
    actorUserId: uuid('actor_user_id'),

    /**
     * Timestamp exato da transição.
     * Imutável após inserção — não usar defaultNow() em updates.
     */
    transitionedAt: timestamp('transitioned_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Metadados extras da transição.
     * Exemplos: { reason: 'manual', source: 'api', note: 'reagendado' }
     *
     * LGPD: não incluir PII bruta. Usar IDs ou categorias.
     */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_kanban_stage_history_card',
      columns: [table.cardId],
      foreignColumns: [kanbanCards.id],
    }).onDelete('cascade'),

    foreignKey({
      name: 'fk_kanban_stage_history_from_stage',
      columns: [table.fromStageId],
      foreignColumns: [kanbanStages.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_kanban_stage_history_to_stage',
      columns: [table.toStageId],
      foreignColumns: [kanbanStages.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_kanban_stage_history_actor',
      columns: [table.actorUserId],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Timeline do card: transições mais recentes primeiro.
     * Query principal: "histórico do card X".
     */
    index('idx_kanban_stage_history_card_time').on(table.cardId, table.transitionedAt),

    /**
     * Análise de funil por stage de destino.
     * Query: "quantas transições chegaram ao stage Y?".
     */
    index('idx_kanban_stage_history_to_stage').on(table.toStageId),
  ],
);

export type KanbanStageHistoryEntry = typeof kanbanStageHistory.$inferSelect;
export type NewKanbanStageHistoryEntry = typeof kanbanStageHistory.$inferInsert;
