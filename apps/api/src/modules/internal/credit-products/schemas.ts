// =============================================================================
// internal/credit-products/schemas.ts — Schemas Zod para GET /internal/credit-products.
//
// Canal M2M: consumido pela tool `list_credit_products` (LangGraph, F3-S15).
// Não usa JWT — autenticação via X-Internal-Token.
//
// Payload restrito (doc 06 §5.6):
//   Sem campos internos sensíveis: sem organization_id, sem created_by,
//   sem effective_from/effective_to, sem version, sem is_active da regra,
//   sem deleted_at, sem key.
//   A IA precisa apenas dos dados financeiros para montar a simulação.
//
// LGPD: nenhum campo contém PII (só IDs opacos, taxas, prazos, limites).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export const InternalCreditProductsQuerySchema = z.object({
  /**
   * UUID da organização (multi-tenant). Obrigatório semanticamente — sem ele,
   * o endpoint retorna lista vazia sem erro (proteção cross-tenant graciosa).
   * Opcional no schema Zod para evitar 400: a rota trata a ausência como []
   * e jamais consulta o banco sem este parâmetro.
   */
  organizationId: z.string().uuid('organizationId deve ser UUID').optional(),

  /**
   * UUID da cidade. Quando informado, filtra apenas os produtos cuja regra ativa
   * tem cityScope contendo essa cidade OU cityScope nulo (produto global).
   * Sem cityId, retorna todos os produtos ativos independente de escopo de cidade.
   */
  cityId: z.string().uuid('cityId deve ser UUID').optional(),
});

export type InternalCreditProductsQuery = z.infer<typeof InternalCreditProductsQuerySchema>;

// ---------------------------------------------------------------------------
// Response — campos seguros para a IA (doc 06 §5.6)
// ---------------------------------------------------------------------------

/**
 * Item individual de produto de crédito retornado para a IA.
 *
 * Campos incluídos:
 *   - id: identificador para passar na simulação.
 *   - name: nome legível para apresentar ao cliente.
 *   - min_amount / max_amount: limites de valor (decimais como string do banco).
 *   - min_term / max_term: prazos em meses.
 *   - interest_rate: taxa mensal decimal (ex: "0.025000" = 2,5% ao mês).
 *   - amortization_type: "price" | "sac".
 *
 * Campos EXCLUÍDOS propositalmente:
 *   - organization_id: não relevante para a IA.
 *   - key: campo interno de slug.
 *   - description: pode conter texto administrativo inadequado para LLM.
 *   - created_at / updated_at / deleted_at: metadados internos.
 *   - active_rule.version / created_by / effective_from / effective_to / is_active:
 *     detalhes de versionamento internos, sem valor para a ferramenta de simulação.
 *   - city_scope: a IA não precisa saber quais cidades — o filtro já foi aplicado.
 *   - iof_rate: calculado pelo motor de simulação, não pela IA.
 */
export const InternalCreditProductItemSchema = z.object({
  /** UUID do produto — passado na tool `generate_credit_simulation`. */
  id: z.string().uuid(),

  /** Nome do produto para apresentação ao cliente. */
  name: z.string(),

  /**
   * Valor mínimo liberado (string decimal, ex: "500.00").
   * String preserva precisão decimal do banco (numeric).
   */
  min_amount: z.string(),

  /**
   * Valor máximo liberado (string decimal, ex: "15000.00").
   */
  max_amount: z.string(),

  /** Prazo mínimo em meses. */
  min_term: z.number().int(),

  /** Prazo máximo em meses. */
  max_term: z.number().int(),

  /**
   * Taxa mensal decimal (ex: "0.025000" = 2,5% ao mês).
   * String preserva precisão decimal do banco (numeric).
   */
  interest_rate: z.string(),

  /** Sistema de amortização: "price" (tabela Price) ou "sac". */
  amortization_type: z.enum(['price', 'sac']),
});

export type InternalCreditProductItem = z.infer<typeof InternalCreditProductItemSchema>;

export const InternalCreditProductsResponseSchema = z.object({
  data: z.array(InternalCreditProductItemSchema),
});

export type InternalCreditProductsResponse = z.infer<typeof InternalCreditProductsResponseSchema>;
