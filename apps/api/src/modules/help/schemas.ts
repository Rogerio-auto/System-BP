// help/schemas.ts - Schemas Zod para telemetria da Central de Ajuda (F10-S12).
//
// TODO (F10-S09): adicionar .openapi({ example }) quando S09 mergear.

import { z } from 'zod';

// Validacao de slug (ASCII puro, sem normalizacao)
export const SlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9/-]+$/, 'Slug deve conter apenas letras minusculas, digitos, hifens e barras');

export const RecordViewBody = z.object({
  slug: SlugSchema,
});

export type RecordViewBodyInput = z.infer<typeof RecordViewBody>;

export const RecordFeedbackBody = z.object({
  slug: SlugSchema,
  helpful: z.boolean(),
  comment: z.string().max(2000).optional(),
});

export type RecordFeedbackBodyInput = z.infer<typeof RecordFeedbackBody>;

export const PopularQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

export type PopularQueryInput = z.infer<typeof PopularQuery>;

export const PopularItemSchema = z.object({
  slug: z.string(),
  count: z.number().int(),
});

export type PopularItem = z.infer<typeof PopularItemSchema>;

export const PopularResponseSchema = z.object({
  data: z.array(PopularItemSchema),
  period_days: z.number().int(),
  cached: z.boolean(),
});

export type PopularResponse = z.infer<typeof PopularResponseSchema>;
