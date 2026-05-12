// =============================================================================
// kanbanCards.ts — Schema Drizzle para kanban_cards (F1-S13).
//
// Um kanban_card representa o estado de um lead dentro do pipeline kanban.
// Relação 1:1 com leads (UNIQUE lead_id).
//
// Colunas principais:
//   - lead_id:           FK CASCADE → leads(id). Card é excluído ao deletar lead.
//   - stage_id:          FK RESTRICT → kanban_stages(id). Stage atual do lead.
//   - assignee_user_id:  FK SET NULL → users(id). Responsável pelo card.
//   - priority:          Inteiro. 0 = normal, >0 = mais prioritário.
//   - entered_stage_at:  Quando o card entrou no stage atual (atualizado em moveCard).
//
// Multi-tenant: organization_id denormalizado para city-scope direto.
//
// Índices:
//   - (organization_id, stage_id, priority DESC): board query principal.
//   - (assignee_user_id) parcial: "cards do usuário X".
//
// LGPD: este schema não armazena PII diretamente.
//   notes pode conter texto livre — aplicar redact antes de logar.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { kanbanStages } from './kanbanStages.js';
import { leads } from './leads.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const kanbanCards = pgTable(
  'kanban_cards',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * FK multi-tenant.
     * Denormalizado aqui para permitir city-scope sem JOIN em leads.
     * ON DELETE RESTRICT: org não pode ser removida com cards ativos.
     */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Lead representado por este card. Relação 1:1.
     * ON DELETE CASCADE: excluir lead exclui o card associado.
     * UNIQUE: garante que um lead só pode estar em um card.
     */
    leadId: uuid('lead_id').notNull(),

    /**
     * Stage atual do card no pipeline.
     * ON DELETE RESTRICT: stage não pode ser removido se tiver cards.
     */
    stageId: uuid('stage_id').notNull(),

    /**
     * Usuário responsável pelo atendimento deste card.
     * null = não atribuído.
     * ON DELETE SET NULL: desativação de usuário libera cards para reatribuição.
     */
    assigneeUserId: uuid('assignee_user_id'),

    /**
     * Prioridade do card dentro do stage.
     * 0 = prioridade normal.
     * Valores maiores = mais prioritário (order DESC na query da board).
     * Usado para ordenação manual pelo gestor.
     */
    priority: integer('priority').notNull().default(0),

    /**
     * Notas livres do agente sobre o atendimento.
     *
     * LGPD — ATENÇÃO:
     *   Campo de texto livre. PODE conter PII (CPF ditado, dados pessoais, etc.).
     *   Aplicar redact antes de logar. NÃO incluir em payloads de eventos.
     */
    notes: text('notes'),

    /**
     * Timestamp de quando o card entrou no stage atual.
     * Atualizado em toda chamada de moveCard.
     * Usado para SLA/aging: "card está no stage X há N dias".
     */
    enteredStageAt: timestamp('entered_stage_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_kanban_cards_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_kanban_cards_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('cascade'),

    foreignKey({
      name: 'fk_kanban_cards_stage',
      columns: [table.stageId],
      foreignColumns: [kanbanStages.id],
    }).onDelete('restrict'),

    foreignKey({
      name: 'fk_kanban_cards_assignee',
      columns: [table.assigneeUserId],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Unique constraints
    // -------------------------------------------------------------------------

    /** 1 card por lead — garante relação 1:1. */
    uniqueIndex('uq_kanban_cards_lead').on(table.leadId),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Board query principal: cards de um stage na org, mais prioritários primeiro.
     * Suporta: "todos os cards do stage X da org Y, ordenados por prioridade".
     */
    index('idx_kanban_cards_org_stage_priority').on(
      table.organizationId,
      table.stageId,
      table.priority,
    ),

    /**
     * Cards atribuídos a um usuário.
     * Parcial: exclui cards sem assignee para manter o índice enxuto.
     */
    index('idx_kanban_cards_assignee')
      .on(table.assigneeUserId)
      .where(sql`${table.assigneeUserId} IS NOT NULL`),
  ],
);

export type KanbanCard = typeof kanbanCards.$inferSelect;
export type NewKanbanCard = typeof kanbanCards.$inferInsert;
