// =============================================================================
// hooks/ai-console/usePlayground.ts — TanStack Query mutation para playground.
//
// Consome API F9-S04:
//   POST /api/ai-console/playground
//   Body: { message, lead_id?, city_id?, use_real_context }
//   Response: {
//     reply, trace, prompt_versions_used, tokens_total,
//     latency_ms, errors, dlp_applied, dlp_tokens
//   }
//
// Permissão exigida: ai_playground:run (admin-only).
//
// LGPD (doc 17):
//   - message nunca vai para console — pode conter PII do operador
//   - reply/trace mascarados pelo backend — UI não tenta de-mask
//   - dlp_tokens são labels de máscaras (ex: <CPF_1>) — seguros de exibir
// =============================================================================

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';

import { api } from '../../lib/api';

// ─── Schemas Zod ─────────────────────────────────────────────────────────────

/**
 * Um nó do trace do grafo retornado pelo playground.
 *
 * Schema **espelha** `traceEntrySchema` em `apps/api/src/modules/ai-console/playground/schemas.ts`
 * — qualquer mudança aqui exige mudança no backend (e vice-versa).
 *
 * Notas:
 * - `prompt_version` é STRING no formato `"<key>@v<N>"` (ex.: `"intent_classifier@v3"`)
 *   — não é número. A UI exibe direto, sem prefixo "v".
 * - O trace NÃO tem campo `error` por entry. Erros vão em `errors[]` no nível raiz
 *   da response (objetos `{node, error}`); a UI cruza pelo nome do node se quiser
 *   marcar entries com falha.
 * - `intercepted_method`/`intercepted_path` aparecem em entries `dry_run_sink` —
 *   indicam chamadas POST/PATCH/PUT que seriam reais em produção.
 */
export const PlaygroundTraceNodeSchema = z.object({
  node: z.string(),
  dry_run: z.boolean().default(true),
  intent: z.string().nullable().default(null),
  prompt_version: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  tokens_in: z.number().int().nonnegative().nullable().default(null),
  tokens_out: z.number().int().nonnegative().nullable().default(null),
  latency_ms: z.number().nonnegative().nullable().default(null),
  intercepted_method: z.string().nullable().default(null),
  intercepted_path: z.string().nullable().default(null),
  idempotency_key: z.string().nullable().default(null),
});

/**
 * Response do `POST /api/ai-console/playground`.
 *
 * Schema **espelha** `playgroundResponseSchema` no backend (F9-S04). Mantenha em
 * sincronia — drift quebra o `PlaygroundResponseSchema.parse(raw)` na UI com
 * `invalid_type` em runtime (sem tipagem em tempo de build).
 */
export const PlaygroundResponseSchema = z.object({
  trace_id: z.string().uuid(),
  dry_run: z.literal(true),
  // Resposta da IA — `reply_type` indica se há reply ("text"/"none"); `reply_content`
  // tem o texto que seria enviado ao cliente em produção.
  reply_type: z.string(),
  reply_content: z.string().default(''),
  handoff_required: z.boolean(),
  handoff_reason: z.string().nullable().default(null),
  // Trace + métricas
  trace: z.array(PlaygroundTraceNodeSchema).default([]),
  prompt_versions_used: z.array(z.string()).default([]),
  tokens_total: z.number().int().nonnegative().default(0),
  graph_version: z.string(),
  latency_ms: z.number().int().nonnegative(),
  // Erros são objetos opacos `{node, error, ...}` — UI renderiza chave a chave.
  errors: z.array(z.record(z.string(), z.unknown())).default([]),
  // DLP
  dlp_applied: z.boolean(),
  dlp_tokens: z.array(z.string()).default([]),
});

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type PlaygroundTraceNode = z.infer<typeof PlaygroundTraceNodeSchema>;
export type PlaygroundResponse = z.infer<typeof PlaygroundResponseSchema>;

export interface PlaygroundRequest {
  message: string;
  lead_id?: string | null;
  city_id?: string | null;
  use_real_context: boolean;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const playgroundQueryKeys = {
  all: ['ai-console', 'playground'] as const,
} as const;

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function runPlayground(payload: PlaygroundRequest): Promise<PlaygroundResponse> {
  // LGPD: payload.message pode conter PII — nunca logar
  const raw = await api.post<unknown>('/api/ai-console/playground', payload);
  return PlaygroundResponseSchema.parse(raw);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mutation para executar o playground do agente de IA.
 *
 * Padrão Rules-of-Hooks: sempre chamado incondicionalmente no componente.
 * O guard de permissão (ai_playground:run) é feito pelo componente chamador
 * APÓS todos os hooks serem invocados — nunca antes.
 *
 * LGPD: message/reply/trace nunca vão para console.
 *
 * @example
 * const { mutate, isPending, data, error } = usePlayground();
 * // chama apenas no submit do form, nunca automaticamente
 * mutate({ message, lead_id, city_id, use_real_context });
 */
export function usePlayground(): {
  mutate: (payload: PlaygroundRequest) => void;
  isPending: boolean;
  result: PlaygroundResponse | null;
  isError: boolean;
  errorMessage: string | null;
  reset: () => void;
} {
  const { mutate, isPending, data, isError, error, reset } = useMutation({
    mutationFn: runPlayground,
    // LGPD: sem log de payload ou resposta
  });

  let errorMessage: string | null = null;
  if (isError && error instanceof Error) {
    // Não expor stacktrace — apenas message genérica ou message do ApiError
    errorMessage = error.message;
  }

  return {
    mutate,
    isPending,
    result: data ?? null,
    isError,
    errorMessage,
    reset,
  };
}
