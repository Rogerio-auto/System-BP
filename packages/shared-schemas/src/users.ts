// =============================================================================
// users.ts — Schemas Zod públicos do domínio de usuários internos.
//
// Usuários = funcionários do Banco do Povo (agentes, supervisores, admins).
// Não confundir com leads/clientes do banco.
//
// Expõe apenas campos seguros para o frontend — sem password_hash, totp_secret.
//
// LGPD (doc 17 §8.1):
//   email e personal_email são PII — cobertos por pino.redact na API.
//   Nunca logar sem redact. Titular (agente) pode solicitar eliminação (art. 18 VI).
//
// Adicionado em F18-S08: personal_email no schema de resposta de perfil.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const UserStatusSchema = z.enum(['active', 'disabled', 'pending'], {
  errorMap: () => ({ message: 'status de usuário inválido' }),
});
export type UserStatus = z.infer<typeof UserStatusSchema>;

// ---------------------------------------------------------------------------
// Response (perfil — GET /api/account/profile ou GET /api/users/:id)
// ---------------------------------------------------------------------------

export const UserProfileResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),

  /** Email corporativo do agente. LGPD: PII. */
  email: z.string().email(),

  full_name: z.string(),
  status: UserStatusSchema,

  /**
   * Email pessoal do agente (F14-S04 D3 / F18-S08).
   * Cobrado no 1º login quando null — o modal bloqueante é ativado quando
   * requires_personal_email = true.
   * Adicionado à blocklist de lead-email: não é possível cadastrar um lead
   * usando o email pessoal de um agente da mesma organização.
   * LGPD: PII — nunca logar sem redact (pino.redact em app.ts).
   * null = agente ainda não preencheu o email pessoal.
   */
  personal_email: z.string().email().nullable(),

  /**
   * Flag calculada pelo backend: true quando personal_email é null
   * e o papel do agente exige preenchimento (agentes de atendimento).
   * O frontend usa para ativar o modal bloqueante no 1º login.
   */
  requires_personal_email: z.boolean(),

  /** 2FA ativo (totp_confirmed_at IS NOT NULL). */
  totp_enabled: z.boolean(),

  last_login_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;

// ---------------------------------------------------------------------------
// Update de perfil (PATCH /api/account/profile)
// ---------------------------------------------------------------------------

export const UserProfileUpdateSchema = z.object({
  full_name: z.string().min(1).max(255).optional(),

  /**
   * Email pessoal para preenchimento no modal do 1º login.
   * Também pode ser atualizado via perfil.
   * LGPD: PII — mesma política que email corporativo.
   */
  personal_email: z.string().email('Email pessoal inválido').max(255).optional().nullable(),
});

export type UserProfileUpdate = z.infer<typeof UserProfileUpdateSchema>;

// ---------------------------------------------------------------------------
// Lista de usuários (GET /api/users — para admins)
// ---------------------------------------------------------------------------

export const UserListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string(),
  status: UserStatusSchema,
  /** true quando o agente ainda não preencheu personal_email. */
  requires_personal_email: z.boolean(),
  totp_enabled: z.boolean(),
  last_login_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type UserListItem = z.infer<typeof UserListItemSchema>;

export const UserListResponseSchema = z.object({
  data: z.array(UserListItemSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type UserListResponse = z.infer<typeof UserListResponseSchema>;

// ---------------------------------------------------------------------------
// Create de usuário (POST /api/users — para admins)
// ---------------------------------------------------------------------------

export const UserCreateSchema = z.object({
  email: z.string({ required_error: 'Email é obrigatório' }).email('Email inválido').max(255),
  full_name: z.string({ required_error: 'Nome é obrigatório' }).min(1).max(255),
  password: z
    .string({ required_error: 'Senha é obrigatória' })
    .min(8, 'Senha deve ter pelo menos 8 caracteres')
    .max(128),
  status: UserStatusSchema.optional().default('pending'),
});

export type UserCreate = z.infer<typeof UserCreateSchema>;
