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
  /**
   * true quando o agente ainda não cadastrou o email pessoal e o papel exige.
   * Disparado pelo guard de 1º login no frontend (App.tsx).
   * F14-S04 D3.
   */
  requiresPersonalEmail: z
    .boolean()
    .describe('Indica que o agente deve cadastrar o email pessoal antes de usar o sistema'),
  /** Email pessoal do agente (null enquanto não preenchido). LGPD: PII. */
  personalEmail: z.string().email().nullable(),
});

export type ProfileResponse = z.infer<typeof profileResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/account/personal-email — body + response (F14-S04)
// ---------------------------------------------------------------------------

/**
 * Papéis que exigem o cadastro do email pessoal.
 * Agentes de atendimento e supervisores precisam bloquear o próprio email
 * pessoal no cadastro de leads (D3 F14-S02).
 *
 * Nota: 'admin' e 'gestor_geral' operam em nível global — por precaução
 * incluídos na lista para não deixar gap se um admin também atende leads.
 */
export const ROLES_REQUIRING_PERSONAL_EMAIL = new Set([
  'agente',
  'supervisor',
  'admin',
  'gestor_geral',
]);

export const setPersonalEmailBodySchema = z.object({
  /**
   * Email pessoal do agente (fora do domínio corporativo).
   * LGPD: PII — nunca logar (coberto por pino.redact em app.ts).
   */
  personalEmail: z
    .string()
    .email('Informe um email válido')
    .max(320, 'Email muito longo')
    .trim()
    .describe('Email pessoal do agente (ex: nome@gmail.com)'),
});

export type SetPersonalEmailBody = z.infer<typeof setPersonalEmailBodySchema>;

export const setPersonalEmailResponseSchema = z.object({
  personalEmail: z.string().email().describe('Email pessoal cadastrado'),
  requiresPersonalEmail: z.boolean().describe('Sempre false após o cadastro bem-sucedido'),
});

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

// ---------------------------------------------------------------------------
// GET /api/account/2fa/status — response
// ---------------------------------------------------------------------------

export const twoFactorStatusResponseSchema = z.object({
  /** true = 2FA ativo; false = desativado ou pendente de ativação */
  enabled: z.boolean(),
});

export type TwoFactorStatusResponse = z.infer<typeof twoFactorStatusResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/account/2fa/enroll — response
//
// Retorna o URI otpauth (para QR code) e o secret base32 (para entrada manual).
// NUNCA retorna o secret cifrado — apenas o plaintext para o usuário escanear.
// LGPD: o secret é dado ao usuário para guardar em app autenticador — é a
//   credencial dele, análogo a uma senha. Não persistir o plaintext.
// ---------------------------------------------------------------------------

export const twoFactorEnrollResponseSchema = z.object({
  /** URI otpauth:// — encodar como QR code no frontend */
  otpauthUri: z.string(),
  /** Secret base32 para entrada manual no app autenticador */
  secret: z.string(),
});

export type TwoFactorEnrollResponse = z.infer<typeof twoFactorEnrollResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/account/2fa/activate — body + response
// ---------------------------------------------------------------------------

export const twoFactorActivateBodySchema = z.object({
  /** Código TOTP de 6 dígitos gerado pelo app autenticador */
  code: z
    .string()
    .length(6, 'O código deve ter 6 dígitos')
    .regex(/^\d{6}$/, 'O código deve conter apenas dígitos'),
});

export type TwoFactorActivateBody = z.infer<typeof twoFactorActivateBodySchema>;

export const twoFactorActivateResponseSchema = z.object({
  /**
   * Recovery codes gerados na ativação — exibidos UMA ÚNICA VEZ.
   * O usuário deve guardar em local seguro.
   * LGPD: plaintext aqui é intencional — são credenciais do usuário.
   */
  recoveryCodes: z.array(z.string()),
});

export type TwoFactorActivateResponse = z.infer<typeof twoFactorActivateResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/account/2fa/disable — body
// ---------------------------------------------------------------------------

export const twoFactorDisableBodySchema = z.object({
  /**
   * Código TOTP de 6 dígitos OU recovery code.
   * Ambos são aceitos para desativar — recuperação de acesso inclusive.
   * O backend distingue o tipo pelo formato: 6 dígitos = TOTP, else = recovery code.
   */
  code: z.string().min(1, 'O código é obrigatório').max(12, 'Código inválido'),
});

export type TwoFactorDisableBody = z.infer<typeof twoFactorDisableBodySchema>;
