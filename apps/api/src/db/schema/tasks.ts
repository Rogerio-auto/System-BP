// =============================================================================
// tasks.ts — Tarefas atribuídas a roles dentro de cidades (F15-S03).
//
// Uma tarefa representa uma ação pendente que deve ser executada por um
// usuário com determinado papel (assignee_role) dentro de uma cidade.
//
// Decisão D14 (planejamento-2026-06):
//   - Atribuição por role key (texto), não por user_id direto — qualquer
//     usuário com o papel certo na cidade alvo pode "reclamar" a tarefa.
//   - city_id NULL = tarefa global (válida para todas as cidades da org).
//   - O campo claimed_by registra qual usuário específico assumiu a tarefa.
//
// Colunas-chave:
//   - assignee_role:  role key canônica (doc 10 §3.1) — sem FK rígida para
//                     evitar acoplamento; validação na borda Zod.
//   - city_id:        FK cities NULLABLE — NULL = tarefa global.
//   - type:           domínio fechado de tipos de tarefa do sistema.
//   - entity_type:    polimorfismo — identifica a entidade relacionada.
//   - entity_id:      UUID da entidade referenciada (sem FK rígida — entidade
//                     pode ser de qualquer tabela de acordo com entity_type).
//   - status:         ciclo de vida da tarefa (open → done | cancelled).
//   - claimed_by:     usuário que assumiu a tarefa (FK users ON DELETE SET NULL).
//   - claimed_at:     quando a tarefa foi reclamada.
//   - completed_by:   usuário que completou ou cancelou.
//   - completed_at:   timestamp de conclusão/cancelamento.
//
// Multi-tenant:
//   - organization_id em todas as queries; escopo de cidade via city_id.
//
// Índices:
//   - (organization_id, assignee_role, city_id, status): query principal da
//     fila de tarefas por role + cidade.
//   - Parcial WHERE status = 'open': mantém o índice enxuto (maioria das
//     queries de fila interessa apenas tarefas abertas).
//   - (organization_id, entity_type, entity_id): lookup de tarefas de uma
//     entidade específica (ex: todas as tarefas do lead X).
//   - (claimed_by) parcial WHERE claimed_by IS NOT NULL: tarefas assumidas
//     por usuário (dashboard pessoal).
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';

import { cities } from './cities.js';
import { organizations } from './organizations.js';
import { users } from './users.js';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Toda tarefa pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Role key canônica do destinatário (doc 10 §3.1).
     * Valores esperados: 'admin' | 'gestor_geral' | 'gestor_regional' |
     *                    'agente' | 'operador' | 'leitura'.
     * Sem FK rígida — role keys são texto imutável; validação na borda Zod.
     * Permite que qualquer usuário com esse papel na cidade alvo assuma a tarefa.
     */
    assigneeRole: text('assignee_role').notNull(),

    /**
     * Cidade onde a tarefa deve ser executada.
     * FK cities ON DELETE RESTRICT: cidade não pode ser removida com tarefas.
     * NULL = tarefa global (válida para todas as cidades da organização).
     * Ex: uma tarefa de inclusão SPC específica de Porto Velho tem city_id preenchido.
     *     Uma tarefa administrativa global tem city_id NULL.
     */
    cityId: uuid('city_id'),

    /**
     * Tipo de tarefa — domínio fechado.
     * 'spc_inclusion'  — incluir cliente no SPC/Serasa.
     * 'spc_removal'    — remover cliente do SPC/Serasa.
     * 'winback'        — campanha de reativação de cliente inativo.
     * 'lawyer_handoff' — encaminhar caso para advocacia.
     * 'custom'         — tarefa manual, título livre.
     */
    type: text('type', {
      enum: ['spc_inclusion', 'spc_removal', 'winback', 'lawyer_handoff', 'custom'],
    }).notNull(),

    /**
     * Tipo da entidade relacionada (polimorfismo).
     * Exemplos: 'lead', 'customer', 'credit_analysis', 'payment_due'.
     * Sem FK rígida — permite referenciar qualquer tabela de domínio.
     * NULL = tarefa não vinculada a uma entidade específica.
     */
    entityType: text('entity_type'),

    /**
     * UUID da entidade relacionada (polimorfismo).
     * Só tem sentido se entity_type estiver preenchido.
     * Sem FK rígida — entidade pode ser de qualquer tabela conforme entity_type.
     * NULL quando entity_type é NULL.
     */
    entityId: uuid('entity_id'),

    /**
     * Título curto da tarefa (obrigatório, exibido em listagem).
     * Para type != 'custom', pode ser gerado automaticamente pelo sistema.
     * Para type = 'custom', preenchido pelo usuário criador.
     */
    title: text('title').notNull(),

    /**
     * Descrição detalhada opcional da tarefa.
     * Contexto adicional, instruções ou links úteis para o executor.
     */
    description: text('description'),

    /**
     * Data/hora limite para execução da tarefa.
     * NULL = sem prazo definido.
     * Usado para ordenação de urgência e alertas de vencimento.
     */
    dueAt: timestamp('due_at', { withTimezone: true }),

    /**
     * Status do ciclo de vida da tarefa.
     * 'open'      — aguardando execução (default).
     * 'done'      — concluída com sucesso.
     * 'cancelled' — cancelada (não será executada).
     */
    status: text('status', {
      enum: ['open', 'done', 'cancelled'],
    })
      .notNull()
      .default('open'),

    /**
     * Usuário que assumiu a responsabilidade pela tarefa.
     * FK users ON DELETE SET NULL: usuário deletado libera a tarefa para
     * que outro usuário com o mesmo role possa reclamá-la.
     * NULL = tarefa ainda não reclamada por ninguém.
     */
    claimedBy: uuid('claimed_by'),

    /**
     * Timestamp de quando a tarefa foi reclamada por claimed_by.
     * NULL se claimed_by for NULL.
     */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),

    /**
     * Usuário que concluiu ou cancelou a tarefa.
     * FK users ON DELETE SET NULL: preserva o registro mesmo que o usuário
     * seja removido — o campo fica NULL mas a tarefa não é perdida.
     * NULL enquanto status = 'open'.
     */
    completedBy: uuid('completed_by'),

    /**
     * Timestamp de conclusão ou cancelamento da tarefa.
     * NULL enquanto status = 'open'.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_tasks_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkCity: foreignKey({
      name: 'fk_tasks_city',
      columns: [table.cityId],
      foreignColumns: [cities.id],
    }).onDelete('restrict'),

    fkClaimedBy: foreignKey({
      name: 'fk_tasks_claimed_by',
      columns: [table.claimedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    fkCompletedBy: foreignKey({
      name: 'fk_tasks_completed_by',
      columns: [table.completedBy],
      foreignColumns: [users.id],
    }).onDelete('set null'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Fila principal de tarefas: por org + role + cidade + status.
     * Suporta queries: "todas as tarefas 'open' para 'agente' em Porto Velho".
     * Cobre tanto tarefas com cidade (city_id NOT NULL) quanto globais (NULL).
     */
    idxOrgRoleCityStatus: index('idx_tasks_org_role_city_status').on(
      table.organizationId,
      table.assigneeRole,
      table.cityId,
      table.status,
    ),

    /**
     * Fila de tarefas abertas: subconjunto do índice acima, mais enxuto.
     * Parcial WHERE status = 'open' — índice dedicado para o caso mais comum
     * (listagem da fila de trabalho), sem carregar registros done/cancelled.
     */
    idxOrgRoleCityOpen: index('idx_tasks_org_role_city_open')
      .on(table.organizationId, table.assigneeRole, table.cityId)
      .where(sql`${table.status} = 'open'`),

    /**
     * Lookup de tarefas por entidade relacionada.
     * Suporta queries: "todas as tarefas do lead X" ou "tarefas da análise Y".
     * Parcial: exclui tarefas sem entidade (entity_type IS NOT NULL).
     */
    idxEntity: index('idx_tasks_entity')
      .on(table.organizationId, table.entityType, table.entityId)
      .where(sql`${table.entityType} IS NOT NULL`),

    /**
     * Dashboard pessoal: tarefas reclamadas por um usuário específico.
     * Parcial: somente registros com claimed_by preenchido.
     */
    idxClaimedBy: index('idx_tasks_claimed_by')
      .on(table.claimedBy)
      .where(sql`${table.claimedBy} IS NOT NULL`),
  }),
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
