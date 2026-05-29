// =============================================================================
// integrations/meta-whatsapp/client.ts — Cliente Meta WhatsApp Cloud API.
//
// Responsabilidades:
//   - Envio de template messages aprovadas (HSM) via POST /messages.
//   - Autenticação via Bearer token (META_WHATSAPP_ACCESS_TOKEN).
//   - Timeout de 30s por request (AbortSignal).
//   - Retry automático em 429 e 5xx: 3 tentativas, backoff exponencial com jitter.
//   - Sem retry em erros 4xx (exceto 429) — são erros do caller/template.
//   - Logs estruturados: `to_hash` em vez de `to` (LGPD §8.3 — telefone é PII).
//
// LGPD §8.3 — REGRA ABSOLUTA:
//   O número de telefone (`to`) NUNCA deve aparecer em logs estruturados.
//   Usar SEMPRE `to_hash` (HMAC-SHA256 via hashDocument) para rastreabilidade
//   sem exposição de PII. O campo `to` só trafega no corpo da chamada HTTP.
//
// Uso:
//   const client = new MetaWhatsAppClient();   // lê env automaticamente
//   const { wamid } = await client.sendTemplate({
//     to: '+5511999999999',
//     templateName: 'followup_d1',
//     language: 'pt_BR',
//     components: [{ type: 'body', parameters: [{ type: 'text', text: 'João' }] }],
//   });
//
// Separação de responsabilidades:
//   Este cliente é EXCLUSIVO para envio de templates aprovados (F5-S03).
//   Gerenciamento do catálogo de templates (sync, status) será implementado
//   em slot futuro (F5-S09) com cliente separado se necessário.
// =============================================================================
import { createHmac } from 'node:crypto';

import { env } from '../../config/env.js';
import { ExternalServiceError } from '../../shared/errors.js';

import type {
  MetaApiErrorDetail,
  MetaWhatsAppClientOptions,
  SendTemplateParams,
  SendTemplateResult,
} from './types.js';

// ---------------------------------------------------------------------------
// Constantes de retry
// ---------------------------------------------------------------------------

/** Número máximo de tentativas (1 original + 2 retries = 3 total). */
const DEFAULT_MAX_ATTEMPTS = 3;

/** Base do backoff exponencial em ms. Meta tier-1: 200msg/s, backoff agressivo. */
const DEFAULT_BACKOFF_BASE_MS = 500;

/** Fator multiplicador do backoff (2x por tentativa). */
const BACKOFF_FACTOR = 2;

/** Jitter máximo em ms. Evita thundering herd em múltiplos workers. */
const DEFAULT_JITTER_MAX_MS = 200;

/** Timeout por request em ms (Meta API pode ser lenta em horários de pico). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Versão da Graph API. Atualizar quando Meta deprecar. */
const GRAPH_API_VERSION = 'v20.0';

/** URL base da Meta Graph API. */
const META_GRAPH_BASE_URL = 'https://graph.facebook.com';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/**
 * Calcula o delay de backoff exponencial com jitter.
 * delay = min(base * factor^attempt, 32000) + random(0, jitterMax)
 *
 * @param attempt 0-indexed (0 = primeiro retry, 1 = segundo retry).
 */
function calcBackoffDelay(attempt: number, baseMs: number, jitterMaxMs: number): number {
  const exponential = baseMs * Math.pow(BACKOFF_FACTOR, attempt);
  const capped = Math.min(exponential, 32_000);
  const jitter = Math.random() * jitterMaxMs;
  return Math.round(capped + jitter);
}

/**
 * Retorna `true` se o erro é elegível para retry.
 * Retry em: 429 (rate limit), 5xx (servidor Meta fora), erros de rede.
 * Sem retry em: 4xx (exceto 429), template inválido, etc.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof ExternalServiceError) {
    const status = (error.details as { upstreamStatus?: number } | undefined)?.upstreamStatus ?? 0;
    return status === 429 || status >= 500 || status === 0;
  }
  return error instanceof TypeError;
}

/**
 * Gera HMAC-SHA256 do número de telefone para uso em logs (sem PII bruta).
 * Usa LGPD_DEDUPE_PEPPER como chave — mesma chave do hashDocument do pii.ts.
 *
 * Nota: usamos createHmac direto aqui (sem importar pii.ts) pois este módulo
 * é importado antes da inicialização completa da app em workers standalone.
 * O pepper é lido do env que já foi validado.
 */
function hashPhone(phoneE164: string): string {
  const pepper = env.LGPD_DEDUPE_PEPPER;
  return createHmac('sha256', pepper).update(phoneE164, 'utf8').digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Tipos da resposta bruta da Meta API
// ---------------------------------------------------------------------------

interface MetaMessageResponse {
  messages?: Array<{ id: string }>;
  error?: MetaApiErrorDetail;
}

// ---------------------------------------------------------------------------
// MetaWhatsAppClient
// ---------------------------------------------------------------------------

/**
 * Cliente HTTP para a Meta WhatsApp Cloud API.
 *
 * Envia template messages aprovadas (HSM) para números fora da janela de 24h.
 * Logs estruturados usam `to_hash` (HMAC truncado a 16 chars) — nunca `to`.
 *
 * Configuração via env (precedência) ou opções injetadas (testes):
 *   META_WHATSAPP_ACCESS_TOKEN — Bearer token da Meta Business Suite.
 *   META_WHATSAPP_PHONE_NUMBER_ID — ID do número de telefone registrado na Meta.
 *
 * @throws ExternalServiceError em qualquer falha (após retries).
 */
export class MetaWhatsAppClient {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly jitterMaxMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: MetaWhatsAppClientOptions = {}) {
    const resolvedToken = options.accessToken ?? env.META_WHATSAPP_ACCESS_TOKEN;
    const resolvedPhoneId = options.phoneNumberId ?? env.META_WHATSAPP_PHONE_NUMBER_ID;

    if (resolvedToken === undefined || resolvedToken === '') {
      throw new ExternalServiceError(
        'META_WHATSAPP_ACCESS_TOKEN não configurado — Meta WhatsApp indisponível',
        { upstreamStatus: 0 },
      );
    }
    if (resolvedPhoneId === undefined || resolvedPhoneId === '') {
      throw new ExternalServiceError(
        'META_WHATSAPP_PHONE_NUMBER_ID não configurado — Meta WhatsApp indisponível',
        { upstreamStatus: 0 },
      );
    }

    this.accessToken = resolvedToken;
    this.phoneNumberId = resolvedPhoneId;
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
   * Envia um template message aprovado para o destinatário.
   *
   * LGPD §8.3: `params.to` é usado apenas no corpo HTTP e nunca logado.
   * Logs usam `to_hash` (HMAC truncado a 16 chars) para rastreabilidade segura.
   *
   * @param params  Parâmetros de envio (to, templateName, language, components).
   * @returns       { wamid } — ID da mensagem na Meta para rastreamento de delivery.
   * @throws        ExternalServiceError em falha definitiva (após retries esgotados).
   */
  async sendTemplate(params: SendTemplateParams): Promise<SendTemplateResult> {
    const url = `${META_GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${this.phoneNumberId}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.language },
        components: params.components,
      },
    };

    const raw = await this.requestWithRetry('POST', url, body);
    const parsed = raw as MetaMessageResponse;

    // Extrair wamid da resposta
    const wamid = parsed.messages?.[0]?.id;
    if (wamid === undefined || wamid === '') {
      throw new ExternalServiceError('Meta API retornou resposta sem wamid — verificar payload', {
        upstreamStatus: 0,
        response: parsed,
      });
    }

    return { wamid };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Executa uma requisição HTTP com retry em 429/5xx.
   * Respeita o header Retry-After em 429: se presente e numérico, usa como delay mínimo.
   */
  private async requestWithRetry(
    method: string,
    url: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = calcBackoffDelay(attempt - 1, this.backoffBaseMs, this.jitterMaxMs);

        // Respeitar Retry-After da Meta se presente (isFinite já garante que é número válido).
        const retryAfterMs =
          lastError instanceof ExternalServiceError
            ? ((lastError.details as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 0)
            : 0;

        const delay = Math.max(backoff, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
        await this.sleepFn(delay);
      }

      try {
        return await this.doFetch(method, url, body);
      } catch (err) {
        lastError = err;

        if (!isRetryable(err)) {
          throw err;
        }
        // 429 / 5xx / rede — continua para próxima iteração
      }
    }

    throw lastError;
  }

  /**
   * Executa uma única requisição HTTP com timeout.
   *
   * LGPD: O `body` contém `to` (telefone), mas nunca é logado.
   * Apenas `to_hash` aparece nos logs de erro para rastreabilidade.
   */
  private async doFetch(
    method: string,
    url: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    // Extrair `to` para hash de log ANTES de montar body (sem guardar referência)
    // O campo `to` dentro de `body` só existe no corpo HTTP — nunca em logs.
    const toHash = typeof body['to'] === 'string' ? hashPhone(body['to']) : 'unknown';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ExternalServiceError(
          `Meta WhatsApp API timeout após ${this.timeoutMs}ms`,
          // to_hash em vez de to_phone — LGPD §8.3
          { upstreamStatus: 0, to_hash: toHash },
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Tentar parsear body JSON para extrair erro estruturado
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
      const errorDetail = (responseBody as MetaMessageResponse | null)?.error;

      // Respeitar Retry-After em 429: se o header for um inteiro numérico, convertemos
      // para ms e incluímos nos details para que requestWithRetry possa usar como delay.
      // isFinite filtra HTTP-date e valores não-numéricos — nesses casos ignoramos.
      const retryAfterRaw = response.status === 429 ? response.headers.get('retry-after') : null;
      const retryAfterMs = retryAfterRaw !== null ? parseInt(retryAfterRaw, 10) * 1000 : undefined;

      throw new ExternalServiceError(
        `Meta WhatsApp API ${response.status}: ${errorDetail?.title ?? 'Unknown error'}`,
        // to_hash em vez de to_phone — LGPD §8.3. Code/title da Meta para diagnóstico.
        {
          upstreamStatus: response.status,
          meta_error_code: errorDetail?.code,
          meta_error_title: errorDetail?.title,
          to_hash: toHash,
          retryAfterMs:
            retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        },
      );
    }

    return responseBody;
  }
}
