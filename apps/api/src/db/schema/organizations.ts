// =============================================================================
// organizations.ts — Tabela multi-tenant raiz.
//
// No MVP existe exatamente 1 organização (Banco do Povo / SEDEC-RO).
// Toda tabela de domínio carrega organization_id desde o início.
// settings armazena configurações livres (DPO, feature toggles, etc.)
// =============================================================================
import { sql } from 'drizzle-orm';
import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),

  /** Slug URL-safe único. Ex: "bdp-rondonia". */
  slug: text('slug').notNull().unique(),

  /** Nome exibido na UI. */
  name: text('name').notNull(),

  /**
   * Configurações livres da organização (DPO, integrações, feature overrides).
   * Schema aberto — evoluir sem migration para metadados não críticos.
   */
  settings: jsonb('settings')
    .notNull()
    .default(sql`'{}'::jsonb`),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
