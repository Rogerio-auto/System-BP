// =============================================================================
// leads/schemas.ts — Re-exporta e adapta schemas do shared-schemas para a API.
//
// Separa o que é exposto publicamente (shared-schemas) do que é interno à API
// (ex: incluir campos de response do banco como Date vs string).
//
// LGPD (doc 17 §8.1):
//   phone_e164 e email são PII. Cobertos por pino.redact na app.ts.
//   cpf_hash NUNCA retorna para o cliente. cpf bruto nunca persiste.
// =============================================================================

// Re-exporta os schemas públicos (usados pelo frontend também)
export {
  LeadCreateBaseSchema,
  LeadCreateSchema,
  LeadUpdateSchema,
  LeadResponseSchema,
  LeadListQuerySchema,
  LeadListResponseSchema,
  LeadSourceSchema,
  LeadStatusSchema,
  normalizePhone,
} from '@elemento/shared-schemas';

export type {
  LeadCreate,
  LeadUpdate,
  LeadResponse,
  LeadListQuery,
  LeadListResponse,
  LeadSource,
  LeadStatus,
} from '@elemento/shared-schemas';

// ---------------------------------------------------------------------------
// Param schema (interno — usado nas rotas)
// ---------------------------------------------------------------------------
import { z } from 'zod';

export const leadIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type LeadIdParam = z.infer<typeof leadIdParamSchema>;

// ---------------------------------------------------------------------------
// Timeline de interações (F13-S07)
//
// Shape consumido pelo front (apps/web/src/hooks/crm/types.ts → LeadInteraction).
// LGPD: `content` pode conter PII de conversa — exibido apenas ao agente
// autorizado (city-scope no service); coberto por pino.redact nos logs (app.ts).
// ---------------------------------------------------------------------------

export const LeadInteractionResponseSchema = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  type: z.enum(['note', 'status_change', 'call', 'whatsapp', 'system']),
  content: z.string(),
  actorName: z.string(),
  createdAt: z.string().datetime(),
});

export const LeadInteractionsResponseSchema = z.array(LeadInteractionResponseSchema);

export type LeadInteractionResponse = z.infer<typeof LeadInteractionResponseSchema>;
