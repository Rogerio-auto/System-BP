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

/** Um nó do trace do grafo retornado pelo playground. */
export const PlaygroundTraceNodeSchema = z.object({
  node: z.string(),
  intent: z.string().nullable(),
  prompt_version: z.number().int().positive().nullable(),
  model: z.string().nullable(),
  tokens_in: z.number().int().nonnegative().nullable(),
  tokens_out: z.number().int().nonnegative().nullable(),
  latency_ms: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
});

export const PlaygroundResponseSchema = z.object({
  reply: z.string(),
  trace: z.array(PlaygroundTraceNodeSchema),
  prompt_versions_used: z.array(z.string()),
  tokens_total: z.number().int().nonnegative(),
  latency_ms: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  dlp_applied: z.boolean(),
  dlp_tokens: z.array(z.string()),
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
