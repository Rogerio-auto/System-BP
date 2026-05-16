// =============================================================================
// permissions.ts — Catálogo declarativo de permissões granulares.
//
// As permissões são definidas em código (seed) e referenciadas por chave
// em todo o código de autorização. Não criar permissões em runtime —
// toda nova permissão exige migration + seed update + revisão de código.
//
// Keys canônicas (doc 10 §3.2 — espelho do seed base + migrations de permissões):
//   leads:read, leads:write, leads:merge, leads:transfer
//   customers:read, customers:write
//   kanban:move, kanban:revert, kanban:set_outcome
//   simulations:create, simulations:read       [seed base + 0018]
//   analyses:read, analyses:write, analyses:approve, analyses:import
//   imports:run, imports:cancel
//   cities:manage, agents:manage, users:manage
//   flags:manage, flags:read
//   audit:read
//   dashboard:read, dashboard:read_by_agent    [seed base + 0020]
//   assistant:query, assistant:confirm_actions
//   followup:manage, collection:manage
//   credit_products:read, credit_products:write [0017 — atribuídas a admin]
//   dlq:manage                                  [dlq.routes.ts — atribuída a admin via seed manual]
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * Chave de negócio no formato 'recurso:ação'.
     * Imutável — alterar quebra verificações de autorização sem migration.
     */
    key: text('key').notNull(),

    /** Descrição legível para tela de administração de permissões. */
    description: text('description').notNull(),
  },
  (table) => [uniqueIndex('uq_permissions_key').on(table.key)],
);

export type Permission = typeof permissions.$inferSelect;
export type NewPermission = typeof permissions.$inferInsert;
