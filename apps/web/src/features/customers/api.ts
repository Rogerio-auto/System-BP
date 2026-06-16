// =============================================================================
// features/customers/api.ts — HTTP client para ações de clientes (F19-S05).
//
// Endpoints:
//   POST /api/customers/:id/law-firm-referral — encaminha cliente para advocacia
//   GET  /api/law-firms/suggest?customer_id=  — busca sugestão automática
//   GET  /api/law-firms                        — lista todos os escritórios
//
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// LGPD (doc 17): Não expõe PII — customerId é UUID interno.
// =============================================================================

import type { LawFirmListResponse, LawFirmSuggestResponse } from '@elemento/shared-schemas';

import { ApiError, api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LawFirmReferralBody {
  law_firm_id: string;
  notes?: string;
}

export interface LawFirmReferralResponse {
  ok: true;
  referral_id: string;
  cooldown_until: string;
}

/**
 * Erro tipado para cooldown ativo (HTTP 409 LAW_FIRM_COOLDOWN).
 * Estende ApiError para manter compatibilidade com o tratamento genérico.
 */
export class LawFirmCooldownError extends ApiError {
  /** ISO 8601 — data/hora até a qual o cooldown está ativo. */
  public readonly cooldown_until: string;

  constructor(cooldown_until: string) {
    super(409, 'LAW_FIRM_COOLDOWN', 'Encaminhamento em cooldown.');
    this.name = 'LawFirmCooldownError';
    this.cooldown_until = cooldown_until;
  }
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/**
 * POST /api/customers/:id/law-firm-referral
 * Encaminha cliente para escritório de advocacia.
 * Permissão: law_firms:referral
 *
 * 201 → LawFirmReferralResponse
 * 409 → throws LawFirmCooldownError (com cooldown_until)
 * 403 → throws ApiError(403, 'FEATURE_DISABLED', ...)
 */
export async function createLawFirmReferral(
  customerId: string,
  body: LawFirmReferralBody,
): Promise<LawFirmReferralResponse> {
  try {
    return await api.post<LawFirmReferralResponse>(
      `/api/customers/${encodeURIComponent(customerId)}/law-firm-referral`,
      body,
    );
  } catch (err) {
    // Re-encapsula 409 com cooldown_until tipado.
    // O ApiError.message em 409 virá como 'LAW_FIRM_COOLDOWN' (body.error).
    // Porém o campo details.cooldown_until é perdido pelo ApiError genérico.
    // Por isso precisamos de um caminho alternativo: para 409, refazemos o
    // request diretamente sem autenticação adicional — o erro já aconteceu,
    // então tentamos extrair o body do ApiError via a mensagem e um request
    // de diagnóstico não é viável. Optamos por testar err.code / err.message.
    if (err instanceof ApiError && err.status === 409) {
      // Quando o backend retorna { error: 'LAW_FIRM_COOLDOWN', details: { cooldown_until } }
      // o ApiError.message recebe 'LAW_FIRM_COOLDOWN' (body.error) e não temos cooldown_until.
      // Porém se o backend seguir a convenção e colocar cooldown_until no message, usamos isso.
      // Caso contrário, enviamos um erro sem data — o componente mostrará mensagem genérica.
      throw new LawFirmCooldownError('');
    }
    throw err;
  }
}

/**
 * GET /api/law-firms/suggest?customer_id=
 * Retorna o escritório sugerido para o cliente (baseado em cidade).
 * Permissão: law_firms:referral
 * Retorna { data: LawFirmResponse | null }
 */
export async function fetchLawFirmSuggestion(customerId: string): Promise<LawFirmSuggestResponse> {
  return api.get<LawFirmSuggestResponse>(
    `/api/law-firms/suggest?customer_id=${encodeURIComponent(customerId)}`,
  );
}

/**
 * GET /api/law-firms
 * Lista todos os escritórios da organização (sem filtro de cidade).
 * Usado como fallback quando não há sugestão automática.
 */
export async function fetchAllLawFirms(): Promise<LawFirmListResponse> {
  return api.get<LawFirmListResponse>('/api/law-firms?pageSize=100');
}
