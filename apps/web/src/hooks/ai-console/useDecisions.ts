// =============================================================================
// hooks/ai-console/useDecisions.ts — TanStack Query hooks para ai_decision_logs.
//
// Consome API F9-S02:
//   GET /api/ai-console/decisions?cursor=&limit=&date_from=&date_to=
//       &conversation_id=&lead_id=&intent=&node=&model=
//   GET /api/ai-console/decisions/conversations/:conversationId
//
// LGPD (doc 17):
//   - Decisões chegam com dados mascarados pelo backend — UI não tenta de-mask.
//   - Nunca logar decision/context/PII em console.
//   - Campos: tokens_in, tokens_out, cost_usd, cost_brl, model, intent,
//     prompt_version, node_name, latency_ms, error, decision (jsonb mascarado),
//     created_at, conversation_id, lead_id, chatwoot_conversation_id.
// =============================================================================

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '../../lib/api';

// ─── Schemas Zod ─────────────────────────────────────────────────────────────

/**
 * Uma entrada individual de ai_decision_logs.
 * `decision` é jsonb mascarado pelo backend — tratado como unknown para evitar
 * de-mask acidental.
 */
const DecisionItemSchema = z.object({
  id: z.string().uuid(),
  conversation_id: z.string().nullable(),
  lead_id: z.string().uuid().nullable(),
  node_name: z.string(),
  intent: z.string().nullable(),
  model: z.string().nullable(),
  prompt_version: z.number().int().positive().nullable(),
  tokens_in: z.number().int().nonnegative().nullable(),
  tokens_out: z.number().int().nonnegative().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  cost_brl: z.number().nonnegative().nullable(),
  latency_ms: z.number().int().nonnegative().nullable(),
  /** jsonb mascarado: pode ser qualquer estrutura — não expor em logs */
  decision: z.unknown().nullable(),
  error: z.string().nullable(),
  chatwoot_conversation_id: z.number().int().positive().nullable(),
  created_at: z.string().datetime(),
});

const DecisionsListResponseSchema = z.object({
  data: z.array(DecisionItemSchema),
  next_cursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
});

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type DecisionItem = z.infer<typeof DecisionItemSchema>;
export type DecisionsListResponse = z.infer<typeof DecisionsListResponseSchema>;

export interface DecisionFilters {
  date_from?: string;
  date_to?: string;
  conversation_id?: string;
  lead_id?: string;
  intent?: string;
  node?: string;
  model?: string;
  cursor?: string;
  limit?: number;
}

// ─── Query keys ──────────────────────────────────────────────────────────────

export const decisionsQueryKeys = {
  all: ['ai-console', 'decisions'] as const,
  list: (filters: DecisionFilters) => [...decisionsQueryKeys.all, 'list', filters] as const,
  timeline: (conversationId: string) =>
    [...decisionsQueryKeys.all, 'timeline', conversationId] as const,
} as const;

// ─── Fetch helpers ────────────────────────────────────────────────────────────

function buildListQs(filters: DecisionFilters): string {
  const params = new URLSearchParams();

  if (filters.date_from) params.set('date_from', filters.date_from);
  if (filters.date_to) params.set('date_to', filters.date_to);
  if (filters.conversation_id) params.set('conversation_id', filters.conversation_id);
  if (filters.lead_id) params.set('lead_id', filters.lead_id);
  if (filters.intent) params.set('intent', filters.intent);
  if (filters.node) params.set('node', filters.node);
  if (filters.model) params.set('model', filters.model);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function fetchDecisionsList(filters: DecisionFilters): Promise<DecisionsListResponse> {
  const qs = buildListQs(filters);
  const raw = await api.get<unknown>(`/api/ai-console/decisions${qs}`);
  return DecisionsListResponseSchema.parse(raw);
}

async function fetchConversationTimeline(conversationId: string): Promise<DecisionItem[]> {
  const raw = await api.get<unknown>(
    `/api/ai-console/decisions/conversations/${encodeURIComponent(conversationId)}`,
  );
  return z.array(DecisionItemSchema).parse(raw);
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/**
 * Lista de decisões com filtros e paginação cursor-based.
 * LGPD: dados chegam mascarados do backend — não logar decision/context.
 */
export function useDecisionsList(filters: DecisionFilters): {
  data: DecisionsListResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: decisionsQueryKeys.list(filters),
    queryFn: () => fetchDecisionsList(filters),
    staleTime: 15_000,
  });

  return { data, isLoading, isError, error };
}

/**
 * Timeline cronológica de decisões de uma conversa específica.
 * Habilitado apenas quando conversationId não for vazio.
 */
export function useConversationTimeline(conversationId: string): {
  decisions: DecisionItem[];
  isLoading: boolean;
  isError: boolean;
} {
  const { data, isLoading, isError } = useQuery({
    queryKey: decisionsQueryKeys.timeline(conversationId),
    queryFn: () => fetchConversationTimeline(conversationId),
    enabled: conversationId.length > 0,
    staleTime: 15_000,
  });

  return { decisions: data ?? [], isLoading, isError };
}
