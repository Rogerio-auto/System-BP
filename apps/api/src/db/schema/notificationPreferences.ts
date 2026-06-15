// =============================================================================
// notificationPreferences.ts — Preferências de canal de notificação por
//                               usuário (F15-S03).
//
// Decisão D12 (planejamento-2026-06):
//   - Cada usuário pode habilitar ou desabilitar cada canal de notificação.
//   - Canais: 'in_app' (sino), 'email', 'whatsapp'.
//   - enabled DEFAULT true: por padrão todos os canais ativos (opt-out).
//   - UNIQUE (user_id, channel): um registro por canal por usuário — upsert
//     seguro via ON CONFLICT DO UPDATE.
//   - organization_id obrigatório: multi-tenant ready desde o dia 1, mesmo
//     que o filtro ainda não seja usado nas primeiras rotas.
//
// Constraint única:
//   - (user_id, channel) — garantia de 1 preferência por canal por usuário.
//
// Sem soft-delete: preferências são simples flags de configuração; remover
// um usuário apaga suas preferências via ON DELETE CASCADE.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Multi-tenant root. Preferência pertence à organização do usuário. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Usuário dono desta preferência.
     * FK users ON DELETE CASCADE: preferências removidas junto com o usuário.
     */
    userId: uuid('user_id').notNull(),

    /**
     * Canal de entrega da notificação.
     * 'in_app'    — sino/badge no sistema web (implementado em F15).
     * 'email'     — email transacional (futuro, fase pós-MVP).
     * 'whatsapp'  — mensagem WhatsApp (futuro, integração F5).
     */
    channel: text('channel', {
      enum: ['in_app', 'email', 'whatsapp'],
    }).notNull(),

    /**
     * Canal habilitado para este usuário?
     * true (default) = notificações por este canal ativas (opt-out model).
     * false = usuário desativou este canal.
     */
    enabled: boolean('enabled').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // -------------------------------------------------------------------------
    // Foreign Keys (nomeadas explicitamente)
    // -------------------------------------------------------------------------

    fkOrg: foreignKey({
      name: 'fk_notification_preferences_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('restrict'),

    fkUser: foreignKey({
      name: 'fk_notification_preferences_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    // -------------------------------------------------------------------------
    // Unique Constraint
    // -------------------------------------------------------------------------

    /**
     * Um registro de preferência por canal por usuário.
     * Permite upsert idempotente: INSERT ... ON CONFLICT (user_id, channel)
     * DO UPDATE SET enabled = excluded.enabled.
     * Não é parcial (sem soft-delete em preferências).
     */
    uqUserChannel: uniqueIndex('uq_notification_preferences_user_channel').on(
      table.userId,
      table.channel,
    ),
  }),
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
