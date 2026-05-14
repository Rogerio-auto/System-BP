// =============================================================================
// credit-products/schemas.ts — Schemas Zod para o módulo de produtos de crédito.
//
// Produtos de crédito (F2-S03):
//   - credit_products: catálogo com key/name/description/is_active.
//   - credit_product_rules: regras versionadas (imutáveis após publicação).
//
// Validações críticas:
//   - key: lowercase snake_case 3-60 chars, único por org.
//   - monthlyRate: 0..1 decimal (não percentual).
//   - minAmount/maxAmount: 100..1_000_000, max >= min.
//   - minTermMonths/maxTermMonths: 1..120, max >= min.
//   - amortization: 'price' | 'sac'.
//   - cityScope: array UUID, opcional.
//
// LGPD: nenhum campo contém PII (só IDs, taxas, prazos).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const productIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type ProductIdParam = z.infer<typeof productIdParamSchema>;

// ---------------------------------------------------------------------------
// Product schemas
// ---------------------------------------------------------------------------

/**
 * key: lowercase, apenas letras, dígitos e underscores, 3-60 chars.
 * Ex: "microcredito_basico", "credito_jovem".
 * Validado por regex antes de chegar no banco.
 */
const keySchema = z
  .string()
  .min(3, 'key deve ter ao menos 3 caracteres')
  .max(60, 'key deve ter no máximo 60 caracteres')
  .regex(/^[a-z0-9_]+$/, 'key deve ser lowercase snake_case (letras, dígitos e underscores)');

export const CreditProductCreateSchema = z.object({
  key: keySchema,
  name: z.string().min(1, 'name é obrigatório').max(200, 'name muito longo'),
  description: z.string().max(1000, 'description muito longa').optional(),
});

export type CreditProductCreate = z.infer<typeof CreditProductCreateSchema>;

export const CreditProductUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(1000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Ao menos um campo deve ser informado',
  });

export type CreditProductUpdate = z.infer<typeof CreditProductUpdateSchema>;

// ---------------------------------------------------------------------------
// Rule schemas
// ---------------------------------------------------------------------------

export const CreditProductRuleCreateSchema = z
  .object({
    minAmount: z
      .number()
      .min(100, 'minAmount deve ser ao menos 100')
      .max(1_000_000, 'minAmount excede o máximo'),
    maxAmount: z
      .number()
      .min(100, 'maxAmount deve ser ao menos 100')
      .max(1_000_000, 'maxAmount excede o máximo'),
    minTermMonths: z
      .number()
      .int('minTermMonths deve ser inteiro')
      .min(1, 'minTermMonths mínimo é 1')
      .max(120, 'minTermMonths máximo é 120'),
    maxTermMonths: z
      .number()
      .int('maxTermMonths deve ser inteiro')
      .min(1, 'maxTermMonths mínimo é 1')
      .max(120, 'maxTermMonths máximo é 120'),
    /**
     * Taxa mensal decimal: 0 < monthlyRate <= 1 (ex: 0.025 = 2,5% ao mês).
     * Não aceitar zero (produto sem taxa não é aplicável ao modelo do BdP).
     */
    monthlyRate: z
      .number()
      .gt(0, 'monthlyRate deve ser maior que 0')
      .lte(1, 'monthlyRate deve ser no máximo 1 (100%)'),
    iofRate: z
      .number()
      .gte(0, 'iofRate não pode ser negativo')
      .lte(1, 'iofRate deve ser no máximo 1')
      .optional(),
    amortization: z.enum(['price', 'sac']),
    cityScope: z.array(z.string().uuid('cada cityScope item deve ser UUID')).optional(),
    /**
     * Data de início de vigência ISO 8601. Se omitido, usa now().
     */
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
  })
  .refine((data) => data.maxAmount >= data.minAmount, {
    message: 'maxAmount deve ser >= minAmount',
    path: ['maxAmount'],
  })
  .refine((data) => data.maxTermMonths >= data.minTermMonths, {
    message: 'maxTermMonths deve ser >= minTermMonths',
    path: ['maxTermMonths'],
  });

export type CreditProductRuleCreate = z.infer<typeof CreditProductRuleCreateSchema>;

// ---------------------------------------------------------------------------
// Response schemas
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
  /** Última regra ativa (resumo). null se ainda não houver regra publicada. */
  active_rule: CreditProductRuleResponseSchema.nullable(),
});

export type CreditProductResponse = z.infer<typeof CreditProductResponseSchema>;

export const CreditProductDetailResponseSchema = CreditProductResponseSchema.extend({
  /** Timeline completa de regras (todas as versões, DESC). */
  rules: z.array(CreditProductRuleResponseSchema),
});

export type CreditProductDetailResponse = z.infer<typeof CreditProductDetailResponseSchema>;

export const CreditProductListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  is_active: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
  include_deleted: z.coerce.boolean().default(false),
});

export type CreditProductListQuery = z.infer<typeof CreditProductListQuerySchema>;

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
