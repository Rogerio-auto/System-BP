// =============================================================================
// auth.ts — Schemas Zod públicos de autenticação.
//
// Reutilizados pelo frontend (React Hook Form) e pelo backend (routes + service).
// Não inclui campos internos (password_hash, refresh_token_hash).
// LGPD: email é PII — coberto por pino.redact na API (doc 17 §8.3).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export const loginBodySchema = z.object({
  email: z
    .string({ required_error: 'Email é obrigatório' })
    .email('Email inválido')
    .max(255, 'Email muito longo'),
  password: z.string({ required_error: 'Senha é obrigatória' }).min(1, 'Senha é obrigatória'),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const loginResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    full_name: z.string(),
    organization_id: z.string().uuid(),
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

/** Body vazio — token vem no cookie httpOnly; CSRF no header. */
export const refreshBodySchema = z.object({}).strict();

export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const refreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().int().positive(),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/** Body vazio — sessão identificada pelo cookie refresh. */
export const logoutBodySchema = z.object({}).strict();

export type LogoutBody = z.infer<typeof logoutBodySchema>;
