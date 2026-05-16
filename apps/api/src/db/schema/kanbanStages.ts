// =============================================================================
// kanbanStages.ts — Schema Drizzle para kanban_stages (F1-S13).
//
// Cada organização define seu próprio pipeline kanban com stages ordenados.
// Um stage pode ser terminal (won ou lost), sinalizando fim do ciclo de vida
// do lead naquele pipeline.
//
// Invariante crítica:
//   Um stage NÃO pode ser simultaneamente terminal_won E terminal_lost.
//   Verificada via check constraint chk_kanban_stages_terminal_exclusive.
//
// Multi-tenant: organization_id em toda linha.
// Uniqueness:
//   - (organization_id, name): não pode ter dois stages com o mesmo nome na org.
//   - (organization_id, order_index): posição única por org (sem gaps nem duplicatas).
//
// Cor: hex do Design System (ex: '#3B82F6'). null = usa cor default da UI.
//
// LGPD: esta tabela não contém PII. Sem restrições de redact.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';

export const kanbanStages = pgTable(
  'kanban_stages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Organização proprietária do stage.
     * ON DELETE RESTRICT: não permite remover org com stages ativos.
     */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Nome do stage exibido na interface.
     * Único por organização — ver uniqueIndex abaixo.
     */
    name: text('name').notNull(),

    /**
     * Posição do stage na board (0-based, crescente da esquerda para direita).
     * Único por organização — evita colisão de posições.
     * A aplicação deve reorganizar order_index ao inserir/remover/reordenar.
     */
    orderIndex: integer('order_index').notNull(),

    /**
     * Cor hex do DS para identificação visual do stage na board.
     * Exemplo: '#3B82F6' (azul), '#22C55E' (verde), '#EF4444' (vermelho).
     * null = UI usa cor default do theme.
     */
    color: text('color'),

    /**
     * Indica que este stage representa um desfecho positivo (lead convertido).
     * Quando true, moveCard para cá deve criar/atualizar customer.
     * Exatamente um stage won por org (recomendado, não obrigatório via constraint).
     * NÃO pode ser true ao mesmo tempo que is_terminal_lost.
     */
    isTerminalWon: boolean('is_terminal_won').notNull().default(false),

    /**
     * Indica que este stage representa um desfecho negativo (lead perdido).
     * Quando true, o lead é arquivado sem conversão.
     * NÃO pode ser true ao mesmo tempo que is_terminal_won.
     */
    isTerminalLost: boolean('is_terminal_lost').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_kanban_stages_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    // -------------------------------------------------------------------------
    // Check Constraints
    // -------------------------------------------------------------------------

    /**
     * Um stage não pode ser ao mesmo tempo won e lost.
     * Violação indicaria inconsistência na configuração do pipeline.
     */
    chkTerminalExclusive: check(
      'chk_kanban_stages_terminal_exclusive',
      sql`NOT (${table.isTerminalWon} AND ${table.isTerminalLost})`,
    ),

    // -------------------------------------------------------------------------
    // Unique constraints
    // -------------------------------------------------------------------------

    /** Nome único por organização. */
    uqOrgName: uniqueIndex('uq_kanban_stages_org_name').on(table.organizationId, table.name),

    /** Posição única por organização — sem colisão de order_index. */
    uqOrgOrder: uniqueIndex('uq_kanban_stages_org_order').on(
      table.organizationId,
      table.orderIndex,
    ),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /** Listagem dos stages de uma org na ordem correta. */
    idxOrgOrder: index('idx_kanban_stages_org_order').on(table.organizationId, table.orderIndex),
  }),
);

export type KanbanStage = typeof kanbanStages.$inferSelect;
export type NewKanbanStage = typeof kanbanStages.$inferInsert;
