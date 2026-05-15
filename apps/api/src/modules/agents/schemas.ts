// =============================================================================
// agents/schemas.ts — Schemas Zod para o módulo de agentes (F8-S01).
//
// Agentes de crédito: funcionários humanos do Banco do Povo que atendem leads
// em uma ou mais cidades.
//
// Validações críticas:
//   - displayName: 2-120 chars, obrigatório.
//   - phone: E.164 via normalizePhone (opcional).
//   - cityIds: array de UUID, ao menos 1 na criação.
//   - primaryCityId: deve estar em cityIds quando informado.
//
// LGPD: phone do agente é dado pessoal de colaborador (art. 7°, IX).
//   Não é exposto ao lead/cliente — dado interno de gestão.
//   Redact via pino configurado em app.ts.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const agentIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type AgentIdParam = z.infer<typeof agentIdParamSchema>;

// ---------------------------------------------------------------------------
// City summary — embutido nas responses de agente
// ---------------------------------------------------------------------------

export const AgentCitySummarySchema = z.object({
  city_id: z.string().uuid(),
  is_primary: z.boolean(),
});

export type AgentCitySummary = z.infer<typeof AgentCitySummarySchema>;

// ---------------------------------------------------------------------------
// Response schema — agente com cidades
// ---------------------------------------------------------------------------

export const AgentResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  display_name: z.string(),
  /** phone: LGPD — dado de colaborador, não exposto ao lead. */
  phone: z.string().nullable(),
  is_active: z.boolean(),
  cities: z.array(AgentCitySummarySchema),
  primary_city_id: z.string().uuid().nullable(),
  city_count: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});

export type AgentResponse = z.infer<typeof AgentResponseSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export const AgentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cityId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  /** Busca por display_name via ilike. */
  q: z.string().max(200).optional(),
});

export type AgentListQuery = z.infer<typeof AgentListQuerySchema>;

export const AgentListResponseSchema = z.object({
  data: z.array(AgentResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const AgentCreateSchema = z
  .object({
    displayName: z
      .string()
      .min(2, 'displayName deve ter ao menos 2 caracteres')
      .max(120, 'displayName deve ter no máximo 120 caracteres'),
    /** E.164 normalizado pelo serviço. Opcional. */
    phone: z.string().max(30).optional(),
    /** FK opcional para users — validado no serviço (mesmo org). */
    userId: z.string().uuid('userId deve ser UUID').optional(),
    cityIds: z
      .array(z.string().uuid('cada cityId deve ser UUID'))
      .min(1, 'Ao menos uma cidade é obrigatória'),
    /** Deve estar em cityIds. Se omitido, usa o primeiro de cityIds. */
    primaryCityId: z.string().uuid('primaryCityId deve ser UUID').optional(),
  })
  .refine((data) => data.primaryCityId === undefined || data.cityIds.includes(data.primaryCityId), {
    message: 'primaryCityId deve estar em cityIds',
    path: ['primaryCityId'],
  });

export type AgentCreate = z.infer<typeof AgentCreateSchema>;

// ---------------------------------------------------------------------------
// Update (PATCH)
// ---------------------------------------------------------------------------

export const AgentUpdateSchema = z
  .object({
    displayName: z
      .string()
      .min(2, 'displayName deve ter ao menos 2 caracteres')
      .max(120, 'displayName deve ter no máximo 120 caracteres')
      .optional(),
    phone: z.string().max(30).nullable().optional(),
    userId: z.string().uuid('userId deve ser UUID').nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Ao menos um campo deve ser informado',
  });

export type AgentUpdate = z.infer<typeof AgentUpdateSchema>;

// ---------------------------------------------------------------------------
// Set cities (PUT /agents/:id/cities)
// ---------------------------------------------------------------------------

export const AgentSetCitiesSchema = z
  .object({
    cityIds: z
      .array(z.string().uuid('cada cityId deve ser UUID'))
      .min(1, 'Ao menos uma cidade é obrigatória'),
    primaryCityId: z.string().uuid('primaryCityId deve ser UUID').optional(),
  })
  .refine((data) => data.primaryCityId === undefined || data.cityIds.includes(data.primaryCityId), {
    message: 'primaryCityId deve estar em cityIds',
    path: ['primaryCityId'],
  });

export type AgentSetCities = z.infer<typeof AgentSetCitiesSchema>;

// ---------------------------------------------------------------------------
// Deactivate/Reactivate — sem body
// ---------------------------------------------------------------------------

export const AgentDeactivateResponseSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
  deleted_at: z.string().nullable(),
});

export type AgentDeactivateResponse = z.infer<typeof AgentDeactivateResponseSchema>;
