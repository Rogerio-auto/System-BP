// =============================================================================
// integrations/langgraph/client.ts — Cliente HTTP para o serviço LangGraph.
//
// Responsabilidades:
//   - Chamar POST /process/whatsapp/message com header X-Internal-Token.
//   - Timeout duro de 8s (doc 06 §4.4). Sem retry no cliente — backend orquestra.
//   - Validação Zod do response antes de retornar.
//   - Lança ExternalServiceError com contexto em qualquer falha.
//   - Propaga correlation_id via X-Correlation-Id.
//
// LGPD §8.3 / §8.4:
//   - Payload contém customer_phone e message_text (PII bruta).
//     DLP é responsabilidade do grafo LangGraph; o backend apenas repassa.
//   - Nunca logar request/response body em nível info.
//   - Caller deve garantir pino.redact em qualquer log de debug do request.
//
// Sem retry no cliente:
//   - Retry e fallback são orquestrados pelo handler (process-with-ai.ts).
//   - F3-S34 implementará o tratamento de timeout/erro com handoff automático.
//   - Este slot (F3-S33) cobre apenas o caminho feliz.
// =============================================================================
import { env } from '../../config/env.js';
import { ExternalServiceError } from '../../shared/errors.js';

import { LangGraphWhatsAppRequestSchema, LangGraphWhatsAppResponseSchema } from './schemas.js';
import type { LangGraphWhatsAppRequest, LangGraphWhatsAppResponse } from './schemas.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Timeout em ms para a chamada ao LangGraph (doc 06 §4.4). */
const DEFAULT_TIMEOUT_MS = 8_000;

/** Endpoint de processamento de mensagem WhatsApp. */
const PROCESS_WHATSAPP_PATH = '/process/whatsapp/message';

// ---------------------------------------------------------------------------
// Tipos de configuração
// ---------------------------------------------------------------------------

/**
 * Opções de configuração injetáveis no LangGraphClient.
 * Primariamente para injeção em testes.
 */
export interface LangGraphClientOptions {
  /** Override de URL base (precedência sobre env). */
  baseUrl?: string;
  /** Override do token de autenticação interna (precedência sobre env). */
  internalToken?: string;
  /** Timeout em ms. Default: 8000. */
  timeoutMs?: number;
  /**
   * Função fetch injetável para testes.
   * Default: fetch global do Node 20.
   */
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// LangGraphClient
// ---------------------------------------------------------------------------

/**
 * Cliente HTTP para o serviço LangGraph.
 *
 * Cada instância lê configuração de `env` no momento da criação,
 * podendo receber overrides via `LangGraphClientOptions` (útil em testes).
 *
 * Lança `ExternalServiceError` (subclasse de AppError) em qualquer falha.
 *
 * @example
 * const client = new LangGraphClient();
 * const response = await client.processWhatsAppMessage(request, correlationId);
 */
export class LangGraphClient {
  private readonly baseUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: LangGraphClientOptions = {}) {
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

    // Remove trailing slash para montar URLs uniformes
    this.baseUrl = resolvedBaseUrl.replace(/\/$/, '');
    this.internalToken = resolvedToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  // -------------------------------------------------------------------------
  // Métodos públicos
  // -------------------------------------------------------------------------

  /**
   * Chama POST /process/whatsapp/message no serviço LangGraph.
   *
   * Valida o request com Zod antes de enviar e valida o response com Zod antes
   * de retornar. Lança ExternalServiceError em qualquer falha de rede, timeout
   * ou status HTTP não-2xx.
   *
   * SEM retry — o caller (process-with-ai handler) orquestra falhas (F3-S34).
   *
   * LGPD: não loga payload — contém customer_phone e message_text (PII bruta).
   * Usar apenas correlation_id e conversation_id nos logs de contexto.
   *
   * @param request         Payload validado do request (doc 06 §4.1).
   * @param correlationId   UUID de correlação propagado via X-Correlation-Id.
   * @returns               Response validado (doc 06 §4.2).
   * @throws ExternalServiceError em falha de rede, timeout ou resposta inválida.
   */
  async processWhatsAppMessage(
    request: LangGraphWhatsAppRequest,
    correlationId: string,
  ): Promise<LangGraphWhatsAppResponse> {
    // Valida o request outbound para detectar problemas de contrato cedo.
    // Justificativa: se o schema mudar no Python e não for sincronizado aqui,
    // o parse lança ZodError antes de fazer a chamada HTTP — evita chamadas
    // com payload malformado que o LangGraph rejeitaria com 422 (mais difícil de debugar).
    const validatedRequest = LangGraphWhatsAppRequestSchema.parse(request);

    const url = `${this.baseUrl}${PROCESS_WHATSAPP_PATH}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Autenticação interna obrigatória (doc 06 §4.3 — todos os endpoints /internal)
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
        throw new ExternalServiceError(`LangGraph request timeout após ${this.timeoutMs}ms`, {
          url,
          correlationId,
        });
      }
      // Erro de rede — re-throw como ExternalServiceError com contexto
      throw new ExternalServiceError(
        `LangGraph request falhou: ${err instanceof Error ? err.message : String(err)}`,
        { url, correlationId },
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
        `LangGraph retornou ${response.status} em POST ${PROCESS_WHATSAPP_PATH}`,
        // Não incluir responseBody pois pode conter PII do contexto da mensagem.
        // Apenas o status code é suficiente para diagnóstico seguro.
        { status: response.status, correlationId },
      );
    }

    // Valida o response — lança ZodError se o contrato for violado.
    // ZodError é propagado diretamente para o caller; o handler (process-with-ai.ts)
    // é responsável por tratar como falha de integração (F3-S34).
    return LangGraphWhatsAppResponseSchema.parse(responseBody);
  }
}
