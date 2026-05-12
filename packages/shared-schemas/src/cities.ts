// =============================================================================
// cities.ts — Schemas Zod públicos do domínio de cidades (F1-S06).
//
// Compartilhados entre frontend (React Hook Form / listagem) e backend
// (routes + service). Não contém campos de segurança interna.
//
// LGPD: cidades não contêm PII (nome de município + UF).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas de campo
// ---------------------------------------------------------------------------

/**
 * Código IBGE oficial de 7 dígitos. Ex: "1100205" (Porto Velho).
 * Opcional no create — pode ser nulo em edge cases de importação manual.
 */
const ibgeCodeSchema = z
  .string()
  .regex(/^\d{7}$/, 'ibge_code deve ter 7 dígitos numéricos')
  .nullable()
  .optional();

/** UF de 2 letras maiúsculas. */
const stateUfSchema = z
  .string()
  .length(2, 'state_uf deve ter exatamente 2 caracteres')
  .toUpperCase()
  .default('RO');

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CityCreateSchema = z.object({
  /** Nome oficial do município. Ex: "Porto Velho". */
  name: z.string({ required_error: 'name é obrigatório' }).min(1).max(255),

  /**
   * Variações de grafia aceitas para matching.
   * Ex: ["PVH", "porto velho", "p. velho"].
   * Array vazio é válido.
   */
  aliases: z.array(z.string().min(1).max(100)).default([]),

  /** Código IBGE de 7 dígitos. Único por org (quando presente). */
  ibge_code: ibgeCodeSchema,

  /** UF de 2 letras. Default 'RO'. */
  state_uf: stateUfSchema,

  /** false = cidade desligada do atendimento. Default true. */
  is_active: z.boolean().default(true),
});

export type CityCreate = z.infer<typeof CityCreateSchema>;

// ---------------------------------------------------------------------------
// Update (partial — todos os campos opcionais)
// ---------------------------------------------------------------------------

export const CityUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  aliases: z.array(z.string().min(1).max(100)).optional(),
  ibge_code: z
    .string()
    .regex(/^\d{7}$/, 'ibge_code deve ter 7 dígitos numéricos')
    .nullable()
    .optional(),
  state_uf: z
    .string()
    .length(2, 'state_uf deve ter exatamente 2 caracteres')
    .toUpperCase()
    .optional(),
  is_active: z.boolean().optional(),
});

export type CityUpdate = z.infer<typeof CityUpdateSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export const CityResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  name_normalized: z.string(),
  aliases: z.array(z.string()),
  slug: z.string(),
  ibge_code: z.string().nullable(),
  state_uf: z.string(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type CityResponse = z.infer<typeof CityResponseSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export const CityListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(100).optional(),
  state_uf: z.string().length(2).toUpperCase().optional(),
  is_active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  include_deleted: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type CityListQuery = z.infer<typeof CityListQuerySchema>;

// ---------------------------------------------------------------------------
// List response
// ---------------------------------------------------------------------------

export const CityListResponseSchema = z.object({
  data: z.array(CityResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type CityListResponse = z.infer<typeof CityListResponseSchema>;
