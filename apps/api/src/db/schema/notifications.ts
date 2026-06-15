// =============================================================================
// notifications.ts — Notificações in-app enviadas a usuários (F15-S03).
//
// Decisão D12 (planejamento-2026-06):
//   - Notificações são armazenadas por usuário destinatário, não por role.
//   - Múltiplos canais: in_app (implementado), email e whatsapp (futuros).
//   - Preferências de canal ficam em notification_preferences (arquivo separado).
//   - entity_type/entity_id: polimorfismo — opcional, para deep-link no frontend.
//   - read_at NULL = não lida; NOT NULL = lida (sem soft-delete — notificações
//     lidas são retidas para histórico; limpeza por job de retenção LGPD).
//
// Multi-tenant:
//   - organization_id em todas as queries (escopo multi-tenant).
//   - user_id FK para users (destinatário específico).
//
// LGPD (doc 17):
//   - title/body podem conter PII indireta (nome do lead, valor de parcela).
//   - Não logar conteúdo em produção sem redact.
//   - Retenção por job: registros sem ação após período definido pelo DPO
//     devem ser apagados (§9 doc 17 — minimização de dados).
//
// Índices:
//   - (user_id, read_at): query principal — "notificações não lidas do usuário X"
//     e "histórico de notificações do usuário X ordenado por data".
//   - (organization_id, created_at DESC): listagem administrativa por org.
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Toda notificação pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Usuário destinatário da notificação.
     * FK users ON DELETE CASCADE: notificações de um usuário removido são
     * apagadas automaticamente — não faz sentido reter sem destinatário.
     */
    userId: uuid('user_id').notNull(),

    /**
     * Tipo de notificação — domínio extensível via texto livre.
     * Exemplos: 'task_assigned', 'task_due_soon', 'lead_status_changed',
     *           'payment_overdue', 'spc_inclusion_required', 'winback_ready'.
     * Mantido como texto (não enum) para facilitar extensão sem migration.
     */
    type: text('type').notNull(),

    /**
     * Título curto exibido no sino de notificações.
     * LGPD: pode conter PII indireta — não logar sem redact.
     */
    title: text('title').notNull(),

    /**
     * Corpo completo da notificação.
     * LGPD: pode conter PII indireta — não logar sem redact.
     */
    body: text('body').notNull(),

    /**
     * Tipo da entidade relacionada (polimorfismo — opcional).
     * Permite deep-link no frontend: ao clicar na notificação, navega
     * para a entidade correta.
     * Exemplos: 'task', 'lead', 'payment_due', 'credit_analysis'.
     * NULL = notificação não vinculada a entidade específica.
     */
    entityType: text('entity_type'),

    /**
     * UUID da entidade relacionada (polimorfismo — opcional).
     * Só tem sentido se entity_type estiver preenchido.
     * Sem FK rígida — entidade pode ser de qualquer tabela.
     * NULL quando entity_type é NULL.
     */
    entityId: uuid('entity_id'),

    /**
     * Timestamp de leitura da notificação pelo usuário.
     * NULL = não lida (aparece no contador de não-lidas do sino).
     * NOT NULL = lida; o timestamp pode ser usado para auditoria.
     */
    readAt: timestamp('read_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_notifications_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkUser: foreignKey({
      name: 'fk_notifications_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // -------------------------------------------------------------------------
    // Índices
    // -------------------------------------------------------------------------

    /**
     * Query principal: notificações de um usuário (lidas e não lidas).
     * Cobre: "sininho" (WHERE read_at IS NULL) e histórico (ORDER BY created_at DESC).
     * Drizzle gera B-tree composto — Postgres usa skip-scan por user_id.
     */
    idxUserReadAt: index('idx_notifications_user_read_at').on(table.userId, table.readAt),

    /**
     * Listagem administrativa: todas as notificações da org por data.
     * Suporta dashboards de auditoria e jobs de limpeza por retenção.
     */
    idxOrgCreatedAt: index('idx_notifications_org_created_at').on(
      table.organizationId,
      table.createdAt,
    ),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
