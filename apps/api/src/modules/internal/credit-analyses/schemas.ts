// =============================================================================
// internal/credit-analyses/schemas.ts — Schemas Zod para GET /internal/customers/:id/credit-analyses.
//
// Canal M2M: consumido pela tool `get_credit_analysis_history` (F4-S04, LangGraph).
// Não usa JWT — autenticação via X-Internal-Token.
//
// LGPD (doc 17 §3.4 + Art. 6º III — Minimização):
//   A resposta é mascarada por design — expõe APENAS dados necessários para o
//   grafo responder ao cliente sobre o status da análise.
//
//   NUNCA retorna:
//     - parecer_text      (texto interno do analista — protegido por RBAC)
//     - pendencias        (lista interna de documentos faltantes)
//     - attachments       (metadados de arquivos — acesso interno)
//     - internal_score    (pontuação de risco — gated por feature flag)
//     - analyst_user_id   (identifica o analista — dado interno)
//     - approved_amount   (valor aprovado — restrito ao assistente interno, slot futuro F6)
//     - approved_term_months (prazo aprovado — idem)
//     - approved_rate_monthly (taxa aprovada — idem)
//
//   Retorna SOMENTE: analysis_id (UUID opaco), status, created_at, updated_at,
//   current_version_number.
//
//   Defesa em profundidade: mesmo com prompt injection, IA não obtém parecer
//   porque o backend simplesmente não expõe (não é redação no cliente).
//
// Endpoint path:
//   GET /:id/credit-analyses (prefixo /internal/customers aplicado em internal/index.ts)
//   → path final: GET /internal/customers/:id/credit-analyses
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const CreditAnalysisHistoryParamsSchema = z.object({
  /**
   * UUID do lead a ser consultado.
   * Endpoint sempre resolve por lead — o grafo sempre tem o lead_id disponível.
   */
  id: z.string().uuid('id deve ser UUID'),
});

// ---------------------------------------------------------------------------
// Response — lista mascarada (F4-S04)
// ---------------------------------------------------------------------------

/**
 * Item de análise mascarado — somente campos necessários para o grafo.
 *
 * Campos propositalmente OMITIDOS (LGPD Art. 6º III — minimização):
 *   - parecer_text: texto interno do analista
 *   - pendencias: lista de pendências documentais
 *   - attachments: metadados de arquivos
 *   - internal_score: pontuação de risco
 *   - analyst_user_id: identificação do analista
 *   - approved_amount / approved_term_months / approved_rate_monthly:
 *     dados de aprovação — restritos ao assistente interno (slot futuro F6)
 *
 * `current_version_number` indica quantas revisões ocorreram (≥1 quando há versão,
 * 0 quando a análise ainda não tem parecer registrado).
 */
const AnalysisItemSchema = z.object({
  /** UUID opaco da análise. */
  analysis_id: z.string().uuid(),

  /**
   * Status agregado da análise.
   * Espelha credit_analyses.status — não requer JOIN com versões.
   */
  status: z.enum(['em_analise', 'pendente', 'aprovado', 'recusado', 'cancelado']),

  /**
   * Número da versão atual (0 = sem parecer ainda).
   * Calculado via SELECT MAX(version) FROM credit_analysis_versions WHERE analysis_id = $1.
   * Permite ao grafo detectar se houve atualização sem expor o conteúdo.
   */
  current_version_number: z.number().int().nonnegative(),

  /** ISO 8601 — quando a análise foi criada. */
  created_at: z.string().datetime(),

  /** ISO 8601 — última atualização da análise (trigger set_updated_at). */
  updated_at: z.string().datetime(),
});

export const CreditAnalysisHistoryResponseSchema = z.object({
  /**
   * UUID do lead consultado.
   * Permite ao caller verificar que a resposta corresponde ao lead solicitado.
   */
  lead_id: z.string().uuid(),

  /**
   * Lista de análises mascaradas em ordem cronológica inversa (mais recente primeiro).
   * Vazia quando nenhuma análise existe para o lead na organização.
   */
  items: z.array(AnalysisItemSchema),
});

export type CreditAnalysisHistoryResponse = z.infer<typeof CreditAnalysisHistoryResponseSchema>;
export type AnalysisItem = z.infer<typeof AnalysisItemSchema>;
