// =============================================================================
// kanbanStages.ts — Schema Drizzle para kanban_stages (F1-S13 / F25-S01).
//
// Cada organização define seu próprio pipeline kanban com stages ordenados.
// Um stage pode ser terminal (won ou lost), sinalizando fim do ciclo de vida
// do lead naquele pipeline.
//
// Invariantes críticas:
//   1. Um stage NÃO pode ser simultaneamente terminal_won E terminal_lost.
//      Verificada via check constraint chk_kanban_stages_terminal_exclusive.
//   2. canonical_role é nullable (stages custom de orgs futuras não precisam
//      ter papel canônico mapeado). Quando presente, deve ser um dos valores
//      do enum textual abaixo — verificado via chk_kanban_stages_canonical_role.
//
// canonical_role — papel canônico no funil do agente (F25-S01):
//   Define a identidade de cada stage no mapa de estados da máquina de estados
//   do agente de crédito (doc 22 §3.3). Permite que workers e a IA tomem
//   decisões baseadas em papel semântico em vez de orderIndex mágico.
//
//   Valores:
//     pre_atendimento   — Lead em pré-atendimento (IA ainda coletando dados).
//     simulacao         — Aguardando ou em simulação de crédito.
//     documentacao      — Documentação solicitada / em coleta.
//     analise_credito   — Análise de crédito em andamento.
//     concluido_ganho   — Desfecho positivo: lead convertido em cliente.
//     concluido_perdido — Desfecho negativo: lead perdido / recusado.
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

// ---------------------------------------------------------------------------
// Enum textual para canonical_role (F25-S01)
// Exportado para que workers/services possam usar sem hardcode de string.
// ---------------------------------------------------------------------------

export const KANBAN_CANONICAL_ROLES = [
  'pre_atendimento',
  'simulacao',
  'documentacao',
  'analise_credito',
  'concluido_ganho',
  'concluido_perdido',
] as const;

/** Role canônica de um stage no mapa de estados do agente (doc 22 §3.3). */
export type KanbanCanonicalRole = (typeof KANBAN_CANONICAL_ROLES)[number];

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

    /**
     * Papel canônico do stage no mapa de estados do agente de crédito (F25-S01).
     *
     * Nullable: stages customizados de organizações futuras não precisam ter
     * papel canônico mapeado (a IA simplesmente não age sobre eles de forma
     * determinística nesse caso).
     *
     * Quando presente, o valor DEVE ser um dos definidos em KANBAN_CANONICAL_ROLES.
     * Verificado via check constraint chk_kanban_stages_canonical_role.
     *
     * Backfill dos stages do Banco do Povo via 0078_funnel_state_machine.sql:
     *   orderIndex 0 → pre_atendimento
     *   orderIndex 1 → simulacao
     *   orderIndex 2 → documentacao
     *   orderIndex 3 → analise_credito
     *   is_terminal_won  → concluido_ganho
     *   is_terminal_lost → concluido_perdido
     */
    canonicalRole: text('canonical_role'),

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

    /**
     * canonical_role deve ser NULL ou um dos valores do enum textual definido
     * em KANBAN_CANONICAL_ROLES. Garante integridade do mapa de estados do agente.
     */
    chkCanonicalRole: check(
      'chk_kanban_stages_canonical_role',
      sql`${table.canonicalRole} IS NULL OR ${table.canonicalRole} IN (
        'pre_atendimento',
        'simulacao',
        'documentacao',
        'analise_credito',
        'concluido_ganho',
        'concluido_perdido'
      )`,
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

    /**
     * Lookup de stage por papel canônico dentro de uma organização.
     * Usado pelos workers (F25-S03) para resolver stage_id a partir do
     * canonical_role sem varrer todos os stages da org.
     * Partial sobre IS NOT NULL é desnecessário aqui: o índice inclui
     * NULLs, que nunca serão buscados com valor específico.
     */
    idxOrgCanonicalRole: index('idx_kanban_stages_org_canonical_role').on(
      table.organizationId,
      table.canonicalRole,
    ),
  }),
);

export type KanbanStage = typeof kanbanStages.$inferSelect;
export type NewKanbanStage = typeof kanbanStages.$inferInsert;
