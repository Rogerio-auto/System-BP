// =============================================================================
// integrations/channels/shared/graphClient.ts — Cliente HTTP da Meta Graph API.
//
// Implementa a interface `GraphClient` de adapter.types.ts para a API v23.0.
//
// Funcionalidades:
//   - Base URL: https://graph.facebook.com/v23.0
//   - Auth: Bearer token por requisição (access_token decifrado do channel_secrets)
//   - Retry: backoff exponencial com jitter em 429/5xx (3 tentativas por default)
//   - Retry-After: respeita o header em 429 (em segundos ou milissegundos)
//   - Timeout: AbortSignal por requisição (default 30s)
//   - Allowlist de host: SOMENTE `graph.facebook.com` — proteção contra SSRF
//
// Segurança (LGPD doc 17 + regras do projeto):
//   - `accessToken` NUNCA aparece em logs ou erros lançados.
//   - Dados de telefone/destinatário NUNCA são logados diretamente.
//   - Erros lançam `ProviderError` (subclasse de AppError) com upstreamStatus.
//
// Uso:
//   const client = createGraphClient({ accessToken: decryptedToken });
//   const result = await client.post<SendMessageResponse>(
//     '/{phone_number_id}/messages',
//     { messaging_product: 'whatsapp', ... }
//   );
// =============================================================================

import type { GraphClient, GraphRequestOptions } from '../adapter.types.js';

import { ProviderError } from './errors.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Versão da Graph API. Atualizar quando Meta deprecar. */
const GRAPH_API_VERSION = 'v23.0';

/** URL base da Meta Graph API. */
const META_GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Host permitido na allowlist para download de mídia (proteção SSRF). */
const ALLOWED_DOWNLOAD_HOSTS: ReadonlySet<string> = new Set([
  'graph.facebook.com',
  'lookaside.fbsbx.com', // CDN usado pela Meta para mídia de WhatsApp
  'scontent.cdninstagram.com', // CDN de mídia do Instagram
]);

/** Número máximo de tentativas (1 original + N retries). */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Base do backoff exponencial em ms. */
const DEFAULT_BACKOFF_BASE_MS = 500;

/** Fator multiplicador do backoff. */
const BACKOFF_FACTOR = 2;

/** Jitter máximo em ms (evita thundering herd em múltiplos workers). */
const DEFAULT_JITTER_MAX_MS = 200;

/** Cap do backoff exponencial para evitar delays infinitos. */
const MAX_BACKOFF_MS = 32_000;

/** Timeout default por requisição. Meta pode ser lenta em horários de pico. */
const DEFAULT_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Opções de construção do cliente
// ---------------------------------------------------------------------------

export interface GraphClientOptions {
  /** Access token decifrado do `channel_secrets`. NUNCA logar. */
  readonly accessToken: string;
  /** Número máximo de tentativas (default: 3). */
  readonly maxAttempts?: number | undefined;
  /** Base do backoff exponencial em ms (default: 500). */
  readonly backoffBaseMs?: number | undefined;
  /** Jitter máximo em ms (default: 200). */
  readonly jitterMaxMs?: number | undefined;
  /** Timeout default por requisição em ms (default: 30s). */
  readonly defaultTimeoutMs?: number | undefined;
  /**
   * Função de sleep injetável para testes (evitar timers reais).
   * Default: `(ms) => new Promise((r) => setTimeout(r, ms))`.
   */
  readonly sleepFn?: ((ms: number) => Promise<void>) | undefined;
  /**
   * Override da URL base (para testes/staging).
   * Default: `https://graph.facebook.com/v23.0`.
   */
  readonly baseUrl?: string | undefined;
}

// ---------------------------------------------------------------------------
// Tipos de resposta de erro da Meta Graph API
// ---------------------------------------------------------------------------

interface MetaErrorDetail {
  readonly message?: string | undefined;
  readonly type?: string | undefined;
  readonly code?: number | undefined;
  readonly error_subcode?: number | undefined;
  readonly fbtrace_id?: string | undefined;
  readonly title?: string | undefined;
}

interface MetaErrorEnvelope {
  readonly error?: MetaErrorDetail | undefined;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Calcula o delay de backoff exponencial com jitter.
 * `delay = min(base * factor^attempt, MAX) + random(0, jitterMax)`
 *
 * @param attempt  0-indexed (0 = primeiro retry).
 */
function calcBackoffDelay(attempt: number, baseMs: number, jitterMaxMs: number): number {
  const exponential = baseMs * Math.pow(BACKOFF_FACTOR, attempt);
  const capped = Math.min(exponential, MAX_BACKOFF_MS);
  const jitter = Math.random() * jitterMaxMs;
  return Math.round(capped + jitter);
}

/**
 * Verifica se um `ProviderError` é elegível para retry.
 */
function isRetryableError(e: unknown): e is ProviderError {
  return e instanceof ProviderError && e.isRetryable;
}

/**
 * Valida que uma URL para download pertence ao allowlist de hosts.
 * Proteção contra SSRF: o caller não deve controlar a URL sem validação.
 *
 * @throws ProviderError se o host não está no allowlist.
 */
function assertAllowedDownloadUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError(
      `URL de download de mídia inválida: "${url.slice(0, 50)}"`,
      0, // upstreamStatus=0 indica erro local (não upstream)
    );
  }

  if (!ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    throw new ProviderError(
      `Host de download não permitido: "${parsed.hostname}" não está no allowlist. ` +
        `Apenas ${[...ALLOWED_DOWNLOAD_HOSTS].join(', ')} são permitidos.`,
      0,
    );
  }
}

/**
 * Parseia o header `Retry-After` para milissegundos.
 * Suporta inteiro (segundos) e ignora HTTP-date (retorna 0).
 */
function parseRetryAfterMs(header: string | null): number {
  if (header === null) return 0;
  const seconds = parseInt(header, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1_000;
}

// ---------------------------------------------------------------------------
// GraphClientImpl — implementação concreta
// ---------------------------------------------------------------------------

class GraphClientImpl implements GraphClient {
  private readonly accessToken: string;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly jitterMaxMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly baseUrl: string;

  constructor(options: GraphClientOptions) {
    if (options.accessToken === '') {
      throw new ProviderError(
        'GraphClient requer accessToken não-vazio — channel_secrets.access_token_enc deve estar decifrado',
        0,
      );
    }

    this.accessToken = options.accessToken;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.jitterMaxMs = options.jitterMaxMs ?? DEFAULT_JITTER_MAX_MS;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleepFn =
      options.sleepFn ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
    this.baseUrl = options.baseUrl ?? META_GRAPH_BASE_URL;
  }

  // -------------------------------------------------------------------------
  // Interface pública
  // -------------------------------------------------------------------------

  async get<TResponse>(path: string, options?: GraphRequestOptions): Promise<TResponse> {
    const url = this.buildUrl(path, options?.params);
    return this.requestWithRetry<TResponse>('GET', url, undefined, options?.timeoutMs);
  }

  async post<TResponse>(
    path: string,
    body: Readonly<Record<string, unknown>>,
    options?: GraphRequestOptions,
  ): Promise<TResponse> {
    const url = this.buildUrl(path, options?.params);
    return this.requestWithRetry<TResponse>('POST', url, body, options?.timeoutMs);
  }

  async postForm<TResponse>(
    path: string,
    form: FormData,
    options?: GraphRequestOptions,
  ): Promise<TResponse> {
    const url = this.buildUrl(path, options?.params);
    return this.requestWithRetryForm<TResponse>(url, form, options?.timeoutMs);
  }

  async downloadBytes(
    url: string,
    options?: GraphRequestOptions,
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
    // Proteção SSRF: validar host antes de qualquer fetch
    assertAllowedDownloadUrl(url);
    return this.downloadWithRetry(url, options?.timeoutMs);
  }

  // -------------------------------------------------------------------------
  // Internals — retry loop
  // -------------------------------------------------------------------------

  private async requestWithRetry<TResponse>(
    method: string,
    url: string,
    body: Readonly<Record<string, unknown>> | undefined,
    timeoutMs?: number | undefined,
  ): Promise<TResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        const retryAfterMs = lastError instanceof ProviderError ? (lastError.retryAfterMs ?? 0) : 0;
        const backoff = calcBackoffDelay(attempt - 1, this.backoffBaseMs, this.jitterMaxMs);
        const delay = Math.max(backoff, retryAfterMs);
        await this.sleepFn(delay);
      }

      try {
        return await this.doFetch<TResponse>(method, url, body, timeoutMs);
      } catch (e) {
        lastError = e;
        if (!isRetryableError(e)) throw e;
      }
    }

    throw lastError;
  }

  private async requestWithRetryForm<TResponse>(
    url: string,
    form: FormData,
    timeoutMs?: number | undefined,
  ): Promise<TResponse> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        const retryAfterMs = lastError instanceof ProviderError ? (lastError.retryAfterMs ?? 0) : 0;
        const backoff = calcBackoffDelay(attempt - 1, this.backoffBaseMs, this.jitterMaxMs);
        const delay = Math.max(backoff, retryAfterMs);
        await this.sleepFn(delay);
      }

      try {
        return await this.doFetchForm<TResponse>(url, form, timeoutMs);
      } catch (e) {
        lastError = e;
        if (!isRetryableError(e)) throw e;
      }
    }

    throw lastError;
  }

  private async downloadWithRetry(
    url: string,
    timeoutMs?: number | undefined,
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        const retryAfterMs = lastError instanceof ProviderError ? (lastError.retryAfterMs ?? 0) : 0;
        const backoff = calcBackoffDelay(attempt - 1, this.backoffBaseMs, this.jitterMaxMs);
        const delay = Math.max(backoff, retryAfterMs);
        await this.sleepFn(delay);
      }

      try {
        return await this.doDownload(url, timeoutMs);
      } catch (e) {
        lastError = e;
        if (!isRetryableError(e)) throw e;
      }
    }

    throw lastError;
  }

  // -------------------------------------------------------------------------
  // Internals — fetch individual
  // -------------------------------------------------------------------------

  private async doFetch<TResponse>(
    method: string,
    url: string,
    body: Readonly<Record<string, unknown>> | undefined,
    timeoutMs?: number | undefined,
  ): Promise<TResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? this.defaultTimeoutMs);

    // exactOptionalPropertyTypes: não passar `body: undefined` — omitir a propriedade.
    const fetchInit: RequestInit =
      body !== undefined
        ? {
            method,
            headers: {
              'Content-Type': 'application/json',
              // LGPD: token nunca em log — apenas no header Authorization
              Authorization: `Bearer ${this.accessToken}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          }
        : {
            method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.accessToken}`,
            },
            signal: controller.signal,
          };

    let response: Response;
    try {
      response = await fetch(url, fetchInit);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ProviderError(
          `Meta Graph API timeout após ${timeoutMs ?? this.defaultTimeoutMs}ms`,
          0, // status=0 = erro de rede/timeout
        );
      }
      // TypeError de rede (DNS, conexão recusada, etc.)
      throw new ProviderError(
        `Meta Graph API erro de rede: ${e instanceof Error ? e.message : 'desconhecido'}`,
        0,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    return this.parseJsonResponse<TResponse>(response);
  }

  private async doFetchForm<TResponse>(
    url: string,
    form: FormData,
    timeoutMs?: number | undefined,
  ): Promise<TResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? this.defaultTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          // Content-Type NÃO definido — Node/browser adiciona com boundary correto para FormData
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: form,
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ProviderError(
          `Meta Graph API (form upload) timeout após ${timeoutMs ?? this.defaultTimeoutMs}ms`,
          0,
        );
      }
      throw new ProviderError(
        `Meta Graph API (form upload) erro de rede: ${e instanceof Error ? e.message : 'desconhecido'}`,
        0,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    return this.parseJsonResponse<TResponse>(response);
  }

  private async doDownload(
    url: string,
    timeoutMs?: number | undefined,
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs ?? this.defaultTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new ProviderError(
          `Meta Graph API (download) timeout após ${timeoutMs ?? this.defaultTimeoutMs}ms`,
          0,
        );
      }
      throw new ProviderError(
        `Meta Graph API (download) erro de rede: ${e instanceof Error ? e.message : 'desconhecido'}`,
        0,
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(
        response.status === 429 ? response.headers.get('retry-after') : null,
      );
      throw new ProviderError(
        `Meta Graph API (download) ${response.status}`,
        response.status,
        undefined,
        undefined,
        retryAfterMs > 0 ? retryAfterMs : undefined,
      );
    }

    const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
    // Remover parâmetros do content-type (ex: "image/jpeg; charset=utf-8" → "image/jpeg")
    const mimeTypeParsed = mimeType.split(';')[0]?.trim() ?? 'application/octet-stream';

    const arrayBuffer = await response.arrayBuffer();
    return {
      bytes: Buffer.from(arrayBuffer),
      mimeType: mimeTypeParsed,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Constrói a URL completa para uma requisição.
   * `path` deve começar com `/` (ex: "/{phone_number_id}/messages").
   */
  private buildUrl(path: string, params?: Readonly<Record<string, string>> | undefined): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${normalized}`;

    if (params === undefined) return url;

    const search = new URLSearchParams(params).toString();
    return search.length > 0 ? `${url}?${search}` : url;
  }

  /**
   * Parseia a resposta JSON e lança `ProviderError` em caso de erro HTTP.
   */
  private async parseJsonResponse<TResponse>(response: Response): Promise<TResponse> {
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
      const errorEnvelope = responseBody as MetaErrorEnvelope | null;
      const detail = errorEnvelope?.error;

      const retryAfterMs = parseRetryAfterMs(
        response.status === 429 ? response.headers.get('retry-after') : null,
      );

      throw new ProviderError(
        // Não incluir dados do request no message (pode ter PII)
        `Meta Graph API ${response.status}: ${detail?.message ?? detail?.title ?? 'Unknown error'}`,
        response.status,
        detail?.code,
        // Apenas dados diagnósticos sem PII
        { fbtrace_id: detail?.fbtrace_id, error_subcode: detail?.error_subcode },
        retryAfterMs > 0 ? retryAfterMs : undefined,
        detail?.title,
      );
    }

    // Resposta 2xx — retornar body parseado
    // `as TResponse` é necessário aqui pois `fetch` retorna `unknown`.
    // Seguro: o caller é responsável por validar com Zod na boundary.
    return responseBody as TResponse;
  }
}

// ---------------------------------------------------------------------------
// Factory — ponto de entrada público
// ---------------------------------------------------------------------------

/**
 * Cria uma instância do `GraphClient` configurada com as credenciais do canal.
 *
 * O client é configurado por canal — cada canal tem seu próprio `accessToken`
 * decifrado de `channel_secrets.access_token_enc`.
 *
 * LGPD: `accessToken` é PII de nível alto — nunca logar, nunca retornar em DTO.
 *
 * @param options  Opções incluindo `accessToken` decifrado.
 * @returns        Instância de `GraphClient`.
 */
export function createGraphClient(options: GraphClientOptions): GraphClient {
  return new GraphClientImpl(options);
}

// Expor classe internamente para testes
export { GraphClientImpl as _GraphClientImpl };
