// =============================================================================
// features/billing/api.ts — Cliente HTTP para cobrança (F5-S08, F5-S16).
//
// Único ponto de acesso para /api/billing/*.
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// =============================================================================
import { api, ApiError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';

import type {
  BoletoReferenceForm,
  BoletoResponse,
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
 * Idempotente: gera Idempotency-Key UUID por chamada (HIGH-03).
 */
export async function markPaymentDuePaid(id: string): Promise<PaymentDueResponse> {
  return api.post<PaymentDueResponse>(
    `/api/billing/payment-dues/${encodeURIComponent(id)}/mark-paid`,
    {},
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
  );
}

/**
 * POST /api/billing/payment-dues/:id/renegotiate — marca como renegociada.
 * Permissão: billing:mark_paid
 * Idempotente: gera Idempotency-Key UUID por chamada (HIGH-03).
 */
export async function renegotiatePaymentDue(id: string): Promise<PaymentDueResponse> {
  return api.post<PaymentDueResponse>(
    `/api/billing/payment-dues/${encodeURIComponent(id)}/renegotiate`,
    {},
    { headers: { 'Idempotency-Key': crypto.randomUUID() } },
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

// ---------------------------------------------------------------------------
// Boleto (F5-S16)
// ---------------------------------------------------------------------------

const API_BASE = (import.meta.env['VITE_API_URL'] as string | undefined) ?? 'http://localhost:3333';

function getCsrfToken(): string {
  const match = document.cookie.split('; ').find((row) => row.startsWith('csrf_token='));
  return match ? (match.split('=')[1] ?? '') : '';
}

/**
 * POST /api/billing/payment-dues/:id/boleto — modo upload (multipart).
 *
 * Usa fetch diretamente pois Content-Type deve ser determinado pelo browser
 * (boundary automático do FormData). NÃO passar Content-Type: application/json.
 *
 * Permissão: billing:boleto:write
 * Gate: billing.boleto.enabled
 * LGPD §14.2: bytes não são persistidos no banco — apenas boleto_media_id.
 *
 * @param dueId  UUID da parcela.
 * @param file   Arquivo PDF/JPG/PNG (máx 10 MB).
 * @param idempotencyKey  UUID único para idempotência.
 */
export async function attachBoletoUpload(
  dueId: string,
  file: File,
  idempotencyKey: string,
): Promise<BoletoResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const accessToken = useAuthStore.getState().accessToken;
  const csrf = getCsrfToken();

  const headers: Record<string, string> = {
    'Idempotency-Key': idempotencyKey,
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const res = await fetch(
    `${API_BASE}/api/billing/payment-dues/${encodeURIComponent(dueId)}/boleto`,
    {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    },
  );

  if (!res.ok) {
    let code = 'HTTP_ERROR';
    let message = `Erro ${res.status}`;
    try {
      const body = (await res.json()) as { code?: string; message?: string };
      if (body.code) code = body.code;
      if (body.message) message = body.message;
    } catch {
      /* body não era JSON */
    }
    throw new ApiError(res.status, code, message);
  }

  return res.json() as Promise<BoletoResponse>;
}

/**
 * POST /api/billing/payment-dues/:id/boleto — modo referência (JSON).
 *
 * Permissão: billing:boleto:write
 * Gate: billing.boleto.enabled
 * LGPD §14.2: boletoUrl deve ser host da allowlist (validado no backend).
 *
 * @param dueId           UUID da parcela.
 * @param body            Dados de referência (url, linha digitável, PIX).
 * @param idempotencyKey  UUID único para idempotência.
 */
export async function attachBoletoReference(
  dueId: string,
  body: BoletoReferenceForm,
  idempotencyKey: string,
): Promise<BoletoResponse> {
  // Sanitize: remove strings vazias, envia apenas campos preenchidos
  const payload: Record<string, string> = {};
  if (body.boletoUrl) payload['boletoUrl'] = body.boletoUrl;
  if (body.digitableLine) payload['digitableLine'] = body.digitableLine;
  if (body.pixCopiaCola) payload['pixCopiaCola'] = body.pixCopiaCola;
  if (body.filename) payload['filename'] = body.filename;

  return api.post<BoletoResponse>(
    `/api/billing/payment-dues/${encodeURIComponent(dueId)}/boleto`,
    payload,
    {
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

/**
 * DELETE /api/billing/payment-dues/:id/boleto — remove o boleto da parcela.
 *
 * Permissão: billing:boleto:write
 * Gate: billing.boleto.enabled
 * Idempotente: parcela sem boleto retorna estado atual sem erro.
 * LGPD §14.2: auditLog no backend sem PII.
 */
export async function removeBoletoDue(dueId: string): Promise<BoletoResponse> {
  return api.delete<BoletoResponse>(
    `/api/billing/payment-dues/${encodeURIComponent(dueId)}/boleto`,
  );
}
