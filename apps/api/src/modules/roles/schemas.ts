// =============================================================================
// roles/schemas.ts — Zod schemas para o módulo de roles (F8-S07).
//
// Rotas cobertas:
//   GET /api/admin/roles  — lista roles disponíveis da organização
//
// `scope` é lido da coluna roles.scope (pgEnum role_scope, NOT NULL).
// Migration 0021 faz o backfill e garante a integridade via NOT NULL + CHECK.
// Mapeamento key→scope (doc 10 §3.1):
//   global: admin, gestor_geral
//   city:   gestor_regional, agente, operador, leitura
// =============================================================================
import { z } from 'zod';

export const roleScopeSchema = z.enum(['global', 'city']);

export const roleResponseSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  scope: roleScopeSchema,
  description: z.string().nullable(),
});

export type RoleResponse = z.infer<typeof roleResponseSchema>;

export const listRolesResponseSchema = z.object({
  data: z.array(roleResponseSchema),
});

export type ListRolesResponse = z.infer<typeof listRolesResponseSchema>;
