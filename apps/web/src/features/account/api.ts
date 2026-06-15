// =============================================================================
// features/account/api.ts — Funções de API para o módulo account (F14-S04).
//
// Inclui:
//   getProfile    → GET /api/account/profile (com requiresPersonalEmail)
//   setPersonalEmail → POST /api/account/personal-email
//
// LGPD: personalEmail é PII — nunca logar em console.
// =============================================================================

import { api } from '../../lib/api';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface AccountProfile {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  /** true quando o agente ainda não cadastrou o email pessoal e o papel exige. */
  requiresPersonalEmail: boolean;
  /** Email pessoal do agente (null enquanto não preenchido). LGPD: PII. */
  personalEmail: string | null;
}

export interface SetPersonalEmailBody {
  /** Email pessoal do agente. LGPD: PII — nunca logar. */
  personalEmail: string;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /api/account/profile
 * Retorna o perfil do usuário autenticado incluindo requiresPersonalEmail.
 */
export async function getAccountProfile(): Promise<AccountProfile> {
  return api.get<AccountProfile>('/api/account/profile');
}

/**
 * POST /api/account/personal-email
 * Cadastra ou atualiza o email pessoal do agente.
 * Após sucesso, requiresPersonalEmail passa a ser false no perfil.
 *
 * LGPD: não logar o body — pino.redact no backend cobre; o frontend também
 * não deve expor o valor em console.log/Sentry.
 */
export async function setPersonalEmail(body: SetPersonalEmailBody): Promise<AccountProfile> {
  return api.post<AccountProfile>('/api/account/personal-email', body);
}
