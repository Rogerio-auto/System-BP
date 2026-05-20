// =============================================================================
// ai-console/playground/schemas.ts — Schemas Zod do módulo playground (F9-S04).
//
// Valida todas as bordas HTTP (body de request + response).
//
// LGPD (doc 17 §8.4):
//   - `message` digitada pelo operador é mascarada por redactPii() no service
//     ANTES de qualquer repasse ao LangGraph.
//   - `dlp_tokens` na resposta: lista de placeholders gerados (ex: ['<CPF_1>']).
//     Usada pela UI para exibir aviso de mascaramento.
//   - Logs nunca contêm `message`, `dlp_tokens` ou dados do operador.
//     Cobertos por pino.redact em app.ts.
//
// Rota coberta:
//   POST /api/ai-console/playground
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

/**
 * Body do endpoint POST /api/ai-console/playground.
 *
 * Enviado pelo operador via UI do ai-console. O service aplica DLP em `message`
 * antes de repassar ao LangGraph.
 */
export const playgroundBodySchema = z.object({
  /**
   * Mensagem digitada pelo operador para simular.
   * Passada por redactPii() no service antes de qualquer uso externo.
   * LGPD: não logar — coberto por pino.redact.
   */
  message: z.string().min(1, 'Mensagem obrigatória').max(4000, 'Mensagem muito longa'),

  /** UUID do lead a usar como contexto. null = usar contexto sintético. */
  lead_id: z.string().uuid().nullable().optional(),

  /** UUID da cidade a usar como contexto. null = usar contexto sintético. */
  city_id: z.string().uuid().nullable().optional(),

  /**
   * Se true e lead_id/city_id presentes, o LangGraph faz GET ao backend
   * para carregar contexto real (read-only). POST/PUT/PATCH são sempre sintéticos.
   * Se false, contexto é totalmente sintético.
   */
  use_real_context: z.boolean().default(false),
});

export type PlaygroundBody = z.infer<typeof playgroundBodySchema>;

// ---------------------------------------------------------------------------
// Trace entry (retornado pelo LangGraph, mascarado defensivamente no service)
// ---------------------------------------------------------------------------

/**
 * Entrada de trace de um nó percorrido no dry-run.
 * Mascarado de PII pelo service antes de retornar ao cliente.
 */
export const traceEntrySchema = z.object({
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

export type TraceEntry = z.infer<typeof traceEntrySchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * Resposta do endpoint POST /api/ai-console/playground.
 *
 * Inclui o resultado do dry-run do LangGraph, metadados de DLP e trace dos
 * nós percorridos (mascarado de PII antes de serializar).
 *
 * LGPD:
 *   - dlp_applied: true quando a mensagem do operador continha PII.
 *   - dlp_tokens: placeholders gerados (ex: ['<CPF_1>', '<EMAIL_1>']).
 *     Permite à UI exibir aviso visível de mascaramento.
 *   - trace: mascarado defensivamente (maskPiiInValue no service).
 *   - reply_content: pode conter texto gerado pelo LLM — responsabilidade dos
 *     nós do LangGraph garantir ausência de PII no reply.
 */
export const playgroundResponseSchema = z.object({
  /** UUID de correlação do request — para rastreabilidade. */
  trace_id: z.string().uuid(),

  /** Sempre true — confirma modo dry-run. */
  dry_run: z.literal(true),

  // Resultado do processamento
  reply_type: z.string(),
  reply_content: z.string().default(''),
  handoff_required: z.boolean(),
  handoff_reason: z.string().nullable().default(null),

  // Trace de observabilidade
  /** Nós percorridos + chamadas ao backend interceptadas (sem PII bruta). */
  trace: z.array(traceEntrySchema).default([]),
  prompt_versions_used: z.array(z.string()).default([]),
  tokens_total: z.number().int().nonnegative().default(0),
  graph_version: z.string(),
  latency_ms: z.number().int().nonnegative(),
  errors: z.array(z.record(z.string(), z.unknown())).default([]),

  // Metadados DLP (LGPD §8.4)
  /**
   * True se a mensagem do operador continha PII detectada e mascarada.
   * Permite à UI exibir badge/aviso de mascaramento.
   */
  dlp_applied: z.boolean(),
  /**
   * Lista de tokens de mascaramento gerados nesta execução.
   * Ex: ['<CPF_1>', '<EMAIL_1>']. Exibidos pela UI como aviso ao operador.
   * NÃO contém valores originais — apenas os placeholders.
   */
  dlp_tokens: z.array(z.string()).default([]),
});

export type PlaygroundResponse = z.infer<typeof playgroundResponseSchema>;
