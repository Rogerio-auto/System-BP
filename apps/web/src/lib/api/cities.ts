// =============================================================================
// lib/api/cities.ts — Cliente de API para o domínio de cidades (F1-S06).
//
// Todas as respostas são validadas via Zod (.parse) antes de retornar —
// padrão M1 do projeto (falha ruidosa se o backend retornar shape inesperado).
//
// LGPD: cidades não contêm PII (nome de município + UF). Sem redact necessário.
// =============================================================================

import type {
  CityCreate,
  CityListResponse,
  CityResponse,
  CityUpdate,
} from '@elemento/shared-schemas';
import { CityListResponseSchema, CityResponseSchema } from '@elemento/shared-schemas';

import { api } from '../api';

// ─── Parâmetros de listagem ───────────────────────────────────────────────────

export interface CityListParams {
  page?: number;
  limit?: number;
  search?: string;
  state_uf?: string;
  /** undefined = todas, true = ativas, false = inativas */
  is_active?: boolean;
}

// ─── Funções ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/cities
 * Lista paginada de cidades com filtros opcionais.
 */
export async function listCities(params: CityListParams = {}): Promise<CityListResponse> {
  const qs = new URLSearchParams();

  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.state_uf) qs.set('state_uf', params.state_uf);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));

  const raw = await api.get(`/api/admin/cities${qs.toString() ? `?${qs.toString()}` : ''}`);
  return CityListResponseSchema.parse(raw);
}

/**
 * GET /api/admin/cities/:id
 * Retorna uma cidade pelo UUID.
 */
export async function getCity(id: string): Promise<CityResponse> {
  const raw = await api.get(`/api/admin/cities/${encodeURIComponent(id)}`);
  return CityResponseSchema.parse(raw);
}

/**
 * POST /api/admin/cities
 * Cria uma nova cidade.
 */
export async function createCity(body: CityCreate): Promise<CityResponse> {
  const raw = await api.post(`/api/admin/cities`, body);
  return CityResponseSchema.parse(raw);
}

/**
 * PATCH /api/admin/cities/:id
 * Atualiza parcialmente uma cidade existente.
 */
export async function updateCity(id: string, body: CityUpdate): Promise<CityResponse> {
  const raw = await api.patch(`/api/admin/cities/${encodeURIComponent(id)}`, body);
  return CityResponseSchema.parse(raw);
}

/**
 * DELETE /api/admin/cities/:id
 * Soft-delete: a cidade é marcada como deletada, não removida.
 */
export async function deleteCity(id: string): Promise<void> {
  await api.delete(`/api/admin/cities/${encodeURIComponent(id)}`);
}
