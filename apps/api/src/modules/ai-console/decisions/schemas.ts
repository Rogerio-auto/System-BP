// =============================================================================
// ai-console/decisions/schemas.ts — Schemas Zod do módulo ai_decision_logs (F9-S02).
//
// Valida todas as bordas HTTP (query params + responses).
//
// LGPD (doc 17 §8.4):
//   - decision jsonb nunca expõe PII bruta — masking aplicado no service.
//   - Logs nunca expõem PII — apenas correlation_id e decision_id.
//
// Rotas cobertas:
//   GET /api/ai-console/decisions          — lista paginada (cursor)
//   GET /api/ai-console/decisions/timeline — timeline de uma conversa
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Item de decisão — resposta serializada por decisão
// ---------------------------------------------------------------------------

/**
 * DTO de uma decisão de IA (ai_decision_logs) na resposta da API.
 *
 * LGPD: campo `decision` já foi mascarado pelo service antes de serializar.
 * cost_usd / cost_brl: null quando o modelo não tem entry em model_pricing.
 */
export const decisionItemSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  lead_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid().nullable(),
  node_name: z.string(),
  intent: z.string().nullable(),
  prompt_key: z.string().nullable(),
  prompt_version: z.string().nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nullable(),
  tokens_out: z.number().int().nullable(),
  latency_ms: z.number().int().nullable(),
  /** Output estruturado do nó — mascarado de PII antes de serializar. */
  decision: z.record(z.unknown()),
  error: z.string().nullable(),
  correlation_id: z.string().uuid(),
  /** Custo em USD. null = modelo sem entry em model_pricing. */
  cost_usd: z.number().nullable(),
  /** Custo em BRL (custo_usd * FX). null = modelo sem entry em model_pricing. */
  cost_brl: z.number().nullable(),
  created_at: z.string().datetime(),
});

export type DecisionItem = z.infer<typeof decisionItemSchema>;

// ---------------------------------------------------------------------------
// Query params — listagem paginada (cursor-based)
// ---------------------------------------------------------------------------

/**
 * Query params do endpoint GET /api/ai-console/decisions.
 *
 * Cursor-based pagination determinística:
 *   cursor = ISO timestamp do último registro retornado (exclusive upper/lower bound).
 *   Combinado com id_cursor (UUID) para desempate — garante página estável mesmo
 *   com decisões no mesmo segundo.
 *
 * Filtros opcionais:
 *   conversation_id — filtra por conversa específica (timeline via lista).
 *   lead_id         — filtra por lead específico.
 *   node_name       — filtra por nó LangGraph.
 */
export const listDecisionsQuerySchema = z.object({
  /** UUID da conversa — filtra por timeline de uma conversa. */
  conversation_id: z.string().uuid().optional(),
  /** UUID do lead — filtra por lead específico. */
  lead_id: z.string().uuid().optional(),
  /** Nome do nó LangGraph (ex: "classify_intent"). */
  node_name: z.string().max(120).optional(),
  /**
   * Cursor de paginação — ISO timestamp (exclusive) da última entrada retornada.
   * Para "próxima página": passar o `next_cursor` da resposta anterior.
   */
  cursor: z.string().datetime().optional(),
  /**
   * UUID cursor de desempate para registros com o mesmo created_at.
   * Obrigatório quando `cursor` está presente.
   */
  id_cursor: z.string().uuid().optional(),
  /** Número máximo de itens por página (1–100, default 50). */
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListDecisionsQuery = z.infer<typeof listDecisionsQuerySchema>;

// ---------------------------------------------------------------------------
// Query params — timeline de uma conversa
// ---------------------------------------------------------------------------

/**
 * Query params do endpoint GET /api/ai-console/decisions/timeline.
 * Obrigatório: conversation_id.
 * Retorna todos os nós em ordem cronológica, sem paginação (conversas têm ≤ 50 nós).
 */
export const timelineQuerySchema = z.object({
  conversation_id: z.string().uuid(),
});

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

// ---------------------------------------------------------------------------
// Respostas
// ---------------------------------------------------------------------------

/** Resposta paginada da listagem. */
export const listDecisionsResponseSchema = z.object({
  data: z.array(decisionItemSchema),
  /**
   * Cursor para a próxima página.
   * null = última página (sem mais registros).
   * Passar como `?cursor=<next_cursor>` na próxima request.
   */
  next_cursor: z.string().datetime().nullable(),
  /**
   * UUID do último item retornado (desempate de cursor).
   * Passar como `?id_cursor=<next_id_cursor>` com `cursor`.
   */
  next_id_cursor: z.string().uuid().nullable(),
  total_on_page: z.number().int(),
});

export type ListDecisionsResponse = z.infer<typeof listDecisionsResponseSchema>;

/** Resposta da timeline de uma conversa — array simples, sem paginação. */
export const timelineResponseSchema = z.object({
  conversation_id: z.string().uuid(),
  data: z.array(decisionItemSchema),
  total: z.number().int(),
});

export type TimelineResponse = z.infer<typeof timelineResponseSchema>;
