// =============================================================================
// roles/schemas.ts — Zod schemas para o módulo de roles.
//
// Rotas cobertas:
//   GET  /api/admin/permissions              — catálogo de permissões agrupado por módulo
//   GET  /api/admin/roles                    — lista roles com permissões atribuídas
//   PUT  /api/admin/roles/:id/permissions    — substituição total de permissões de um role
//
// `scope` é lido da coluna roles.scope (pgEnum role_scope, NOT NULL).
// Migration 0021 faz o backfill e garante a integridade via NOT NULL + CHECK.
// Mapeamento key→scope (doc 10 §3.1):
//   global: admin, gestor_geral
//   city:   gestor_regional, agente, operador, leitura
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Permissões — catálogo
// ---------------------------------------------------------------------------

export const permissionResponseSchema = z.object({
  key: z.string().describe("Chave da permissão no formato 'recurso:ação'"),
  description: z.string().describe('Descrição legível da permissão para administradores'),
  module: z
    .string()
    .describe('Módulo funcional ao qual a permissão pertence — usado para agrupar na UI'),
});

export type PermissionResponse = z.infer<typeof permissionResponseSchema>;

export const listPermissionsResponseSchema = z.object({
  data: z.array(permissionResponseSchema),
});

export type ListPermissionsResponse = z.infer<typeof listPermissionsResponseSchema>;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const roleScopeSchema = z.enum(['global', 'city']);

export const roleResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  scope: roleScopeSchema,
  description: z.string().nullable(),
  permissions: z
    .array(z.string())
    .describe('Chaves de permissão atribuídas a este papel, ordenadas alfabeticamente'),
});

export type RoleResponse = z.infer<typeof roleResponseSchema>;

export const listRolesResponseSchema = z.object({
  data: z.array(roleResponseSchema),
});

export type ListRolesResponse = z.infer<typeof listRolesResponseSchema>;

// ---------------------------------------------------------------------------
// PUT /api/admin/roles/:id/permissions
// ---------------------------------------------------------------------------

export const roleIdParamSchema = z.object({
  id: z.string().uuid('ID de papel inválido'),
});

export type RoleIdParam = z.infer<typeof roleIdParamSchema>;

export const updateRolePermissionsBodySchema = z.object({
  permissions: z
    .array(z.string())
    .describe(
      'Lista completa de chaves de permissão que o papel deve ter após a operação. ' +
        'Operação de substituição total — permissões não listadas são removidas.',
    ),
});

export type UpdateRolePermissionsBody = z.infer<typeof updateRolePermissionsBodySchema>;
