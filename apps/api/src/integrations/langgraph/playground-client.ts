// =============================================================================
// integrations/langgraph/playground-client.ts — Cliente HTTP para o endpoint
// dry-run do serviço LangGraph (F9-S03 / F9-S04).
//
// Responsabilidades:
//   - Chamar POST /process/whatsapp/playground com header X-Internal-Token.
//   - Timeout próprio de 12s (maior que produção de 8s — operador espera).
//   - Validação Zod do response antes de retornar.
//   - Lança ExternalServiceError com contexto em qualquer falha.
//   - Propaga correlation_id via X-Correlation-Id.
//
// Diferenças em relação ao LangGraphClient (produção):
//   - Endpoint: /process/whatsapp/playground (não /process/whatsapp/message).
//   - Timeout: 12s (produção usa 8s).
//   - Payload: inclui `dry_run: true` obrigatório + `allow_real_reads`.
//   - Response: PlaygroundResponse em vez de WhatsAppMessageResponse.
//
// LGPD §8.4:
//   - message_text neste contexto JÁ FOI redactado por redactPii() antes de
//     chegar ao client. O DLP é responsabilidade do service (playground/service.ts).
//   - Nunca logar request/response body em nível info.
//   - Nunca logar customer_phone — apenas os últimos 4 dígitos se necessário.
//
// Sem retry:
//   - O playground é interativo (operador aguarda). Retry automático aumentaria
//     latência percebida. O caller pode simplesmente resubmeter.
// =============================================================================
import { z } from 'zod';

import { env } from '../../config/env.js';
import { ExternalServiceError } from '../../shared/errors.js';

// ---------------------------------------------------------------------------
// Endpoint
// ---------------------------------------------------------------------------

const PLAYGROUND_PATH = '/process/whatsapp/playground';

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

/** Timeout em ms para chamadas ao playground (doc 06 §4.4 — 12s, maior que produção). */
const PLAYGROUND_TIMEOUT_MS = 12_000;

// ---------------------------------------------------------------------------
// Schemas Zod (espelham PlaygroundRequest/PlaygroundResponse do Python F9-S03)
// ---------------------------------------------------------------------------

/** TraceEntry individual de um nó percorrido no dry-run. */
const TraceEntrySchema = z.object({
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

export type PlaygroundTraceEntry = z.infer<typeof TraceEntrySchema>;

/**
 * Schema do payload de request para POST /process/whatsapp/playground.
 * Espelha PlaygroundRequest do Python (apps/langgraph-service/app/schemas/playground.py).
 */
export const PlaygroundRequestSchema = z.object({
  /** Obrigatório — fail-fast 422 se ausente ou false. */
  dry_run: z.literal(true),
  conversation_id: z.string().min(1),
  lead_id: z.string().nullable().default(null),
  // PII — NUNCA logar
  customer_phone: z.string().min(10),
  /** message_text JÁ DEVE estar redactado por redactPii() antes de chegar aqui. */
  message_text: z.string().default(''),
  message_attachments: z.array(z.record(z.string(), z.unknown())).default([]),
  message_timestamp: z.string().min(1),
  channel: z.literal('whatsapp').default('whatsapp'),
  chatwoot_conversation_id: z.string().min(1),
  chatwoot_account_id: z.string().min(1),
  /** Quando true e lead_id/city_id presentes, GET ao backend são reais (read-only). */
  allow_real_reads: z.boolean().default(false),
  metadata: z
    .object({
      city_id: z.string().nullable().default(null),
      city_name: z.string().nullable().default(null),
      customer_name: z.string().nullable().default(null),
      previous_state_loaded: z.boolean().default(false),
    })
    .default({}),
  correlation_id: z.string().min(1),
  idempotency_key: z.string().default(''),
});

export type PlaygroundRequest = z.infer<typeof PlaygroundRequestSchema>;

/**
 * Schema do response de POST /process/whatsapp/playground.
 * Espelha PlaygroundResponse do Python (apps/langgraph-service/app/schemas/playground.py).
 */
export const PlaygroundResponseSchema = z.object({
  conversation_id: z.string(),
  dry_run: z.literal(true),
  reply_type: z.string(),
  reply_content: z.string().default(''),
  handoff_required: z.boolean(),
  handoff_reason: z.string().nullable().default(null),
  /** Trace dos nós percorridos — sem PII bruta por garantia do LangGraph. */
  trace: z.array(TraceEntrySchema).default([]),
  prompt_versions_used: z.array(z.string()).default([]),
  tokens_total: z.number().int().nonnegative().default(0),
  graph_version: z.string(),
  latency_ms: z.number().int().nonnegative(),
  /** Erros acumulados durante a execução — sem PII bruta. */
  errors: z.array(z.record(z.string(), z.unknown())).default([]),
});

export type PlaygroundResponse = z.infer<typeof PlaygroundResponseSchema>;

// ---------------------------------------------------------------------------
// Opções de configuração injetáveis
// ---------------------------------------------------------------------------

/**
 * Opções de configuração injetáveis no LangGraphPlaygroundClient.
 * Primariamente para injeção em testes.
 */
export interface LangGraphPlaygroundClientOptions {
  /** Override de URL base (precedência sobre env). */
  baseUrl?: string;
  /** Override do token de autenticação interna (precedência sobre env). */
  internalToken?: string;
  /** Timeout em ms. Default: 12000. */
  timeoutMs?: number;
  /**
   * Função fetch injetável para testes.
   * Default: fetch global do Node 20.
   */
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// LangGraphPlaygroundClient
// ---------------------------------------------------------------------------

/**
 * Cliente HTTP para o endpoint dry-run do serviço LangGraph.
 *
 * Cada instância lê configuração de `env` no momento da criação,
 * podendo receber overrides via `LangGraphPlaygroundClientOptions` (útil em testes).
 *
 * Lança `ExternalServiceError` (subclasse de AppError) em qualquer falha.
 *
 * @example
 * const client = new LangGraphPlaygroundClient();
 * const response = await client.runPlayground(request, correlationId);
 */
export class LangGraphPlaygroundClient {
  private readonly baseUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: LangGraphPlaygroundClientOptions = {}) {
    const resolvedBaseUrl = options.baseUrl ?? env.LANGGRAPH_SERVICE_URL;
    const resolvedToken = options.internalToken ?? env.LANGGRAPH_INTERNAL_TOKEN;

    // Validação explícita — falha cedo com mensagem clara.
    if (!resolvedBaseUrl) {
      throw new ExternalServiceError(
        'LANGGRAPH_SERVICE_URL não configurado — LangGraph indisponível',
      );
    }
    if (!resolvedToken) {
      throw new ExternalServiceError(
        'LANGGRAPH_INTERNAL_TOKEN não configurado — LangGraph indisponível',
      );
    }

    this.baseUrl = resolvedBaseUrl.replace(/\/$/, '');
    this.internalToken = resolvedToken;
    this.timeoutMs = options.timeoutMs ?? PLAYGROUND_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  // -------------------------------------------------------------------------
  // Métodos públicos
  // -------------------------------------------------------------------------

  /**
   * Chama POST /process/whatsapp/playground no serviço LangGraph.
   *
   * Valida o request com Zod antes de enviar e valida o response com Zod antes
   * de retornar. Lança ExternalServiceError em qualquer falha de rede, timeout
   * ou status HTTP não-2xx.
   *
   * LGPD: message_text DEVE estar redactado por redactPii() antes de chamar este método.
   * Não logar payload — pode conter customer_phone (PII).
   * Usar apenas conversation_id e correlation_id nos logs de contexto.
   *
   * @param request         Payload validado do request (PlaygroundRequest).
   * @param correlationId   UUID de correlação propagado via X-Correlation-Id.
   * @returns               Response validado (PlaygroundResponse).
   * @throws ExternalServiceError em falha de rede, timeout ou resposta inválida.
   */
  async runPlayground(
    request: PlaygroundRequest,
    correlationId: string,
  ): Promise<PlaygroundResponse> {
    // Valida o request outbound para detectar problemas de contrato cedo.
    const validatedRequest = PlaygroundRequestSchema.parse(request);

    const url = `${this.baseUrl}${PLAYGROUND_PATH}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Autenticação interna obrigatória (doc 06 §4.3)
          'X-Internal-Token': this.internalToken,
          // Rastreabilidade distribuída
          'X-Correlation-Id': correlationId,
        },
        body: JSON.stringify(validatedRequest),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ExternalServiceError(`LangGraph playground timeout após ${this.timeoutMs}ms`, {
          // url omitida — não vazar topologia interna ao cliente HTTP
          correlationId,
        });
      }
      throw new ExternalServiceError(
        `LangGraph playground request falhou: ${err instanceof Error ? err.message : String(err)}`,
        // url omitida — não vazar topologia interna ao cliente HTTP
        { correlationId },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    // Parsear body independentemente do status para incluir na mensagem de erro
    let responseBody: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        responseBody = (await response.json()) as unknown;
      } catch {
        responseBody = null;
      }
    }

    if (!response.ok) {
      throw new ExternalServiceError(
        `LangGraph playground retornou ${response.status} em POST ${PLAYGROUND_PATH}`,
        // Não incluir responseBody — pode conter trace com dados do playground.
        { status: response.status, correlationId },
      );
    }

    // Valida o response — lança ZodError se o contrato for violado.
    return PlaygroundResponseSchema.parse(responseBody);
  }
}
