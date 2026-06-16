// =============================================================================
// law-firms/schemas.ts — Re-exporta schemas do shared-schemas + schemas internos.
//
// Convenção de projeto: schemas públicos vivem em shared-schemas (compartilhados
// com o frontend); schemas de params e shapes internos ficam aqui.
// =============================================================================
import { z } from 'zod';

// Re-exporta schemas públicos (usados pelo frontend também)
export {
  LawFirmCreateSchema,
  LawFirmUpdateSchema,
  LawFirmResponseSchema,
  LawFirmListQuerySchema,
  LawFirmListResponseSchema,
  LawFirmSuggestResponseSchema,
} from '@elemento/shared-schemas';

export type {
  LawFirmCreate,
  LawFirmUpdate,
  LawFirmResponse,
  LawFirmListQuery,
  LawFirmListResponse,
  LawFirmSuggestResponse,
} from '@elemento/shared-schemas';

// ---------------------------------------------------------------------------
// Params internos
// ---------------------------------------------------------------------------

export const lawFirmIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type LawFirmIdParam = z.infer<typeof lawFirmIdParamSchema>;

export const lawFirmSuggestQuerySchema = z.object({
  customer_id: z.string().uuid('customer_id deve ser UUID'),
});

export type LawFirmSuggestQuery = z.infer<typeof lawFirmSuggestQuerySchema>;

// ---------------------------------------------------------------------------
// Response genérica de operação ok
// ---------------------------------------------------------------------------

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;
