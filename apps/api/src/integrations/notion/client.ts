// =============================================================================
// integrations/notion/client.ts — Cliente HTTP para a Notion API (read-only).
//
// Responsabilidades:
//   - Autenticação via Bearer token (env NOTION_INTEGRATION_TOKEN).
//   - `listDatabasePages` — paginação de pages de uma database.
//   - `getPageProperties` — propriedades de uma page individual.
//   - Rate-limit aware: 3 req/s com backoff exponencial em 429.
//   - Retry automático em 429 e 5xx (até maxAttempts tentativas).
//   - Sem retry em 4xx (!= 429) — erro do chamador.
//   - Validação de shape mínimo da resposta antes de retornar.
//   - Timeout configurável via AbortSignal.
//
// LGPD §12.1 (doc 17):
//   - Notion é suboperador internacional temporário (janela de migração ≤30 dias).
//   - Apenas `notion_page_id` e contagens são seguros para log.
//   - Valores de `properties` nunca logados (podem ser PII).
//   - Token armazenado em env, nunca no banco.
//
// Uso:
//   const client = new NotionClient();
//   const { results, nextCursor } = await client.listDatabasePages(dbId);
//   const props = await client.getPageProperties(pageId);
// =============================================================================
import { env } from '../../config/env.js';
import { ExternalServiceError } from '../../shared/errors.js';

import type { NotionDatabaseQueryResponse, NotionPage, NotionPropertiesMap } from './types.js';

// ---------------------------------------------------------------------------
// Constantes de retry e rate-limit
// ---------------------------------------------------------------------------

/** Máximo de requests por segundo permitido pela Notion API (burst tolerado). */
const NOTION_RPS_LIMIT = 3;

/** Intervalo mínimo entre requests em ms (1000ms / 3 req/s). */
const MIN_INTERVAL_MS = Math.ceil(1000 / NOTION_RPS_LIMIT);

/** Número máximo de tentativas (1 original + retries). */
const DEFAULT_MAX_ATTEMPTS = 4;

/** Base do backoff exponencial em ms. */
const DEFAULT_BACKOFF_BASE_MS = 300;

/** Fator multiplicador a cada tentativa. */
const BACKOFF_FACTOR = 2;

/** Jitter máximo em ms (evita thundering herd). */
const DEFAULT_JITTER_MAX_MS = 150;

/** Timeout por request em ms. */
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Versão da Notion API requerida pelo cliente. */
const NOTION_API_VERSION = '2022-06-28';

/** URL base da Notion API. */
const NOTION_API_BASE = 'https://api.notion.com/v1';

// ---------------------------------------------------------------------------
// Opções de configuração
// ---------------------------------------------------------------------------

export interface NotionClientOptions {
  /** Override de token (precedência sobre env). Para testes. */
  token?: string;
  /** Timeout em ms por request. Default: 15000. */
  timeoutMs?: number;
  /** Número máximo de tentativas. Default: 4. */
  maxAttempts?: number;
  /** Base do backoff exponencial em ms. Default: 300. */
  backoffBaseMs?: number;
  /** Jitter máximo em ms. Default: 150. */
  jitterMaxMs?: number;
  /** Sleep injetável para testes. Default: setTimeout wrapper. */
  sleepFn?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function calcBackoffDelay(attempt: number, baseMs: number, jitterMaxMs: number): number {
  const exponential = baseMs * Math.pow(BACKOFF_FACTOR, attempt);
  const capped = Math.min(exponential, 16_000);
  const jitter = Math.random() * jitterMaxMs;
  return Math.round(capped + jitter);
}

function isRetryableStatus(status: number): boolean {
  // 429 = rate-limited; 5xx = servidor
  return status === 429 || status >= 500;
}

// ---------------------------------------------------------------------------
// Extração segura de texto de propriedade (sem expor PII em logs)
// ---------------------------------------------------------------------------

/**
 * Extrai o texto plano de um valor de propriedade Notion.
 * Suporta title, rich_text, phone_number, email, select, status, url, number.
 * Retorna null para tipos desconhecidos ou valores vazios.
 *
 * LGPD: esta função opera em memória — o chamador é responsável por não logar o resultado.
 */
export function extractNotionPropertyText(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;

  const v = value as Record<string, unknown>;
  const type = v['type'];

  if (type === 'title') {
    const arr = v['title'];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return (arr as Array<{ plain_text: string }>).map((t) => t.plain_text).join('') || null;
  }

  if (type === 'rich_text') {
    const arr = v['rich_text'];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return (arr as Array<{ plain_text: string }>).map((t) => t.plain_text).join('') || null;
  }

  if (type === 'phone_number') {
    const val = v['phone_number'];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }

  if (type === 'email') {
    const val = v['email'];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }

  if (type === 'select') {
    const sel = v['select'];
    if (typeof sel === 'object' && sel !== null) {
      const name = (sel as Record<string, unknown>)['name'];
      return typeof name === 'string' && name.length > 0 ? name : null;
    }
    return null;
  }

  if (type === 'status') {
    const st = v['status'];
    if (typeof st === 'object' && st !== null) {
      const name = (st as Record<string, unknown>)['name'];
      return typeof name === 'string' && name.length > 0 ? name : null;
    }
    return null;
  }

  if (type === 'url') {
    const val = v['url'];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }

  if (type === 'number') {
    const val = v['number'];
    return val !== null && val !== undefined ? String(val) : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// NotionClient
// ---------------------------------------------------------------------------

/**
 * Cliente HTTP read-only para a Notion API.
 *
 * Gerencia autenticação, rate-limiting (3 req/s), retry em 429/5xx e timeout.
 * Lança `ExternalServiceError` em qualquer falha não recuperável.
 *
 * @example
 * const client = new NotionClient();
 * const { results, nextCursor } = await client.listDatabasePages(databaseId);
 */
export class NotionClient {
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly jitterMaxMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  /** Timestamp do último request completado (para enforçar rate-limit). */
  private lastRequestAt = 0;

  constructor(options: NotionClientOptions = {}) {
    const resolvedToken = options.token ?? env.NOTION_INTEGRATION_TOKEN;

    if (resolvedToken === undefined || resolvedToken.length === 0) {
      throw new ExternalServiceError(
        'NOTION_INTEGRATION_TOKEN não configurado — integração Notion indisponível',
      );
    }

    this.token = resolvedToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.jitterMaxMs = options.jitterMaxMs ?? DEFAULT_JITTER_MAX_MS;
    this.sleepFn =
      options.sleepFn ??
      ((ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  // -------------------------------------------------------------------------
  // Métodos públicos
  // -------------------------------------------------------------------------

  /**
   * Lista pages de uma database Notion com paginação por cursor.
   *
   * Filtra pages arquivadas automaticamente (archived: true).
   * Retorna até 100 pages por chamada (limite da Notion API).
   *
   * LGPD: apenas `notion_page_id` dos results é seguro para log externo.
   *
   * @param databaseId  ID da database Notion.
   * @param cursor      Cursor de paginação (retornado por chamada anterior), ou undefined.
   * @returns           { results: NotionPage[], nextCursor: string | null }
   */
  async listDatabasePages(
    databaseId: string,
    cursor?: string,
  ): Promise<{ results: NotionPage[]; nextCursor: string | null }> {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor !== undefined) {
      body['start_cursor'] = cursor;
    }

    const raw = await this.request('POST', `/databases/${databaseId}/query`, body);

    // Validação mínima de shape (sem Zod para não inflar o bundle de libs)
    if (
      typeof raw !== 'object' ||
      raw === null ||
      !Array.isArray((raw as Record<string, unknown>)['results'])
    ) {
      throw new ExternalServiceError('Resposta inesperada da Notion API: campo results ausente', {
        databaseId,
      });
    }

    const response = raw as NotionDatabaseQueryResponse;

    // Filtra páginas arquivadas — não migrar lixo
    const activePages = response.results.filter(
      (page) => typeof page === 'object' && page !== null && !page.archived,
    );

    return {
      results: activePages,
      nextCursor: response.next_cursor,
    };
  }

  /**
   * Retorna as propriedades de uma page Notion.
   *
   * Faz GET na page e extrai apenas o campo `properties`.
   * A page completa não é retornada para evitar vazar outros metadados.
   *
   * LGPD: retorno pode conter PII. Caller responsável por não logar.
   *
   * @param pageId  ID da page Notion.
   * @returns       Mapa de nome da propriedade → valor.
   */
  async getPageProperties(pageId: string): Promise<NotionPropertiesMap> {
    const raw = await this.request('GET', `/pages/${pageId}`, undefined);

    if (typeof raw !== 'object' || raw === null) {
      throw new ExternalServiceError('Resposta inesperada da Notion API: page inválida', {
        pageId,
      });
    }

    const page = raw as Record<string, unknown>;
    const properties = page['properties'];

    if (typeof properties !== 'object' || properties === null) {
      throw new ExternalServiceError(
        'Resposta inesperada da Notion API: campo properties ausente',
        { pageId },
      );
    }

    return properties as NotionPropertiesMap;
  }

  // -------------------------------------------------------------------------
  // Infraestrutura interna
  // -------------------------------------------------------------------------

  /**
   * Executa um request HTTP para a Notion API com rate-limit e retry.
   *
   * Rate-limit: enforça mínimo de MIN_INTERVAL_MS entre requests.
   * Retry: em 429 ou 5xx, usa backoff exponencial + jitter.
   *
   * @param method  Método HTTP (GET, POST).
   * @param path    Caminho relativo à base (ex: /databases/:id/query).
   * @param body    Corpo JSON (opcional para GET).
   * @returns       Resposta parseada como JSON.
   * @throws        ExternalServiceError em falha não recuperável.
   */
  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | undefined,
  ): Promise<unknown> {
    let lastError: ExternalServiceError | undefined;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      // Enforçar rate-limit (3 req/s) — aguarda intervalo mínimo entre requests
      await this.enforceRateLimit();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      let response: Response | undefined;
      try {
        response = await fetch(`${NOTION_API_BASE}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Notion-Version': NOTION_API_VERSION,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body !== undefined ? JSON.stringify(body) : null,
          signal: controller.signal,
        });
      } catch (fetchErr: unknown) {
        clearTimeout(timeoutId);

        // AbortError = timeout
        if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
          lastError = new ExternalServiceError(
            `Notion API timeout após ${this.timeoutMs}ms em ${method} ${path}`,
            { path },
          );
        } else {
          // Erro de rede
          lastError = new ExternalServiceError(
            `Erro de rede ao acessar Notion API: ${method} ${path}`,
            { path, cause: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) },
          );
        }

        // Retryable: erro de rede pode ser transitório
        if (attempt < this.maxAttempts - 1) {
          const delay = calcBackoffDelay(attempt, this.backoffBaseMs, this.jitterMaxMs);
          await this.sleepFn(delay);
          continue;
        }
        throw lastError;
      } finally {
        clearTimeout(timeoutId);
      }

      this.lastRequestAt = Date.now();

      // Trata 429 — extrai Retry-After se disponível
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('Retry-After');
        const retryAfterMs = retryAfterHeader !== null ? Number(retryAfterHeader) * 1000 : null;

        lastError = new ExternalServiceError(`Notion API rate-limited (429): ${method} ${path}`, {
          path,
        });

        if (attempt < this.maxAttempts - 1) {
          const delay =
            retryAfterMs !== null && retryAfterMs > 0
              ? retryAfterMs
              : calcBackoffDelay(attempt, this.backoffBaseMs, this.jitterMaxMs);
          await this.sleepFn(delay);
          continue;
        }
        throw lastError;
      }

      // Trata 5xx — retryable
      if (response.status >= 500) {
        lastError = new ExternalServiceError(
          `Notion API erro do servidor (${response.status}): ${method} ${path}`,
          { path, upstreamStatus: response.status },
        );

        if (attempt < this.maxAttempts - 1) {
          const delay = calcBackoffDelay(attempt, this.backoffBaseMs, this.jitterMaxMs);
          await this.sleepFn(delay);
          continue;
        }
        throw lastError;
      }

      // Trata 4xx (exceto 429) — não retryable, erro do chamador
      if (response.status >= 400) {
        let details: unknown;
        try {
          details = await response.json();
        } catch {
          details = { rawStatus: response.status };
        }
        throw new ExternalServiceError(
          `Notion API erro do cliente (${response.status}): ${method} ${path}`,
          { path, upstreamStatus: response.status, details },
        );
      }

      // Sucesso 2xx — parse JSON
      try {
        return await response.json();
      } catch (parseErr: unknown) {
        throw new ExternalServiceError(`Notion API retornou JSON inválido: ${method} ${path}`, {
          path,
          cause: parseErr instanceof Error ? parseErr.message : String(parseErr),
        });
      }
    }

    // Esgotou tentativas — lança o último erro registrado
    throw (
      lastError ??
      new ExternalServiceError(`Notion API: tentativas esgotadas em ${method} ${path}`, { path })
    );
  }

  /**
   * Aguarda o intervalo mínimo desde o último request para enforçar 3 req/s.
   * Não-obstante, isso é best-effort — em instâncias múltiplas do worker, o
   * rate-limit da Notion API pode ser excedido e será tratado pelo retry de 429.
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestAt;
    if (elapsed < MIN_INTERVAL_MS && this.lastRequestAt > 0) {
      await this.sleepFn(MIN_INTERVAL_MS - elapsed);
    }
  }
}

// ---------------------------------------------------------------------------
// Exports adicionais
// ---------------------------------------------------------------------------

export { isRetryableStatus };
