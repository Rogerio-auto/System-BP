// =============================================================================
// lib/api/credit-products.ts — Cliente HTTP para o módulo de produtos de crédito.
//
// Endpoints (F2-S03):
//   GET    /api/credit-products            → lista com última regra ativa
//   POST   /api/credit-products            → cria produto
//   GET    /api/credit-products/:id        → detalhe + timeline de regras
//   PATCH  /api/credit-products/:id        → atualiza name/description/is_active
//   DELETE /api/credit-products/:id        → soft-delete
//   POST   /api/credit-products/:id/rules  → publica nova versão de regra
//   GET    /api/credit-products/:id/rules  → timeline de regras
//
// Todas as respostas são validadas via Zod (fail ruidoso se shape inesperado).
// LGPD: nenhum campo contém PII neste módulo.
// =============================================================================

import { z } from 'zod';

import { api } from '../api';

// ---------------------------------------------------------------------------
// Schemas Zod inline (F2-S03 não exporta de shared-schemas ainda — schemas
// espelham exatamente os response schemas do backend em schemas.ts)
// ---------------------------------------------------------------------------

export const CreditProductRuleResponseSchema = z.object({
  id: z.string().uuid(),
  product_id: z.string().uuid(),
  version: z.number().int(),
  min_amount: z.string(),
  max_amount: z.string(),
  min_term_months: z.number().int(),
  max_term_months: z.number().int(),
  monthly_rate: z.string(),
  iof_rate: z.string().nullable(),
  amortization: z.enum(['price', 'sac']),
  city_scope: z.array(z.string().uuid()).nullable(),
  effective_from: z.string(),
  effective_to: z.string().nullable(),
  is_active: z.boolean(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
});

export type CreditProductRuleResponse = z.infer<typeof CreditProductRuleResponseSchema>;

export const CreditProductResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  active_rule: CreditProductRuleResponseSchema.nullable(),
});

export type CreditProductResponse = z.infer<typeof CreditProductResponseSchema>;

export const CreditProductDetailResponseSchema = CreditProductResponseSchema.extend({
  rules: z.array(CreditProductRuleResponseSchema),
});

export type CreditProductDetailResponse = z.infer<typeof CreditProductDetailResponseSchema>;

export const CreditProductListResponseSchema = z.object({
  data: z.array(CreditProductResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type CreditProductListResponse = z.infer<typeof CreditProductListResponseSchema>;

export const CreditProductRulesListResponseSchema = z.object({
  data: z.array(CreditProductRuleResponseSchema),
});

export type CreditProductRulesListResponse = z.infer<typeof CreditProductRulesListResponseSchema>;

// ---------------------------------------------------------------------------
// Parâmetros de listagem
// ---------------------------------------------------------------------------

export interface ProductListParams {
  page?: number;
  limit?: number;
  search?: string;
  /** undefined = todos, true = ativos, false = inativos */
  is_active?: boolean;
  include_deleted?: boolean;
}

// ---------------------------------------------------------------------------
// Corpo para criação de produto
// ---------------------------------------------------------------------------

export interface ProductCreate {
  key: string;
  name: string;
  description?: string | undefined;
}

export interface ProductUpdate {
  name?: string;
  description?: string | null;
  is_active?: boolean;
}

// ---------------------------------------------------------------------------
// Corpo para publicação de regra
// ---------------------------------------------------------------------------

export interface RuleCreate {
  minAmount: number;
  maxAmount: number;
  minTermMonths: number;
  maxTermMonths: number;
  monthlyRate: number;
  iofRate?: number | undefined;
  amortization: 'price' | 'sac';
  cityScope?: string[] | undefined;
  effectiveFrom?: string | undefined;
}

// ---------------------------------------------------------------------------
// Funções de API
// ---------------------------------------------------------------------------

/**
 * GET /api/credit-products
 * Lista paginada com última regra ativa.
 */
export async function listProducts(
  params: ProductListParams = {},
): Promise<CreditProductListResponse> {
  const qs = new URLSearchParams();
  if (params.page !== undefined) qs.set('page', String(params.page));
  if (params.limit !== undefined) qs.set('limit', String(params.limit));
  if (params.search) qs.set('search', params.search);
  if (params.is_active !== undefined) qs.set('is_active', String(params.is_active));
  if (params.include_deleted) qs.set('include_deleted', 'true');

  const raw = await api.get(`/api/credit-products${qs.toString() ? `?${qs.toString()}` : ''}`);
  return CreditProductListResponseSchema.parse(raw);
}

/**
 * POST /api/credit-products
 * Cria novo produto de crédito.
 */
export async function createProduct(body: ProductCreate): Promise<CreditProductResponse> {
  const raw = await api.post('/api/credit-products', body);
  return CreditProductResponseSchema.parse(raw);
}

/**
 * GET /api/credit-products/:id
 * Detalhe do produto + timeline completa de regras.
 */
export async function getProduct(id: string): Promise<CreditProductDetailResponse> {
  const raw = await api.get(`/api/credit-products/${encodeURIComponent(id)}`);
  return CreditProductDetailResponseSchema.parse(raw);
}

/**
 * PATCH /api/credit-products/:id
 * Atualiza name / description / is_active.
 */
export async function updateProduct(
  id: string,
  body: ProductUpdate,
): Promise<CreditProductResponse> {
  const raw = await api.patch(`/api/credit-products/${encodeURIComponent(id)}`, body);
  return CreditProductResponseSchema.parse(raw);
}

/**
 * DELETE /api/credit-products/:id
 * Soft-delete — bloqueado se houver simulações nos últimos 90 dias (409).
 */
export async function deleteProduct(id: string): Promise<void> {
  await api.delete(`/api/credit-products/${encodeURIComponent(id)}`);
}

/**
 * POST /api/credit-products/:id/rules
 * Publica nova versão de regra (incrementa versão, expira anterior).
 * Requer feature flag credit_simulation.enabled.
 */
export async function publishRule(
  productId: string,
  body: RuleCreate,
): Promise<CreditProductRuleResponse> {
  const raw = await api.post(`/api/credit-products/${encodeURIComponent(productId)}/rules`, body);
  return CreditProductRuleResponseSchema.parse(raw);
}

/**
 * GET /api/credit-products/:id/rules
 * Timeline completa de regras (todas as versões, DESC).
 * Requer feature flag credit_simulation.enabled.
 */
export async function listRules(productId: string): Promise<CreditProductRulesListResponse> {
  const raw = await api.get(`/api/credit-products/${encodeURIComponent(productId)}/rules`);
  return CreditProductRulesListResponseSchema.parse(raw);
}
