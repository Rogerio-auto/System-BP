// =============================================================================
// role_permissions.ts — Tabela de junção role ↔ permission (N:M).
//
// PK composta (role_id, permission_id) evita duplicatas sem índice extra.
// Modificações via seed + admin UI, nunca diretamente em produção sem migration.
// =============================================================================
import { pgTable, uuid, primaryKey, foreignKey, index } from 'drizzle-orm/pg-core';

import { permissions } from './permissions';
import { roles } from './roles';

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    permissionId: uuid('permission_id').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.roleId, table.permissionId] }),

    fkRole: foreignKey({
      name: 'fk_role_permissions_role',
      columns: [table.roleId],
      foreignColumns: [roles.id],
    }).onDelete('cascade'),

    fkPermission: foreignKey({
      name: 'fk_role_permissions_permission',
      columns: [table.permissionId],
      foreignColumns: [permissions.id],
    }).onDelete('cascade'),

    // B-tree em permission_id para queries "quais roles têm esta permissão?"
    idxPermission: index('idx_role_permissions_permission').on(table.permissionId),
  }),
);

export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
