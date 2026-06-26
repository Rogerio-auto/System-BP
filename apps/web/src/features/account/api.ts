// =============================================================================
// features/account/api.ts — Funções de API para o módulo account (F14-S04).
//
// Inclui:
//   getProfile          → GET /api/account/profile (com requiresPersonalEmail)
//   setPersonalEmail    → POST /api/account/personal-email
//   fetchAvatarSignedUrl → POST /api/account/avatar/signed-url
//   saveAvatar          → PUT /api/account/avatar { avatarUrl }
//   removeAvatar        → DELETE /api/account/avatar
//
// LGPD: personalEmail é PII — nunca logar em console.
//       avatarUrl: key no R2 não contém PII (orgId/userId/uuid opacos).
// =============================================================================

import type { AvatarSignedUrlBody, AvatarSignedUrlResponse } from '@elemento/shared-schemas';

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
  /** URL pública da foto de perfil no R2 (null quando não definida). */
  avatarUrl: string | null;
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

/**
 * POST /api/account/avatar/signed-url
 * Obtém URL pré-assinada (PUT 15 min) para upload direto ao R2.
 * Deve ser seguido por PUT direto no uploadUrl (sem Authorization)
 * e depois PUT /api/account/avatar { avatarUrl: publicUrl }.
 */
export async function fetchAvatarSignedUrl(
  body: AvatarSignedUrlBody,
): Promise<AvatarSignedUrlResponse> {
  return api.post<AvatarSignedUrlResponse>('/api/account/avatar/signed-url', body);
}

/**
 * PUT /api/account/avatar
 * Persiste a URL pública do avatar (após upload R2 concluído).
 * Retorna o perfil atualizado com avatarUrl preenchida.
 */
export async function saveAvatar(avatarUrl: string): Promise<AccountProfile> {
  return api.put<AccountProfile>('/api/account/avatar', { avatarUrl });
}

/**
 * DELETE /api/account/avatar
 * Remove a foto de perfil (avatar_url = null).
 * Retorna o perfil atualizado com avatarUrl = null.
 */
export async function removeAvatar(): Promise<AccountProfile> {
  return api.delete<AccountProfile>('/api/account/avatar');
}
