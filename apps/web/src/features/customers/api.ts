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
import { useAuthStore } from '../../lib/auth-store';

// ---------------------------------------------------------------------------
// Helpers privados — raw fetch para o endpoint de referral
// ---------------------------------------------------------------------------

/** URL base (espelha lib/api.ts — fonte de verdade continua sendo VITE_API_URL). */
const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3333';

/** Lê csrf_token do cookie não-httpOnly (padrão do backend Fastify). */
function getCsrfTokenLocal(): string {
  const match = document.cookie.split('; ').find((row) => row.startsWith('csrf_token='));
  return match ? (match.split('=')[1] ?? '') : '';
}

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
 * 409 → throws LawFirmCooldownError (com cooldown_until preservado do body.details)
 * 403 → throws ApiError(403, 'FEATURE_DISABLED', ...)
 *
 * NOTA DE SEGURANÇA (M1): fazemos raw fetch em vez de api.post para interceptar
 * o corpo do 409 ANTES que throwFromResponse descarte o campo `details`.
 * O ApiError genérico não carrega `details`, então cooldown_until seria perdido
 * se deixássemos a camada compartilhada processar o erro.
 */
export async function createLawFirmReferral(
  customerId: string,
  body: LawFirmReferralBody,
): Promise<LawFirmReferralResponse> {
  const accessToken = useAuthStore.getState().accessToken;
  const csrf = getCsrfTokenLocal();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  if (csrf) {
    headers['X-CSRF-Token'] = csrf;
  }

  const res = await fetch(
    `${API_BASE}/api/customers/${encodeURIComponent(customerId)}/law-firm-referral`,
    {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    },
  );

  if (res.status === 409) {
    // Lemos o body aqui, antes de qualquer handler genérico, para preservar
    // details.cooldown_until que throwFromResponse (lib/api.ts) descartaria.
    let cooldownUntil = '';
    try {
      const data = (await res.json()) as {
        details?: { cooldown_until?: string };
      };
      cooldownUntil = data.details?.cooldown_until ?? '';
    } catch {
      // body não era JSON — cooldownUntil permanece ''
    }
    throw new LawFirmCooldownError(cooldownUntil);
  }

  if (!res.ok) {
    // Para todos os outros erros HTTP delegamos à lógica compartilhada
    // (que lança ApiError com status + code + message).
    let code = 'HTTP_ERROR';
    let message = `Erro ${res.status}`;
    try {
      const errBody = (await res.json()) as { code?: string; message?: string; error?: string };
      if (errBody.code) code = errBody.code;
      if (errBody.message) message = errBody.message;
      else if (errBody.error) message = errBody.error;
    } catch {
      // body não era JSON
    }
    throw new ApiError(res.status, code, message);
  }

  return (await res.json()) as LawFirmReferralResponse;
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
