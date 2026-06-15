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

/**
 * F5-S15 — Cria template com suporte a multipart quando há arquivo de amostra.
 * @param body Dados do template (JSON).
 * @param sampleFile Arquivo de amostra (opcional) quando headerType='document'|'image'.
 * @param idempotencyKey UUID para idempotência.
 */
export async function createTemplate(
  body: TemplateCreateForm,
  sampleFile: File | null,
  idempotencyKey: string,
): Promise<TemplateResponse> {
  if (sampleFile) {
    // Multipart: FormData com JSON + arquivo
    const formData = new FormData();
    formData.append('data', JSON.stringify(body));
    formData.append('sampleFile', sampleFile);

    // Chama apiFetch diretamente com FormData (não serializa como JSON)
    const res = await fetch(
      `${(import.meta.env['VITE_API_URL'] as string) ?? 'http://localhost:3333'}/api/templates`,
      {
        method: 'POST',
        headers: {
          'idempotency-key': idempotencyKey,
          // Não define Content-Type — browser define com boundary do multipart
        },
        credentials: 'include',
        body: formData,
      },
    );

    if (!res.ok) {
      let message = `Erro ${res.status}`;
      try {
        const errBody = (await res.json()) as { code?: string; message?: string };
        if (errBody.message) message = errBody.message;
      } catch {
        // Não era JSON
      }
      throw new Error(message);
    }

    return res.json() as Promise<TemplateResponse>;
  } else {
    // JSON puro — sem arquivo
    return api.post<TemplateResponse>('/api/templates', body, {
      headers: { 'idempotency-key': idempotencyKey },
    });
  }
}

/**
 * F5-S15 — Atualiza template com suporte a multipart quando há arquivo de amostra.
 * @param id ID do template.
 * @param body Dados a atualizar (JSON).
 * @param sampleFile Arquivo de amostra (opcional).
 */
export async function updateTemplate(
  id: string,
  body: TemplateUpdateForm,
  sampleFile: File | null = null,
): Promise<TemplateResponse> {
  if (sampleFile) {
    const formData = new FormData();
    formData.append('data', JSON.stringify(body));
    formData.append('sampleFile', sampleFile);

    const res = await fetch(
      `${(import.meta.env['VITE_API_URL'] as string) ?? 'http://localhost:3333'}/api/templates/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        credentials: 'include',
        body: formData,
      },
    );

    if (!res.ok) {
      let message = `Erro ${res.status}`;
      try {
        const errBody = (await res.json()) as { message?: string };
        if (errBody.message) message = errBody.message;
      } catch {
        // Não era JSON
      }
      throw new Error(message);
    }

    return res.json() as Promise<TemplateResponse>;
  } else {
    return api.patch<TemplateResponse>(`/api/templates/${encodeURIComponent(id)}`, body);
  }
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
