// =============================================================================
// leadHistory.ts — Histórico append-only de eventos do lead.
//
// Registra toda mudança de estado, atribuição, simulação iniciada, etc.
// Tabela de auditoria imutável — sem updated_at (linhas nunca são alteradas).
//
// Colunas-chave:
//   - action:       nome do evento (ex: 'created', 'status_changed',
//                   'agent_assigned', 'simulation_started', 'note_added').
//   - before/after: snapshots jsonb do estado anterior e posterior.
//                   Null em 'created' (sem estado anterior).
//                   Null em ações que não alteram estado (ex: 'note_added').
//   - actor_user_id: quem executou a ação.
//                   null = ação do sistema (automação, worker, IA).
//
// Design append-only:
//   - Nunca fazer UPDATE ou DELETE nesta tabela.
//   - Se um registro foi inserido com erro, inserir um evento de correção.
//   - ON DELETE CASCADE: se o lead for deletado (hard delete em casos extremos),
//     o histórico vai junto. Soft-delete do lead preserva tudo.
//
// Sem soft-delete: o histórico é o audit trail. Deletá-lo seria LGPD-violação.
//
// LGPD: before/after podem conter PII indireta (ex: mudança de status com
// nome do agente). Não incluir CPF, telefone ou email nos snapshots.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  foreignKey,
} from 'drizzle-orm/pg-core';

import { leads } from './leads.js';
import { users } from './users.js';

export const leadHistory = pgTable(
  'lead_history',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Lead ao qual este evento pertence.
     * ON DELETE CASCADE: se o lead for hard-deleted, o histórico vai junto.
     * Na prática, leads têm soft-delete — este cascade é segurança extra.
     */
    leadId: uuid('lead_id').notNull(),

    /**
     * Nome do evento/ação registrada.
     * Exemplos: 'created', 'status_changed', 'agent_assigned',
     *           'simulation_started', 'simulation_completed',
     *           'note_added', 'document_uploaded', 'converted'.
     * Aberto (text, não enum) para permitir novos eventos sem migration.
     */
    action: text('action').notNull(),

    /**
     * Estado do lead ANTES da ação.
     * null em 'created' (não havia estado anterior).
     * Snapshot parcial — apenas os campos que mudaram.
     * LGPD: não incluir CPF, telefone bruto ou email neste snapshot.
     */
    before: jsonb('before'),

    /**
     * Estado do lead APÓS a ação.
     * null para ações que não alteram estado (ex: 'note_viewed').
     * Snapshot parcial — apenas os campos que mudaram.
     */
    after: jsonb('after'),

    /**
     * Usuário que executou a ação.
     * null = sistema/automação (worker outbox, agente IA, rotina de importação).
     * FK ON DELETE SET NULL: usuário deletado não apaga o histórico.
     */
    actorUserId: uuid('actor_user_id'),

    /**
     * Metadados adicionais do evento.
     * Exemplos: { ip_address, user_agent, correlation_id, source_event_id }.
     * Não armazenar PII bruta aqui.
     */
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),

    /**
     * Timestamp de criação do evento.
     * Imutável. Sem updated_at (tabela append-only).
     */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // -------------------------------------------------------------------------
    // Foreign Keys
    // -------------------------------------------------------------------------

    foreignKey({
      name: 'fk_lead_history_lead',
      columns: [table.leadId],
      foreignColumns: [leads.id],
    }).onDelete('cascade'),

    foreignKey({
      name: 'fk_lead_history_actor_user',
      columns: [table.actorUserId],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Timeline do lead: todos os eventos em ordem cronológica reversa.
     * Query principal: "histórico do lead X, mais recentes primeiro".
     */
    index('idx_lead_history_lead_created').on(table.leadId, table.createdAt),

    /**
     * Auditoria por usuário: "todas as ações do usuário X".
     * Parcial: exclui eventos de sistema (actor_user_id IS NULL).
     */
    index('idx_lead_history_actor').on(table.actorUserId).where(
      sql`${table.actorUserId} IS NOT NULL`,
    ),
  ],
);

export type LeadHistory = typeof leadHistory.$inferSelect;
export type NewLeadHistory = typeof leadHistory.$inferInsert;
