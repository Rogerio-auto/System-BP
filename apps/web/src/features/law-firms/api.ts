// =============================================================================
// features/law-firms/api.ts — Cliente HTTP para escritórios de advocacia (F19-S04).
//
// Único ponto de acesso para /api/law-firms/*.
// Usa lib/api.ts (apiFetch com CSRF + auth + interceptor 401).
//
// Permissão exigida: law_firms:manage (admin / gestor_geral).
// LGPD: contact_phone é dado público de PJ (CNPJ) — não é PII pessoal.
// =============================================================================

import type {
  LawFirmCreate,
  LawFirmListResponse,
  LawFirmResponse,
  LawFirmUpdate,
} from '@elemento/shared-schemas';

import { api } from '../../lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ListLawFirmsParams {
  cityId?: string;
  page?: number;
  pageSize?: number;
}

function buildQueryString(params: ListLawFirmsParams): string {
  const p = new URLSearchParams();
  if (params.cityId) p.set('city_id', params.cityId);
  if (params.page !== undefined) p.set('page', String(params.page));
  if (params.pageSize !== undefined) p.set('pageSize', String(params.pageSize));
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * GET /api/law-firms — lista escritórios com paginação e filtro por cidade.
 */
export async function listLawFirms(params: ListLawFirmsParams = {}): Promise<LawFirmListResponse> {
  const qs = buildQueryString(params);
  return api.get<LawFirmListResponse>(`/api/law-firms${qs}`);
}

/**
 * POST /api/law-firms — cria escritório.
 */
export async function createLawFirm(data: LawFirmCreate): Promise<LawFirmResponse> {
  return api.post<LawFirmResponse>('/api/law-firms', data);
}

/**
 * PATCH /api/law-firms/:id — atualiza escritório.
 */
export async function updateLawFirm(id: string, data: LawFirmUpdate): Promise<LawFirmResponse> {
  return api.patch<LawFirmResponse>(`/api/law-firms/${encodeURIComponent(id)}`, data);
}

/**
 * DELETE /api/law-firms/:id — exclui escritório (soft delete).
 */
export async function deleteLawFirm(id: string): Promise<void> {
  return api.delete<void>(`/api/law-firms/${encodeURIComponent(id)}`);
}
