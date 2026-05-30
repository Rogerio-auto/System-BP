// =============================================================================
// features/billing/api.ts — Cliente HTTP para cobrança (F5-S08).
//
// Único ponto de acesso para /api/billing/*.
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// =============================================================================
import { api } from '../../lib/api';

import type {
  CollectionJobResponse,
  CollectionJobsFilters,
  CollectionJobsListResponse,
  CollectionRuleForm,
  CollectionRuleResponse,
  CollectionRulesListResponse,
  PaymentDueResponse,
  PaymentDuesFilters,
  PaymentDuesListResponse,
} from './schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildDuesQueryString(filters: PaymentDuesFilters): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.customer_id) params.set('customer_id', filters.customer_id);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function buildJobsQueryString(filters: CollectionJobsFilters): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.rule_id) params.set('rule_id', filters.rule_id);
  if (filters.payment_due_id) params.set('payment_due_id', filters.payment_due_id);
  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// PaymentDues
// ---------------------------------------------------------------------------

/**
 * GET /api/billing/payment-dues — lista parcelas com filtros.
 * Permissão: billing:read
 * LGPD: resposta sem CPF — apenas customer_name curto.
 */
export async function fetchPaymentDues(
  filters: PaymentDuesFilters = {},
): Promise<PaymentDuesListResponse> {
  return api.get<PaymentDuesListResponse>(
    `/api/billing/payment-dues${buildDuesQueryString(filters)}`,
  );
}

/**
 * POST /api/billing/payment-dues/:id/mark-paid — marca como paga.
 * Permissão: billing:mark_paid
 * Idempotente: enviar Idempotency-Key no header (gerenciado pelo caller).
 */
export async function markPaymentDuePaid(id: string): Promise<PaymentDueResponse> {
  return api.post<PaymentDueResponse>(
    `/api/billing/payment-dues/${encodeURIComponent(id)}/mark-paid`,
    {},
  );
}

/**
 * POST /api/billing/payment-dues/:id/renegotiate — marca como renegociada.
 * Permissão: billing:mark_paid
 */
export async function renegotiatePaymentDue(id: string): Promise<PaymentDueResponse> {
  return api.post<PaymentDueResponse>(
    `/api/billing/payment-dues/${encodeURIComponent(id)}/renegotiate`,
    {},
  );
}

// ---------------------------------------------------------------------------
// CollectionRules
// ---------------------------------------------------------------------------

/**
 * GET /api/billing/rules — lista réguas de cobrança.
 * Permissão: billing:read
 */
export async function fetchCollectionRules(): Promise<CollectionRulesListResponse> {
  return api.get<CollectionRulesListResponse>('/api/billing/rules');
}

/**
 * POST /api/billing/rules — cria nova régua.
 * Permissão: billing:write
 */
export async function createCollectionRule(
  body: CollectionRuleForm,
): Promise<CollectionRuleResponse> {
  return api.post<CollectionRuleResponse>('/api/billing/rules', body);
}

/**
 * PATCH /api/billing/rules/:id — atualiza régua parcialmente.
 * Permissão: billing:write
 */
export async function updateCollectionRule(
  id: string,
  body: Partial<CollectionRuleForm>,
): Promise<CollectionRuleResponse> {
  return api.patch<CollectionRuleResponse>(`/api/billing/rules/${encodeURIComponent(id)}`, body);
}

// ---------------------------------------------------------------------------
// CollectionJobs
// ---------------------------------------------------------------------------

/**
 * GET /api/billing/jobs — lista jobs com filtros paginados.
 * Permissão: billing:read
 * LGPD: resposta sem PII — apenas contract_reference e customer_name curto.
 */
export async function fetchCollectionJobs(
  filters: CollectionJobsFilters = {},
): Promise<CollectionJobsListResponse> {
  return api.get<CollectionJobsListResponse>(`/api/billing/jobs${buildJobsQueryString(filters)}`);
}

/**
 * POST /api/billing/jobs/:id/cancel — cancela job agendado.
 * Permissão: billing:cancel_job
 */
export async function cancelCollectionJob(id: string): Promise<CollectionJobResponse> {
  return api.post<CollectionJobResponse>(`/api/billing/jobs/${encodeURIComponent(id)}/cancel`, {});
}
