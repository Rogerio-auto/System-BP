// =============================================================================
// roles/schemas.ts — Zod schemas para o módulo de roles (F8-S06).
//
// Rotas cobertas:
//   GET /api/admin/roles  — lista roles disponíveis da organização
//
// Nota: o campo `scope` é derivado em código a partir do `key` da role —
// não existe coluna `scope` no banco. Regra em roleKeyToScope() no service.
// Keys globais (doc 10 §3.1): admin, gestor_geral.
// Keys de cidade: gestor_regional, agente, operador, leitura.
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
