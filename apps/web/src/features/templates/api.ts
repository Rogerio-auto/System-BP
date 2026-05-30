// =============================================================================
// features/templates/api.ts — API client para gestão de templates WhatsApp.
//
// Único ponto de acesso para /api/templates/*.
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
// =============================================================================

import { api } from '../../lib/api';

import type {
  TemplateCreateForm,
  TemplateFilters,
  TemplateListResponse,
  TemplateResponse,
  TemplateUpdateForm,
} from './schemas';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildQueryString(filters: TemplateFilters): string {
  const params = new URLSearchParams();
  if (filters.page !== undefined) params.set('page', String(filters.page));
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.status) params.set('status', filters.status);
  if (filters.category) params.set('category', filters.category);
  if (filters.language) params.set('language', filters.language);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export async function fetchTemplatesList(
  filters: TemplateFilters = {},
): Promise<TemplateListResponse> {
  return api.get<TemplateListResponse>(`/api/templates${buildQueryString(filters)}`);
}

export async function fetchTemplate(id: string): Promise<TemplateResponse> {
  return api.get<TemplateResponse>(`/api/templates/${encodeURIComponent(id)}`);
}

export async function createTemplate(
  body: TemplateCreateForm,
  idempotencyKey: string,
): Promise<TemplateResponse> {
  return api.post<TemplateResponse>('/api/templates', body, {
    headers: { 'idempotency-key': idempotencyKey },
  });
}

export async function updateTemplate(
  id: string,
  body: TemplateUpdateForm,
): Promise<TemplateResponse> {
  return api.patch<TemplateResponse>(`/api/templates/${encodeURIComponent(id)}`, body);
}

export async function deleteTemplate(id: string): Promise<TemplateResponse> {
  return api.delete<TemplateResponse>(`/api/templates/${encodeURIComponent(id)}`);
}

export async function syncTemplate(id: string, idempotencyKey: string): Promise<TemplateResponse> {
  return api.post<TemplateResponse>(
    `/api/templates/${encodeURIComponent(id)}/sync`,
    {},
    { headers: { 'idempotency-key': idempotencyKey } },
  );
}

export async function syncAllTemplates(): Promise<{
  synced: number;
  unchanged: number;
  errors: number;
}> {
  return api.post('/api/templates/sync-all', {});
}
