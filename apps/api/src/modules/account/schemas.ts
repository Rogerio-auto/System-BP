// =============================================================================
// account/schemas.ts — Zod schemas do módulo self-service (F8-S09).
//
// Rotas:
//   GET   /api/account/profile  — perfil do próprio usuário
//   PATCH /api/account/profile  — edita full_name
//   POST  /api/account/password — troca de senha
//
// LGPD (doc 17):
//   - email nunca aparece em logs (coberto por pino.redact *.email).
//   - currentPassword / newPassword cobertos por redact adicionados em app.ts.
//   - password_hash nunca serializado em nenhum schema de resposta.
//
// Política de senha (documentada — sem F1-S07 definir a sua):
//   - Mínimo 8 caracteres.
//   - Máximo 128 caracteres (proteção contra bcrypt DoS — bcrypt usa só 72 bytes).
//   - Pelo menos 1 letra e 1 dígito (política mínima razoável para contexto govtech).
//   - Sem whitespace no início/fim.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Política de senha (reutilizável)
// ---------------------------------------------------------------------------

/**
 * Validação de nova senha — política mínima govtech.
 *
 * Documentação de decisão:
 *   - F1-S07 (users/schemas.ts) não define política de senha explícita
 *     (usa senha temporária gerada internamente). Por isso definimos aqui.
 *   - Mínimo 8 chars: alinhado com NIST SP 800-63B (minimum 8 chars).
 *   - Máximo 128 chars: bcrypt trunca em 72 bytes; limitar a 128 previne
 *     tentativas de DoS via hashing de strings muito longas.
 *   - Exige pelo menos 1 letra + 1 dígito: política mínima para contexto
 *     de sistema govtech com dados sensíveis de crédito.
 *   - Sem whitespace no início/fim: evita confusão de UX.
 */
export const newPasswordSchema = z
  .string()
  .min(8, 'A nova senha deve ter pelo menos 8 caracteres')
  .max(128, 'A nova senha deve ter no máximo 128 caracteres')
  .regex(/[a-zA-Z]/, 'A nova senha deve conter pelo menos uma letra')
  .regex(/[0-9]/, 'A nova senha deve conter pelo menos um dígito')
  .refine((s) => s === s.trim(), 'A nova senha não pode começar ou terminar com espaço');

// ---------------------------------------------------------------------------
// GET /api/account/profile — response
// ---------------------------------------------------------------------------

export const profileResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  organizationId: z.string().uuid(),
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/account/profile — body + response
// ---------------------------------------------------------------------------

export const updateProfileBodySchema = z.object({
  fullName: z
    .string()
    .min(2, 'O nome deve ter pelo menos 2 caracteres')
    .max(200, 'O nome deve ter no máximo 200 caracteres')
    .trim(),
});

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

// ---------------------------------------------------------------------------
// POST /api/account/password — body
// ---------------------------------------------------------------------------

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, 'A senha atual é obrigatória'),
    newPassword: newPasswordSchema,
  })
  .refine((b) => b.currentPassword !== b.newPassword, {
    message: 'A nova senha deve ser diferente da senha atual',
    path: ['newPassword'],
  });

export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
