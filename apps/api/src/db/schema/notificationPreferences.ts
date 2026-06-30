// =============================================================================
// notificationPreferences.ts — Preferências de canal de notificação por
//                               usuário (F15-S03 + F24-S01).
//
// Decisão D12 (planejamento-2026-06):
//   - Cada usuário pode habilitar ou desabilitar cada canal de notificação.
//   - Canais: 'in_app' (sino), 'email', 'whatsapp'.
//   - enabled DEFAULT true: por padrão todos os canais ativos (opt-out).
//   - organization_id obrigatório: multi-tenant ready desde o dia 1, mesmo
//     que o filtro ainda não seja usado nas primeiras rotas.
//
// F24-S01 — Coluna category (planejamento-notificacoes.md §4.5):
//   Permite granularidade de preferência por categoria de notificação.
//   NULL = preferência genérica de canal (aplica-se a todas as categorias).
//   NOT NULL = preferência específica para a categoria (ex: 'payment', 'lead').
//   Quando a worker gera notificações, consulta na ordem:
//     1. Preferência específica (user_id, channel, category).
//     2. Preferência genérica (user_id, channel, NULL) como fallback.
//
// Constraint única (F24-S01):
//   A introdução de category (nullable) exige dois índices parciais:
//   - uq_notification_preferences_user_channel_null_cat:
//     UNIQUE (user_id, channel) WHERE category IS NULL
//     → garante 1 preferência genérica por canal por usuário.
//   - uq_notification_preferences_user_channel_cat:
//     UNIQUE (user_id, channel, category) WHERE category IS NOT NULL
//     → garante 1 preferência por canal por categoria por usuário.
//   Esta abordagem evita o problema de NULL <> NULL em índices SQL padrão
//   (PostgreSQL não considera dois NULLs como iguais em unique constraints).
//
// Sem soft-delete: preferências são flags de configuração simples; remover
// um usuário apaga suas preferências via ON DELETE CASCADE.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
     * Categoria de notificação para esta preferência (F24-S01).
     * NULL = preferência genérica de canal (fallback para todas as categorias).
     * NOT NULL = preferência específica para a categoria informada.
     * Exemplos: 'lead', 'payment', 'task', 'system'.
     * Deve corresponder a notification_rules.category para fazer sentido.
     * O worker consulta preferência específica primeiro; fallback para NULL.
     */
    category: text('category'),

    /**
     * Canal habilitado para este usuário (e categoria, se informada)?
     * true (default) = notificações por este canal/categoria ativas (opt-out model).
     * false = usuário desativou explicitamente este canal/categoria.
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
    // Unique Constraints (dois índices parciais para tratar NULL em category)
    // -------------------------------------------------------------------------

    /**
     * Preferência genérica de canal: 1 registro por (user_id, channel) sem categoria.
     * WHERE category IS NULL exclui registros com categoria preenchida.
     * Permite upsert: INSERT ... ON CONFLICT (user_id, channel) WHERE category IS NULL
     * DO UPDATE SET enabled = excluded.enabled.
     *
     * NOTA: índice real criado na migration SQL (0076) com cláusula WHERE explícita.
     * Esta declaração Drizzle serve para type-checking e documentação do schema.
     */
    uqUserChannelNullCat: uniqueIndex('uq_notification_preferences_user_channel_null_cat')
      .on(table.userId, table.channel)
      .where(sql`${table.category} IS NULL`),

    /**
     * Preferência por categoria: 1 registro por (user_id, channel, category).
     * WHERE category IS NOT NULL exclui registros sem categoria (genéricos).
     * Permite upsert: INSERT ... ON CONFLICT (user_id, channel, category) WHERE category IS NOT NULL
     * DO UPDATE SET enabled = excluded.enabled.
     *
     * NOTA: índice real criado na migration SQL (0076) com cláusula WHERE explícita.
     */
    uqUserChannelCat: uniqueIndex('uq_notification_preferences_user_channel_cat')
      .on(table.userId, table.channel, table.category)
      .where(sql`${table.category} IS NOT NULL`),
  }),
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
