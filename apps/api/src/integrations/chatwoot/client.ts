// =============================================================================
// integrations/chatwoot/client.ts — Cliente HTTP encapsulado para a API Chatwoot.
//
// Responsabilidades:
//   - Autenticação via header `api_access_token` (nunca em URL).
//   - Timeout de 10s por request (AbortSignal).
//   - Retry automático em erros 5xx: 3 tentativas, backoff exponencial 2x, jitter.
//   - Sem retry em erros 4xx — são erros do chamador, não da rede.
//   - Validação Zod de toda resposta antes de retornar.
//   - Lança ChatwootApiError com contexto em qualquer falha.
//
// LGPD §8.3: conteúdo de mensagens pode conter PII de cidadãos.
//   - Nunca logar `content` em nível info.
//   - Usar request.log.debug() + pino.redact adicionado em app.ts.
//   - Client não tem acesso ao logger do Fastify — caller é responsável por redact.
//
// Uso:
//   const client = new ChatwootClient();       // lê env automaticamente
//   await client.createMessage(42, 'Olá!');
// =============================================================================
import type { z } from 'zod';

import { env } from '../../config/env.js';
import { ChatwootApiError } from '../../shared/errors.js';

import type {
  ChatwootAssignmentResponse,
  ChatwootConversationResponse,
  ChatwootCustomAttributesSchema,
  ChatwootMessageResponse,
} from './schemas.js';
import {
  ChatwootAssignmentResponseSchema,
  ChatwootConversationResponseSchema,
  ChatwootMessageResponseSchema,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Constantes de retry (defaults de produção)
// ---------------------------------------------------------------------------

/** Número máximo de tentativas (1 original + 2 retries = 3 total). */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Base do backoff exponencial em ms (200 → 400 → 800…). */
const DEFAULT_BACKOFF_BASE_MS = 200;

/** Fator multiplicador do backoff a cada tentativa. */
const DEFAULT_BACKOFF_FACTOR = 2;

/** Jitter máximo adicionado ao backoff (ms). Evita thundering herd. */
const DEFAULT_JITTER_MAX_MS = 100;

/** Timeout por request em ms. */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

/**
 * Record de atributos customizados de conversa (valores escalares).
 * Alias público para facilitar uso pelos callers.
 */
export type ChatwootAttributes = z.infer<typeof ChatwootCustomAttributesSchema>;

/**
 * Opções de configuração injetáveis no ChatwootClient.
 * Primariamente para injeção em testes (timeoutMs reduzido, sleepFn mock).
 * Em produção, use os defaults via construtor sem argumentos.
 */
export interface ChatwootClientOptions {
  /** Override de URL base (precedência sobre env). */
  baseUrl?: string;
  /** Override de API token (precedência sobre env). */
  apiToken?: string;
  /** Override de account ID (precedência sobre env). */
  accountId?: number;
  /** Timeout em ms por request. Default: 10000. */
  timeoutMs?: number;
  /** Número máximo de tentativas. Default: 3. */
  maxAttempts?: number;
  /** Base do backoff exponencial em ms. Default: 200. */
  backoffBaseMs?: number;
  /** Jitter máximo em ms. Default: 100. */
  jitterMaxMs?: number;
  /**
   * Função de sleep injetável para testes.
   * Default: `(ms) => new Promise(resolve => setTimeout(resolve, ms))`.
   */
  sleepFn?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Calcula o delay de backoff exponencial com jitter para a tentativa `attempt`
 * (0-indexed, onde 0 = segunda tentativa após o primeiro erro).
 *
 * delay = min(base * factor^attempt, 8000) + random(0, jitterMax)
 */
function calcBackoffDelay(attempt: number, baseMs: number, jitterMaxMs: number): number {
  const exponential = baseMs * Math.pow(DEFAULT_BACKOFF_FACTOR, attempt);
  const capped = Math.min(exponential, 8_000);
  const jitter = Math.random() * jitterMaxMs;
  return Math.round(capped + jitter);
}

/**
 * Retorna `true` se o erro deve disparar retry.
 * Regra: apenas 5xx e erros de rede (upstreamStatus === 0).
 * Erros 4xx são falhas do caller — retry não resolve.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof ChatwootApiError) {
    // upstreamStatus === 0 = erro de rede ou timeout próprio do client
    return error.upstreamStatus >= 500 || error.upstreamStatus === 0;
  }
  // TypeError = fetch falhou com erro de rede (ECONNREFUSED, etc.)
  return error instanceof TypeError;
}

// ---------------------------------------------------------------------------
// ChatwootClient
// ---------------------------------------------------------------------------

/**
 * Cliente HTTP para a API REST do Chatwoot.
 *
 * Cada instância lê configuração de `env` no momento da criação,
 * podendo receber overrides via `ChatwootClientOptions` (útil em testes).
 *
 * Lança `ChatwootApiError` (subclasse de AppError) em qualquer falha.
 *
 * @example
 * const chatwoot = new ChatwootClient();
 * await chatwoot.createMessage(convId, 'Seu crédito foi aprovado!');
 */
export class ChatwootClient {
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly accountId: number;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly jitterMaxMs: number;
  private readonly sleepFn: (delayMs: number) => Promise<void>;

  constructor(options: ChatwootClientOptions = {}) {
    // Resolve configuração: options > env
    const resolvedBaseUrl = options.baseUrl ?? env.CHATWOOT_BASE_URL;
    const resolvedApiToken = options.apiToken ?? env.CHATWOOT_API_TOKEN;
    const resolvedAccountId = options.accountId ?? env.CHATWOOT_ACCOUNT_ID;

    // Validação explícita — falha cedo com mensagem clara.
    if (resolvedBaseUrl === undefined) {
      throw new ChatwootApiError(0, 'CHATWOOT_BASE_URL não configurado — Chatwoot indisponível');
    }
    if (resolvedApiToken === undefined) {
      throw new ChatwootApiError(0, 'CHATWOOT_API_TOKEN não configurado — Chatwoot indisponível');
    }
    if (resolvedAccountId === undefined) {
      throw new ChatwootApiError(0, 'CHATWOOT_ACCOUNT_ID não configurado — Chatwoot indisponível');
    }

    // Remove trailing slash para montar URLs uniformes
    this.baseUrl = resolvedBaseUrl.replace(/\/$/, '');
    this.apiToken = resolvedApiToken;
    this.accountId = resolvedAccountId;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.jitterMaxMs = options.jitterMaxMs ?? DEFAULT_JITTER_MAX_MS;
    this.sleepFn =
      options.sleepFn ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  }

  // -------------------------------------------------------------------------
  // Métodos públicos
  // -------------------------------------------------------------------------

  /**
   * Atualiza os `custom_attributes` de uma conversa no Chatwoot.
   *
   * Usado para espelhar estado do Manager → Chatwoot (lead_id, cidade,
   * estágio do kanban, simulação, etc.) conforme mapeamento em doc 07 §2.3.
   *
   * @param conversationId  ID numérico da conversa no Chatwoot.
   * @param attrs           Record de atributos a atualizar (merge, não replace).
   * @returns               Estado parcial da conversa após atualização.
   */
  async updateAttributes(
    conversationId: number,
    attrs: ChatwootAttributes,
  ): Promise<ChatwootConversationResponse> {
    const path = `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/custom_attributes`;

    const raw = await this.request('PATCH', path, { custom_attributes: attrs });

    // Valida resposta — parse lança ZodError se estrutura inválida
    return ChatwootConversationResponseSchema.parse(raw);
  }

  /**
   * Cria uma mensagem em uma conversa do Chatwoot.
   *
   * Usado para enviar mensagens ao cliente via interface do Chatwoot
   * (complementar ao WhatsApp direto).
   *
   * LGPD: `content` pode conter dados pessoais. Caller deve:
   *   - Não logar `content` em nível info.
   *   - Garantir que conteúdo passou por DLP se veio de LLM.
   *
   * @param conversationId  ID da conversa.
   * @param content         Texto da mensagem.
   * @param type            'outgoing' (padrão) ou 'incoming'.
   * @param isPrivate       Se true, cria nota interna (não visível ao cliente). Padrão false.
   */
  async createMessage(
    conversationId: number,
    content: string,
    type: 'outgoing' | 'incoming' = 'outgoing',
    isPrivate = false,
  ): Promise<ChatwootMessageResponse> {
    const path = `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`;

    const raw = await this.request('POST', path, {
      content,
      message_type: type,
      private: isPrivate,
    });

    return ChatwootMessageResponseSchema.parse(raw);
  }

  /**
   * Cria uma nota interna em uma conversa do Chatwoot.
   *
   * Atalho para `createMessage(..., true)`. Usado pelo handoff da IA para
   * deixar contexto estruturado para o agente humano (doc 07 §2.4).
   *
   * LGPD: `content` pode conter resumo de atendimento com PII (nome, cidade,
   * simulação). Mesmo sendo nota interna, aplicam-se as restrições de log.
   *
   * @param conversationId  ID da conversa.
   * @param content         Conteúdo da nota interna (pode incluir markdown).
   */
  async createNote(conversationId: number, content: string): Promise<ChatwootMessageResponse> {
    return this.createMessage(conversationId, content, 'outgoing', true);
  }

  /**
   * Atribui um agente humano a uma conversa do Chatwoot.
   *
   * O `agentId` é o `chatwoot_user_id` do agente, mapeado via `agents` table
   * (campo `chatwoot_user_id`). Ver doc 07 §2.3.
   *
   * @param conversationId  ID da conversa.
   * @param agentId         ID do agente no Chatwoot (não o UUID interno do Manager).
   */
  async assignAgent(conversationId: number, agentId: number): Promise<ChatwootAssignmentResponse> {
    const path = `/api/v1/accounts/${this.accountId}/conversations/${conversationId}/assignments`;

    const raw = await this.request('POST', path, { assignee_id: agentId });

    return ChatwootAssignmentResponseSchema.parse(raw);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Executa uma requisição HTTP contra a API Chatwoot com retry em 5xx.
   *
   * @param method   Verbo HTTP.
   * @param path     Path da API (ex: `/api/v1/accounts/1/conversations/42/messages`).
   * @param body     Corpo JSON (opcional para GET/DELETE).
   * @returns        Objeto JSON bruto (não validado — caller faz parse).
   * @throws         ChatwootApiError em falha definitiva (após retries).
   */
  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;

    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      // Backoff antes de retry (não na primeira tentativa)
      if (attempt > 0) {
        const delay = calcBackoffDelay(attempt - 1, this.backoffBaseMs, this.jitterMaxMs);
        await this.sleepFn(delay);
      }

      try {
        const result = await this.doFetch(method, url, body);
        return result;
      } catch (err) {
        lastError = err;

        if (!isRetryable(err)) {
          // 4xx ou outro erro não-retryable — falha imediata sem mais tentativas
          throw err;
        }

        // 5xx ou erro de rede — continua para próxima iteração do loop
        // (a menos que seja a última tentativa)
      }
    }

    // Esgotou todas as tentativas
    throw lastError;
  }

  /**
   * Executa uma única requisição HTTP com timeout configurável.
   * Não faz retry — a lógica de retry fica em `request()`.
   *
   * @throws ChatwootApiError para status HTTP não-ok.
   * @throws ChatwootApiError para timeout (AbortError).
   * @throws TypeError para falhas de rede (ECONNREFUSED, etc.).
   */
  private async doFetch(
    method: string,
    url: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          // Chatwoot usa api_access_token no header (não Bearer)
          api_access_token: this.apiToken,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      // fetch rejeita com DOMException/TypeError em caso de abort ou falha de rede
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ChatwootApiError(0, `Chatwoot request timeout após ${this.timeoutMs}ms: ${url}`);
      }
      // Erro de rede — re-throw como-está (TypeError) para isRetryable() identificar
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Tentar parsear corpo JSON independente do status para incluir na mensagem de erro
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
      throw new ChatwootApiError(
        response.status,
        `Chatwoot API retornou ${response.status} em ${method} ${url}`,
        // Não incluir responseBody cru em detalhes pois pode conter PII
        // Apenas o status é suficiente para diagnóstico seguro
        { status: response.status },
      );
    }

    return responseBody;
  }
}
