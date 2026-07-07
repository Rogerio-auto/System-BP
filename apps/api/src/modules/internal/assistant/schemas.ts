// =============================================================================
// internal/assistant/schemas.ts — Schemas Zod para os endpoints do copiloto
// interno (superfície B, F6-S06).
//
// Contexto: docs/22-agente-interno-acoes.md §12.2–§12.5.
//
// Regra de ouro (§12.2): o copiloto NUNCA lê com privilégio próprio.
// Cada request carrega o principal do usuário; o backend re-checa a permissão
// de domínio antes de executar qualquer query.
//
// LGPD (§12.5):
//   - Responses nunca incluem CPF (nem cifrado, nem hash).
//   - Telefone mascarado: "+CC DDD ****-XXXX".
//   - question_redacted e outros campos de auditoria ficam no log de queries
//     (assistant_queries), não aqui.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Principal do usuário — enviado pelo chamador (F6-S08 injeta a partir do JWT)
//
// Validações intencionais:
//   - permissions: array não-vazio de strings não-vazias (não valida keys do
//     catálogo aqui — isso é responsabilidade do service de autenticação).
//   - city_scope_ids: null = escopo global (admin/gestor_geral);
//     [] = sem cidade = zero resultados; [...] = filtro por IDs.
// ---------------------------------------------------------------------------
export const PrincipalSchema = z.object({
  user_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  /** Permissões efetivas do usuário no momento da chamada. */
  permissions: z.array(z.string().min(1)).min(1),
  /** null = global; [] = sem cidade; [uuid,...] = filtrado. */
  city_scope_ids: z.array(z.string().uuid()).nullable(),
});

export type Principal = z.infer<typeof PrincipalSchema>;

// ---------------------------------------------------------------------------
// Esquema comum de range de datas (espelha o padrão de reports/service.ts)
// ---------------------------------------------------------------------------
const DateRangeQuerySchema = z.object({
  range: z.enum(['today', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'custom']),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 1. POST /internal/assistant/funnel-metrics
//    Requer: dashboard:read
// ---------------------------------------------------------------------------
export const FunnelMetricsBodySchema = z.object({
  principal: PrincipalSchema,
  query: DateRangeQuerySchema.extend({
    cityIds: z.array(z.string().uuid()).optional(),
  }),
});
export type FunnelMetricsBody = z.infer<typeof FunnelMetricsBodySchema>;

export const FunnelMetricsResponseSchema = z.object({
  source: z.literal('assistant.funnel-metrics'),
  stages: z.array(
    z.object({
      stageId: z.string(),
      stageName: z.string(),
      stageOrder: z.number().int(),
      cardCount: z.number().int(),
      staleCardCount: z.number().int(),
      avgDwellHours: z.number().nullable(),
    }),
  ),
  overview: z.object({
    total: z.number().int(),
    newInPeriod: z.number().int(),
    closedWon: z.number().int(),
    closedLost: z.number().int(),
    conversionRate: z.number(),
    rangeLabel: z.string(),
  }),
});
export type FunnelMetricsResponse = z.infer<typeof FunnelMetricsResponseSchema>;

// ---------------------------------------------------------------------------
// 2. POST /internal/assistant/lead-count
//    Requer: leads:read
// ---------------------------------------------------------------------------
export const LeadCountBodySchema = z.object({
  principal: PrincipalSchema,
  query: DateRangeQuerySchema.extend({
    cityIds: z.array(z.string().uuid()).optional(),
  }),
});
export type LeadCountBody = z.infer<typeof LeadCountBodySchema>;

export const LeadCountResponseSchema = z.object({
  source: z.literal('assistant.lead-count'),
  total: z.number().int(),
  newInPeriod: z.number().int(),
  conversionRate: z.number(),
  rangeLabel: z.string(),
});
export type LeadCountResponse = z.infer<typeof LeadCountResponseSchema>;

// ---------------------------------------------------------------------------
// 3. POST /internal/assistant/analysis-status
//    Requer: analyses:read
//    PII: nome do lead mascarado (só iniciais + sobrenome); telefone não exposto.
// ---------------------------------------------------------------------------
export const AnalysisStatusBodySchema = z.object({
  principal: PrincipalSchema,
  lead_id: z.string().uuid(),
});
export type AnalysisStatusBody = z.infer<typeof AnalysisStatusBodySchema>;

export const AnalysisStatusResponseSchema = z.object({
  source: z.literal('assistant.analysis-status'),
  /** Nome mascarado: "J. Silva" — nunca nome completo. LGPD §12.5. */
  leadNameMasked: z.string().nullable(),
  analyses: z.array(
    z.object({
      id: z.string().uuid(),
      status: z.string(),
      /** Valor aprovado em BRL (null quando não aprovado) — não é PII (dado financeiro). */
      approvedAmountBrl: z.number().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AnalysisStatusResponse = z.infer<typeof AnalysisStatusResponseSchema>;

// ---------------------------------------------------------------------------
// 4. POST /internal/assistant/billing-upcoming
//    Requer: billing:read
//    Retorna snapshot de cobrança (sem PII: apenas agregados e contagens).
// ---------------------------------------------------------------------------
export const BillingUpcomingBodySchema = z.object({
  principal: PrincipalSchema,
  query: DateRangeQuerySchema,
});
export type BillingUpcomingBody = z.infer<typeof BillingUpcomingBodySchema>;

export const BillingUpcomingResponseSchema = z.object({
  source: z.literal('assistant.billing-upcoming'),
  totalDues: z.number().int(),
  overdueCount: z.number().int(),
  upcomingCount: z.number().int(),
  totalAmountBrl: z.number(),
  rangeLabel: z.string(),
});
export type BillingUpcomingResponse = z.infer<typeof BillingUpcomingResponseSchema>;
