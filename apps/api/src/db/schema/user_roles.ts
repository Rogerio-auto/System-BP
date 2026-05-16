// =============================================================================
// user_roles.ts — Tabela de junção user ↔ role (N:M).
//
// PK composta garante que um usuário não receba o mesmo papel duas vezes.
// Alterações são auditadas via audit_logs (F1-S16) em mutações de role.
// =============================================================================
import { pgTable, uuid, primaryKey, foreignKey, index } from 'drizzle-orm/pg-core';

import { roles } from './roles';
import { users } from './users';

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.roleId] }),

    fkUser: foreignKey({
      name: 'fk_user_roles_user',
      columns: [table.userId],
      foreignColumns: [users.id],
    }).onDelete('cascade'),

    fkRole: foreignKey({
      name: 'fk_user_roles_role',
      columns: [table.roleId],
      foreignColumns: [roles.id],
    }).onDelete('restrict'),

    // B-tree em role_id para queries "quais usuários têm este papel?"
    idxRole: index('idx_user_roles_role').on(table.roleId),
  }),
);

export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
