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
  // A carteira de cobrança é um snapshot de estado atual (mv_reports_collection não tem
  // dimensão temporal) — por isso NÃO aceita range/datas: prometer um filtro que não é
  // honrado induziria o copiloto ao erro (review F6-S06 M-1). O único filtro suportado é cidade.
  query: z.object({ cityIds: z.array(z.string().uuid()).optional() }).optional(),
});
export type BillingUpcomingBody = z.infer<typeof BillingUpcomingBodySchema>;

export const BillingUpcomingResponseSchema = z.object({
  source: z.literal('assistant.billing-upcoming'),
  totalDues: z.number().int(),
  overdueCount: z.number().int(),
  upcomingCount: z.number().int(),
  totalAmountBrl: z.number(),
  /** Snapshot atual da carteira — não é um período de tempo (review F6-S06 M-1). */
  snapshotLabel: z.string(),
});
export type BillingUpcomingResponse = z.infer<typeof BillingUpcomingResponseSchema>;

// ---------------------------------------------------------------------------
// 5. POST /internal/assistant/lead-conversation
//    Requer: livechat:conversation:read
//    LGPD (§12.5, doc 17 §8.1/§8.3): messages[].content É PII (texto livre do
//    contato/agente). Nunca logar (pino.redact cobre `*.content` em app.ts).
//    Sem telefone/CPF em campo separado — a DLP do gateway LangGraph (F6-S14,
//    dlp=True) redige o texto antes do LLM.
// ---------------------------------------------------------------------------
export const LeadConversationBodySchema = z.object({
  principal: PrincipalSchema,
  lead_id: z.string().uuid(),
});
export type LeadConversationBody = z.infer<typeof LeadConversationBodySchema>;

/** Direção da mensagem: in = recebida do contato; out = enviada pelo agente/sistema. */
export const MessageDirectionSchema = z.enum(['in', 'out']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const LeadConversationResponseSchema = z.object({
  source: z.literal('assistant.lead-conversation'),
  lead_id: z.string().uuid(),
  messages: z.array(
    z.object({
      direction: MessageDirectionSchema,
      /** Texto da mensagem — PII. Nunca logar. DLP do gateway (F6-S14) redige antes do LLM. */
      content: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  /** true se a conversa tinha mais de N=100 mensagens e a lista foi cortada. */
  truncated: z.boolean(),
});
export type LeadConversationResponse = z.infer<typeof LeadConversationResponseSchema>;

// ---------------------------------------------------------------------------
// 6. POST /internal/assistant/lead-search
//    Requer: leads:read
//    Contexto (docs/22-agente-interno-acoes.md §12): resolve "resuma a conversa
//    da Maria" → lead_id, com desambiguação de homônimos.
//
//    LGPD (minimização, doc 17 §8.1/§14.2): o `name` de busca É PII (texto
//    livre informado pelo usuário) — nunca logado (ver comentário em routes.ts
//    e nota de escopo no service.ts). A response devolve APENAS lead_id/name/
//    city_name — o mínimo para o usuário desambiguar homônimos. NUNCA
//    telefone, CPF ou e-mail.
// ---------------------------------------------------------------------------
export const LeadSearchBodySchema = z.object({
  principal: PrincipalSchema,
  /** Nome (ou parte do nome) do lead a buscar. PII — nunca logar. */
  name: z.string().min(2),
});
export type LeadSearchBody = z.infer<typeof LeadSearchBodySchema>;

export const LeadSearchResponseSchema = z.object({
  source: z.literal('assistant.lead-search'),
  candidates: z.array(
    z.object({
      lead_id: z.string().uuid(),
      /** Nome do lead — PII mínima necessária para o usuário desambiguar homônimos. */
      name: z.string(),
      /** null quando o lead não tem cidade atribuída. */
      city_name: z.string().nullable(),
    }),
  ),
  /** true se havia mais candidatos que o limite e a lista foi cortada — força refinar a busca. */
  truncated: z.boolean(),
});
export type LeadSearchResponse = z.infer<typeof LeadSearchResponseSchema>;
