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
  password: z
    .string({ required_error: 'Senha é obrigatória' })
    .min(1, 'Senha é obrigatória')
    // SEC-05: limite superior de 72 bytes — bcryptjs ignora bytes além de 72,
    // o que abre DoS via entradas longas que bloqueiam o event loop (pré-auth, anônimo).
    .max(72, 'Senha inválida'),
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
    /**
     * Permissões RBAC do usuário consolidadas no momento da resposta.
     * Carregadas via JOIN entre `user_roles`, `role_permissions` e `permissions`.
     * O frontend usa para gating de UI (ex.: hub de Configurações).
     * O backend usa `request.user.permissions` carregado pelo middleware `authenticate()`
     * em cada request — a lista aqui é snapshot, não fonte de verdade.
     */
    permissions: z.array(z.string()),
    /**
     * Escopo de cidade do usuário:
     *   null     → admin/gestor_geral — acesso global (sem filtro de cidade).
     *   string[] → UUIDs das cidades permitidas (gestor_regional/agente).
     *   []       → sem cidade configurada (sem acesso a dados de nenhuma cidade).
     *
     * O frontend usa para determinar o scope toggle em /relatorios e evitar
     * mostrar opção "Consolidado/global" para quem não tem acesso global.
     * O backend NUNCA confia neste campo para autorização — usa request.user.cityScopeIds
     * carregado pelo middleware authenticate() via DB.
     */
    city_scope_ids: z.array(z.string().uuid()).nullable(),
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
  // user retornado no refresh para rehidratar o store do SPA após reload —
  // o access_token vive só em memória, o cookie persiste no browser.
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    full_name: z.string(),
    organization_id: z.string().uuid(),
    // Permissões RBAC ressincronizadas no refresh — garante que mudanças de role
    // aplicadas após o login original sejam refletidas ao recarregar o SPA.
    permissions: z.array(z.string()),
    /**
     * Escopo de cidade ressincronizado no refresh — reflete mudanças de escopo
     * aplicadas após o login original (ex: gestor_regional recebe nova cidade).
     * Mesma semântica de loginResponseSchema.user.city_scope_ids.
     */
    city_scope_ids: z.array(z.string().uuid()).nullable(),
  }),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/** Body vazio — sessão identificada pelo cookie refresh. */
export const logoutBodySchema = z.object({}).strict();

export type LogoutBody = z.infer<typeof logoutBodySchema>;
