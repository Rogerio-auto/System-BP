// =============================================================================
// internal/customers/schemas.ts — Schemas Zod para GET /internal/customers/:id/context.
//
// Canal M2M: consumido pela tool `get_customer_context` (F3-S20, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// LGPD (doc 06 §7.6 + doc 17 §3.4):
//   - A resposta é uma "ficha resumida" — propositalmente limitada.
//   - NÃO retorna CPF, RG, phone, email, document_number, document_hash.
//   - NÃO retorna notes do lead (texto livre que pode conter PII).
//   - Retorna apenas: nome (display), cidade (nome), agente (nome de exibição),
//     último estágio kanban, última simulação (valores financeiros — não PII),
//     última análise (status + datas — não implementada até criação de credit_analyses),
//     contagem de mensagens nos últimos 30 dias.
//   - Todos os IDs retornados são opacos (UUIDs).
//   - O campo `name` é PII (art. 5 LGPD). Retornado por necessidade (doc 06 §7.6):
//     o grafo personaliza a conversa com o nome do lead. Base legal: legítimo interesse
//     da operação (doc 17 §3.3 item 1). Coberto por pino.redact em app.ts.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const CustomerContextParamsSchema = z.object({
  /**
   * UUID do lead ou customer a ser consultado.
   * A interpretação depende do query param `type`.
   */
  id: z.string().uuid('id deve ser UUID'),
});

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const CustomerContextQuerySchema = z.object({
  /**
   * Tipo da entidade referenciada pelo :id.
   * 'lead'     — id refere-se a leads.id (padrão — uso mais comum pelo LangGraph).
   * 'customer' — id refere-se a customers.id.
   * Default: 'lead'.
   */
  type: z.enum(['lead', 'customer']).default('lead'),
});

// ---------------------------------------------------------------------------
// Response — ficha resumida (doc 06 §7.6)
// ---------------------------------------------------------------------------

/**
 * Ficha da última simulação de crédito (dados financeiros, não PII).
 * Retorna apenas campos necessários para o grafo personalizar a proposta.
 * NÃO retorna: amortization_table (desnecessário para contexto), rate_monthly_snapshot,
 * total_interest (campos de detalhe que o grafo não precisa).
 */
const LastSimulationSchema = z.object({
  /** UUID da simulação (opaco). */
  simulation_id: z.string().uuid(),

  /** Valor solicitado em reais (ex: "2000.00"). Dado financeiro — não PII. */
  amount_requested: z.string(),

  /** Prazo em meses. Dado financeiro — não PII. */
  term_months: z.number().int(),

  /** Valor da parcela mensal calculada. Dado financeiro — não PII. */
  monthly_payment: z.string(),

  /** ISO 8601 — quando a simulação foi criada. */
  created_at: z.string(),

  /** ISO 8601 — quando foi enviada ao cliente. null = ainda não enviada. */
  sent_at: z.string().nullable(),
});

/**
 * Ficha da última análise de crédito.
 * Implementada como stub (null) enquanto a tabela credit_analyses não existe.
 * Quando F4+ implementar credit_analyses, este schema será expandido.
 * Retorna apenas status e datas — sem parecer textual ou dados financeiros sensíveis.
 * (doc 06 §7.6: "somente status e datas"; doc 17 §3.4: "analyses:read + escopo de cidade")
 */
const LastAnalysisSchema = z.object({
  /** UUID da análise (opaco). */
  analysis_id: z.string().uuid(),

  /** Status da análise (ex: 'pending', 'approved', 'rejected'). */
  status: z.string(),

  /** ISO 8601 — quando a análise foi criada. */
  created_at: z.string(),

  /** ISO 8601 — quando a análise foi concluída. null = em andamento. */
  concluded_at: z.string().nullable(),
});

export const CustomerContextResponseSchema = z.object({
  /**
   * UUID do lead.
   * Sempre presente — customer referencia um lead como fonte de verdade.
   */
  lead_id: z.string().uuid(),

  /**
   * UUID do customer (se o lead já foi convertido).
   * null = lead ainda não convertido em customer (sem CPF coletado).
   */
  customer_id: z.string().uuid().nullable(),

  /**
   * Nome de exibição do lead.
   * LGPD: PII — retornado por necessidade operacional (personalização da conversa,
   * doc 06 §7.6). Coberto por pino.redact em app.ts. Base legal: legítimo interesse
   * do tratamento (doc 17 §3.3 item 1).
   * Não retornar em logs, outbox ou eventos.
   */
  name: z.string(),

  /**
   * Nome da cidade do lead.
   * null = cidade ainda não identificada (fase pré-identify_city).
   * Dado público — não é PII.
   */
  city_name: z.string().nullable(),

  /**
   * Nome de exibição do agente responsável.
   * null = lead ainda não atribuído.
   * Dado interno — não exposto para leads/clientes.
   */
  agent_name: z.string().nullable(),

  /**
   * Nome do estágio kanban atual.
   * null = lead sem kanban card (situação transitória pós-criação).
   * Dado operacional — não é PII.
   */
  current_stage: z.string().nullable(),

  /**
   * Status CRM do lead.
   * Enum: 'new' | 'qualifying' | 'simulation' | 'closed_won' | 'closed_lost' | 'archived'.
   */
  lead_status: z.string(),

  /**
   * Ficha resumida da última simulação.
   * null = nenhuma simulação realizada ainda.
   * Dados financeiros — não PII (doc 17 §3.4: "crédito_simulations: renda, valor, prazo").
   */
  last_simulation: LastSimulationSchema.nullable(),

  /**
   * Ficha resumida da última análise de crédito.
   * null = nenhuma análise realizada (ou tabela credit_analyses ainda não implementada em F4).
   * Retorna apenas status e datas — sem parecer textual (doc 06 §7.6 + doc 17 §3.4).
   */
  last_analysis: LastAnalysisSchema.nullable(),

  /**
   * Número de mensagens (interações) nos últimos 30 dias.
   * Contagem agrega todas as interações (inbound + outbound) do lead.
   * Dado operacional — não é PII.
   */
  messages_last_30_days: z.number().int().nonnegative(),
});

export type CustomerContextResponse = z.infer<typeof CustomerContextResponseSchema>;
