// =============================================================================
// features/followup/api.ts — Cliente HTTP para follow-up (F5-S05).
//
// Único ponto de acesso para /api/followup/*.
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// =============================================================================
import { api } from '../../lib/api';

import type {
  FollowupJobResponse,
  FollowupJobsFilters,
  FollowupJobsListResponse,
  FollowupRuleForm,
  FollowupRuleResponse,
  FollowupRulesListResponse,
} from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildJobsQueryString(filters: FollowupJobsFilters): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.rule_id) params.set('rule_id', filters.rule_id);
  if (filters.lead_id) params.set('lead_id', filters.lead_id);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * GET /api/followup/rules — lista réguas da organização.
 * Permissão: followup:read
 */
export async function fetchFollowupRules(): Promise<FollowupRulesListResponse> {
  return api.get<FollowupRulesListResponse>('/api/followup/rules');
}

/**
 * POST /api/followup/rules — cria nova régua.
 * Permissão: followup:write
 */
export async function createFollowupRule(body: FollowupRuleForm): Promise<FollowupRuleResponse> {
  return api.post<FollowupRuleResponse>('/api/followup/rules', body);
}

/**
 * PATCH /api/followup/rules/:id — atualiza régua parcialmente.
 * Permissão: followup:write
 */
export async function updateFollowupRule(
  id: string,
  body: Partial<FollowupRuleForm>,
): Promise<FollowupRuleResponse> {
  return api.patch<FollowupRuleResponse>(`/api/followup/rules/${encodeURIComponent(id)}`, body);
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

/**
 * GET /api/followup/jobs — lista paginada com filtros.
 * Permissão: followup:read
 * LGPD: resposta sem PII de mensagem — apenas template_key e lead_name curto.
 */
export async function fetchFollowupJobs(
  filters: FollowupJobsFilters = {},
): Promise<FollowupJobsListResponse> {
  return api.get<FollowupJobsListResponse>(`/api/followup/jobs${buildJobsQueryString(filters)}`);
}

/**
 * POST /api/followup/jobs/:id/cancel — cancela job agendado.
 * Permissão: followup:cancel_job
 */
export async function cancelFollowupJob(id: string): Promise<FollowupJobResponse> {
  return api.post<FollowupJobResponse>(`/api/followup/jobs/${encodeURIComponent(id)}/cancel`, {});
}
