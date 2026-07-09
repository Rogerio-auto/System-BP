// =============================================================================
// db/schema/aiFunnelSettings.ts -- Configuracao por org do agente proativo (F25-S05).
//
// Contexto (doc 22 §7.2):
//   Limiares configuráveis por organização para o worker funnel-housekeeping:
//     stagnant_after_days: dias sem interação antes de marcar lead como estagnado.
//     abandon_after_days:  dias sem interação antes de marcar lead como abandonado.
//
// Defaults: 7 dias (estagnação) / 30 dias (abandono) -- ver doc 22 §7.2.
// PK = organization_id: 1 row por org.
// =============================================================================
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';

export const aiFunnelSettings = pgTable(
  'ai_funnel_settings',
  {
    organizationId: uuid('organization_id').primaryKey(),
    stagnantAfterDays: integer('stagnant_after_days').notNull().default(7),
    abandonAfterDays: integer('abandon_after_days').notNull().default(30),
    enabled: boolean('enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fkOrg: foreignKey({
      name: 'fk_ai_funnel_settings_organization',
      columns: [table.organizationId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    chkStagnantMin: check(
      'chk_ai_funnel_settings_stagnant_min',
      sql`${table.stagnantAfterDays} >= 1`,
    ),
    chkAbandonGtStagnant: check(
      'chk_ai_funnel_settings_abandon_gt_stagnant',
      sql`${table.abandonAfterDays} > ${table.stagnantAfterDays}`,
    ),
  }),
);

export type AiFunnelSettings = typeof aiFunnelSettings.$inferSelect;
export type NewAiFunnelSettings = typeof aiFunnelSettings.$inferInsert;
