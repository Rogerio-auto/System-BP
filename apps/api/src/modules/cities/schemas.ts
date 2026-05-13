// =============================================================================
// cities/schemas.ts — Re-exporta schemas do shared-schemas para a API (F1-S06).
//
// Separa o que é exposto publicamente (shared-schemas) do que é interno à API.
// =============================================================================

export {
  CityCreateSchema,
  CityUpdateSchema,
  CityResponseSchema,
  CityListQuerySchema,
  CityListResponseSchema,
  CityPublicListResponseSchema,
} from '@elemento/shared-schemas';

export type {
  CityCreate,
  CityUpdate,
  CityResponse,
  CityListQuery,
  CityListResponse,
  CityPublic,
} from '@elemento/shared-schemas';

// ---------------------------------------------------------------------------
// Param schema (interno — usado nas rotas)
// ---------------------------------------------------------------------------
import { z } from 'zod';

export const cityIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type CityIdParam = z.infer<typeof cityIdParamSchema>;
