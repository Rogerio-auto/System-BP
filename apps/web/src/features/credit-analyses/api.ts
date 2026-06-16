// =============================================================================
// features/credit-analyses/api.ts — API client para análises de crédito.
//
// Único ponto de acesso para os endpoints /api/credit-analyses/*.
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
//
// LGPD (doc 17):
//   - parecer_text: nunca logado — DLP via Zod no form.
//   - Respostas com internal_score sempre null nas rotas públicas.
// =============================================================================

import { api } from '../../lib/api';

import type {
  CreditAnalysisCreateForm,
  CreditAnalysisDecideForm,
  CreditAnalysisFilters,
  CreditAnalysisListResponse,
  CreditAnalysisRequestReviewForm,
  CreditAnalysisResponse,
  CreditAnalysisVersionForm,
  CreditAnalysisVersionResponse,
} from './schemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQueryString(filters: CreditAnalysisFilters): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.analyst_user_id) params.set('analyst_user_id', filters.analyst_user_id);
  if (filters.lead_id) params.set('lead_id', filters.lead_id);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /api/credit-analyses — lista paginada com filtros e city-scope.
 */
export async function fetchCreditAnalysesList(
  filters: CreditAnalysisFilters = {},
): Promise<CreditAnalysisListResponse> {
  return api.get<CreditAnalysisListResponse>(`/api/credit-analyses${buildQueryString(filters)}`);
}

/**
 * GET /api/credit-analyses/:id — detalhe com versão atual hidratada.
 */
export async function fetchCreditAnalysis(id: string): Promise<CreditAnalysisResponse> {
  return api.get<CreditAnalysisResponse>(`/api/credit-analyses/${encodeURIComponent(id)}`);
}

/**
 * GET /api/credit-analyses/:id/versions — histórico completo de versões.
 * Permissão: credit_analyses:read
 */
export async function fetchCreditAnalysisVersions(
  id: string,
): Promise<CreditAnalysisVersionResponse[]> {
  return api.get<CreditAnalysisVersionResponse[]>(
    `/api/credit-analyses/${encodeURIComponent(id)}/versions`,
  );
}

/**
 * GET /api/leads/:leadId/credit-analyses — histórico de análises por lead.
 */
export async function fetchLeadCreditAnalyses(
  leadId: string,
  filters: CreditAnalysisFilters = {},
): Promise<CreditAnalysisListResponse> {
  return api.get<CreditAnalysisListResponse>(
    `/api/leads/${encodeURIComponent(leadId)}/credit-analyses${buildQueryString(filters)}`,
  );
}

/**
 * POST /api/credit-analyses — criar análise + 1ª versão (1 transação).
 * Permissão: credit_analyses:write
 */
export async function createCreditAnalysis(
  body: CreditAnalysisCreateForm,
): Promise<CreditAnalysisResponse> {
  return api.post<CreditAnalysisResponse>('/api/credit-analyses', body);
}

/**
 * POST /api/credit-analyses/:id/versions — nova versão imutável.
 * Permissão: credit_analyses:write
 */
export async function addCreditAnalysisVersion(
  id: string,
  body: CreditAnalysisVersionForm,
): Promise<CreditAnalysisResponse> {
  return api.post<CreditAnalysisResponse>(
    `/api/credit-analyses/${encodeURIComponent(id)}/versions`,
    body,
  );
}

/**
 * POST /api/credit-analyses/:id/decide — decisão final (aprovado | recusado).
 * Permissão: credit_analyses:decide
 */
export async function decideCreditAnalysis(
  id: string,
  body: CreditAnalysisDecideForm,
): Promise<CreditAnalysisResponse> {
  return api.post<CreditAnalysisResponse>(
    `/api/credit-analyses/${encodeURIComponent(id)}/decide`,
    body,
  );
}

/**
 * POST /api/credit-analyses/:id/request-review — Art. 20 §5 LGPD.
 * Permissão: credit_analyses:request_review
 */
export async function requestCreditAnalysisReview(
  id: string,
  body: CreditAnalysisRequestReviewForm,
): Promise<CreditAnalysisResponse> {
  return api.post<CreditAnalysisResponse>(
    `/api/credit-analyses/${encodeURIComponent(id)}/request-review`,
    body,
  );
}
