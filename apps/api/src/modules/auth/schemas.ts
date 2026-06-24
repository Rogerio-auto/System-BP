// =============================================================================
// auth/schemas.ts — Re-exporta schemas públicos + define schemas internos da API.
//
// Schemas públicos (loginBodySchema, etc.) vivem em packages/shared-schemas
// para serem reutilizados pelo frontend.
//
// Schemas de resposta aqui adicionam headers/cookies não expostos ao frontend.
// =============================================================================
import { z } from 'zod';

export {
  loginBodySchema,
  refreshBodySchema,
  refreshResponseSchema,
  logoutBodySchema,
} from '@elemento/shared-schemas';

// ---------------------------------------------------------------------------
// loginResponseSchema estendido — inclui o discriminador `status`
//
// O shared-schemas não tem `status` para manter retrocompatibilidade.
// A API F8-S11 passa a retornar `status: 'ok'` junto aos campos padrão
// (additive — clientes antigos ignoram campo extra).
// ---------------------------------------------------------------------------

export const loginResponseSchema = z.object({
  status: z.literal('ok'),
  access_token: z.string(),
  expires_in: z.number().int().positive(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    full_name: z.string(),
    organization_id: z.string().uuid(),
    // Permissões RBAC carregadas pelo service via queryUserPermissions().
    // Usado pelo frontend para gating de UI (hub de Configurações, cards admin, etc.).
    permissions: z.array(z.string()),
    // Escopo de cidade: null → global (admin/gestor_geral); string[] → city-scoped.
    // Frontend usa para determinar o scope toggle em /relatorios sem heurística.
    city_scope_ids: z.array(z.string().uuid()).nullable(),
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

// ---------------------------------------------------------------------------
// Login com 2FA ativo — resposta de desafio
// ---------------------------------------------------------------------------

export const loginChallenge2faResponseSchema = z.object({
  status: z.literal('2fa_required'),
  /** Token de curta duração (5 min) para uso em POST /api/auth/verify-2fa */
  challenge_token: z.string(),
});

export type LoginChallenge2faResponse = z.infer<typeof loginChallenge2faResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/auth/verify-2fa — body
// ---------------------------------------------------------------------------

export const verify2faBodySchema = z.object({
  /** Challenge token obtido da resposta de login com 2FA */
  challengeToken: z.string().min(1, 'O token de desafio é obrigatório'),
  /** Código TOTP de 6 dígitos OU recovery code */
  code: z.string().min(1, 'O código é obrigatório').max(12, 'Código inválido'),
});

export type Verify2faBody = z.infer<typeof verify2faBodySchema>;
