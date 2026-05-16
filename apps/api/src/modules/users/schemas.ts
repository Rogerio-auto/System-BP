// =============================================================================
// users/schemas.ts — Zod schemas para o módulo de gestão de usuários (F1-S07).
//
// Rotas cobertas:
//   GET    /api/admin/users           — list com pagination + search
//   POST   /api/admin/users           — create
//   PATCH  /api/admin/users/:id       — update
//   POST   /api/admin/users/:id/deactivate    — soft-delete
//   POST   /api/admin/users/:id/reactivate    — reativar
//   PUT    /api/admin/users/:id/roles         — substituir roles
//   PUT    /api/admin/users/:id/city-scopes   — substituir city scopes
//
// LGPD (doc 17):
//   - password_hash, refresh_token_hash, totp_secret NUNCA aparecem nas
//     respostas (nunca incluídos nos userResponseSchema).
//   - email, full_name são PII de baixo risco mas ficam no payload de resposta
//     (necessário para UX admin) — cobertos por pino.redact em app.ts.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const userIdParamSchema = z.object({
  id: z.string().uuid('ID de usuário inválido'),
});

// ---------------------------------------------------------------------------
// List — GET /api/admin/users
// ---------------------------------------------------------------------------

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  /** Se omitido, retorna todos. Se true, retorna apenas ativos. */
  active: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

// ---------------------------------------------------------------------------
// Shared: user response (sem campos sensíveis — LGPD)
// ---------------------------------------------------------------------------

/**
 * Role embutida na resposta de usuário.
 * Inclui apenas id, key e name (label) — sem description/scope para manter
 * o payload de listagem enxuto.
 */
export const embeddedRoleSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
});

export type EmbeddedRole = z.infer<typeof embeddedRoleSchema>;

export const userResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  status: z.enum(['active', 'disabled', 'pending']),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
  /**
   * Roles do usuário. Campo adicionado em F8-S06 (retrocompatível — adição de campo).
   * Listagem usa batch-load para evitar N+1.
   */
  roles: z.array(embeddedRoleSchema),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

// ---------------------------------------------------------------------------
// Create — POST /api/admin/users
// ---------------------------------------------------------------------------

export const createUserBodySchema = z.object({
  email: z.string().email('Email inválido').max(254),
  fullName: z.string().min(2, 'Nome completo obrigatório').max(255).trim(),
  /** Opcional — padrão 'pending' no create. */
  status: z.enum(['active', 'pending']).optional().default('pending'),
  /** IDs de roles a atribuir no create. Mínimo 1. */
  roleIds: z.array(z.string().uuid()).min(1, 'Pelo menos 1 role é obrigatória'),
  /** IDs de cidades para escopo inicial. Pode ser vazio. */
  cityIds: z.array(z.string().uuid()).optional().default([]),
});

export type CreateUserBody = z.infer<typeof createUserBodySchema>;

export const createUserResponseSchema = userResponseSchema.extend({
  /** Senha temporária retornada APENAS uma vez no create. Nunca mais exposta. */
  tempPassword: z.string(),
});

export type CreateUserResponse = z.infer<typeof createUserResponseSchema>;

// ---------------------------------------------------------------------------
// Update — PATCH /api/admin/users/:id
// ---------------------------------------------------------------------------

export const updateUserBodySchema = z
  .object({
    fullName: z.string().min(2).max(255).trim().optional(),
    status: z.enum(['active', 'disabled', 'pending']).optional(),
    email: z.string().email('Email inválido').max(254).optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Pelo menos um campo deve ser fornecido para atualização',
  });

export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;

// ---------------------------------------------------------------------------
// Set Roles — PUT /api/admin/users/:id/roles
// ---------------------------------------------------------------------------

export const setRolesBodySchema = z.object({
  roleIds: z.array(z.string().uuid()).min(1, 'Pelo menos 1 role é obrigatória'),
});

export type SetRolesBody = z.infer<typeof setRolesBodySchema>;

// ---------------------------------------------------------------------------
// Set City Scopes — PUT /api/admin/users/:id/city-scopes
// ---------------------------------------------------------------------------

export const setCityScopesBodySchema = z.object({
  cityIds: z.array(z.string().uuid()),
});

export type SetCityScopesBody = z.infer<typeof setCityScopesBodySchema>;

// ---------------------------------------------------------------------------
// List response (paginada)
// ---------------------------------------------------------------------------

export const listUsersResponseSchema = z.object({
  data: z.array(userResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type ListUsersResponse = z.infer<typeof listUsersResponseSchema>;
