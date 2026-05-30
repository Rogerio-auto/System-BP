// =============================================================================
// templates/metaClient.ts — Cliente Meta Cloud API para gestão de templates.
//
// Responsabilidades:
//   - submitTemplate()  → POST /{waba_id}/message_templates
//   - getTemplate()     → GET /{meta_template_id}
//   - listTemplates()   → GET /{waba_id}/message_templates
//   - Retry em 429/5xx: exponential backoff com jitter.
//   - Respeita Retry-After em 429.
//   - Timeout configurável (default 30s).
//   - Erros sanitizados (nunca vaza token).
//
// Separação de responsabilidades:
//   Este cliente gerencia o CATÁLOGO de templates (F5-S09).
//   O cliente de ENVIO de mensagens está em integrations/meta-whatsapp/client.ts (F5-S03).
//
// LGPD:
//   - Access token nunca logado (apenas presence/absence).
//   - WABA ID não é PII — pode aparecer em logs de contexto.
//   - Bodies de template não contêm PII (validação upstream no createSchema).
//
// Nota sobre WABA_ID:
//   A Meta requer o WABA ID (WhatsApp Business Account ID) nos endpoints de
//   gestão de templates. META_WABA_ID foi adicionado ao envSchema (F5-S09 security fix).
//   Fallback para META_WHATSAPP_PHONE_NUMBER_ID mantido para dev/test.
//   ANTES DO GO-LIVE: configurar META_WABA_ID explicitamente.
// =============================================================================

import { env } from '../../config/env.js';
import { ExternalServiceError } from '../../shared/errors.js';

// ---------------------------------------------------------------------------
// Constantes de retry
// ---------------------------------------------------------------------------

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 500;
const BACKOFF_FACTOR = 2;
const DEFAULT_JITTER_MAX_MS = 200;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const GRAPH_API_VERSION = 'v20.0';
const META_GRAPH_BASE_URL = 'https://graph.facebook.com';

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function calcBackoffDelay(attempt: number, baseMs: number, jitterMaxMs: number): number {
  const exponential = baseMs * Math.pow(BACKOFF_FACTOR, attempt);
  const capped = Math.min(exponential, 32_000);
  const jitter = Math.random() * jitterMaxMs;
  return Math.round(capped + jitter);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ExternalServiceError) {
    const status = (error.details as { upstreamStatus?: number } | undefined)?.upstreamStatus ?? 0;
    return status === 429 || status >= 500 || status === 0;
  }
  return error instanceof TypeError;
}

// ---------------------------------------------------------------------------
// Tipos da Meta API para gestão de templates
// ---------------------------------------------------------------------------

export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  text?: string;
}

export interface MetaSubmitTemplatePayload {
  name: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  language: string;
  components: MetaTemplateComponent[];
}

export interface MetaTemplateRecord {
  id: string;
  name: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'IN_APPEAL';
  category: string;
  language: string;
  components?: MetaTemplateComponent[];
}

interface MetaSubmitResponse {
  id?: string;
  error?: { message: string; code: number; title?: string };
}

interface MetaListResponse {
  data?: MetaTemplateRecord[];
  error?: { message: string; code: number; title?: string };
}

// ---------------------------------------------------------------------------
// Options de injeção (para testes)
// ---------------------------------------------------------------------------

export interface MetaTemplatesClientOptions {
  accessToken?: string;
  wabaId?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  jitterMaxMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// MetaTemplatesClient
// ---------------------------------------------------------------------------

/**
 * Cliente HTTP para gestão do catálogo de templates WhatsApp via Meta Graph API.
 *
 * Separado do MetaWhatsAppClient (envio de mensagens) por responsabilidade única.
 *
 * Configuração:
 *   META_WHATSAPP_ACCESS_TOKEN — Bearer token da Meta Business Suite.
 *   META_WABA_ID — WhatsApp Business Account ID (adicionado ao envSchema em F5-S09 security fix).
 *     Fallback para META_WHATSAPP_PHONE_NUMBER_ID em dev/test se META_WABA_ID ausente.
 *     ANTES DO GO-LIVE: configurar META_WABA_ID e remover o fallback.
 */
export class MetaTemplatesClient {
  private readonly accessToken: string;
  private readonly wabaId: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly jitterMaxMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(options: MetaTemplatesClientOptions = {}) {
    const resolvedToken = options.accessToken ?? env.META_WHATSAPP_ACCESS_TOKEN;

    // L-1: META_WABA_ID agora está em env.ts (F5-S09 security fix).
    // Fallback para META_WHATSAPP_PHONE_NUMBER_ID: funcionalmente incorreto em produção
    // mas mantido para compatibilidade de dev/test onde apenas o phone_number_id está configurado.
    // ANTES DO GO-LIVE: configurar META_WABA_ID explicitamente e remover o fallback.
    const resolvedWabaId = options.wabaId ?? env.META_WABA_ID ?? env.META_WHATSAPP_PHONE_NUMBER_ID;

    if (!resolvedToken) {
      throw new ExternalServiceError(
        'META_WHATSAPP_ACCESS_TOKEN não configurado — gestão de templates Meta indisponível',
        { upstreamStatus: 0 },
      );
    }
    if (!resolvedWabaId) {
      throw new ExternalServiceError(
        'META_WABA_ID (ou META_WHATSAPP_PHONE_NUMBER_ID) não configurado — gestão de templates Meta indisponível',
        { upstreamStatus: 0 },
      );
    }

    this.accessToken = resolvedToken;
    this.wabaId = resolvedWabaId;
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
   * Submete um template para aprovação na Meta.
   * POST /{waba_id}/message_templates
   *
   * @returns Meta template ID (opaque string) atribuído pela Meta.
   */
  async submitTemplate(payload: MetaSubmitTemplatePayload): Promise<string> {
    const url = `${META_GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${this.wabaId}/message_templates`;
    // Cast justificado: MetaSubmitTemplatePayload é serializável e compatível com Record<string, unknown> em runtime.
    const raw = (await this.requestWithRetry(
      'POST',
      url,
      payload as unknown as Record<string, unknown>,
    )) as MetaSubmitResponse;

    if (!raw.id) {
      throw new ExternalServiceError(
        'Meta API: submitTemplate retornou resposta sem id — verificar payload',
        { upstreamStatus: 0 },
      );
    }
    return raw.id;
  }

  /**
   * Busca o status atual de um template na Meta pelo seu ID externo.
   * GET /{meta_template_id}
   */
  async getTemplate(metaTemplateId: string): Promise<MetaTemplateRecord> {
    const url = `${META_GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(metaTemplateId)}`;
    const raw = (await this.requestWithRetry('GET', url, {})) as MetaTemplateRecord;
    return raw;
  }

  /**
   * Lista todos os templates do WABA.
   * GET /{waba_id}/message_templates
   * Usado pelo sync-all.
   */
  async listTemplates(): Promise<MetaTemplateRecord[]> {
    const url = `${META_GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${this.wabaId}/message_templates`;
    const raw = (await this.requestWithRetry('GET', url, {})) as MetaListResponse;
    return raw.data ?? [];
  }

  /**
   * Deleta um template na Meta pelo nome.
   * DELETE /{waba_id}/message_templates?name=<template_name>
   *
   * Usado para compensação quando o INSERT local falha após submitTemplate().
   * A Meta identifica templates para deleção pelo nome, não pelo ID numérico.
   *
   * @param templateName  Nome exato do template enviado no submitTemplate().
   */
  async deleteTemplate(templateName: string): Promise<void> {
    const url = `${META_GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${this.wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;
    // DELETE não envia body — passamos objeto vazio e o doFetch usa body apenas para !GET
    await this.requestWithRetry('DELETE', url, {});
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requestWithRetry(
    method: string,
    url: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (attempt > 0) {
        const backoff = calcBackoffDelay(attempt - 1, this.backoffBaseMs, this.jitterMaxMs);
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
        if (!isRetryable(err)) throw err;
      }
    }

    throw lastError;
  }

  private async doFetch(
    method: string,
    url: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          // Token nunca logado — apenas usado na requisição HTTP.
          Authorization: `Bearer ${this.accessToken}`,
        },
        signal: controller.signal,
      };
      if (method !== 'GET' && method !== 'DELETE') {
        init.body = JSON.stringify(body);
      }
      response = await fetch(url, init);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ExternalServiceError(`Meta Templates API timeout após ${this.timeoutMs}ms`, {
          upstreamStatus: 0,
        });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

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
      const errorDetail = (
        responseBody as { error?: { message: string; code: number; title?: string } } | null
      )?.error;
      const retryAfterRaw = response.status === 429 ? response.headers.get('retry-after') : null;
      const retryAfterMs = retryAfterRaw !== null ? parseInt(retryAfterRaw, 10) * 1000 : undefined;

      throw new ExternalServiceError(
        // Sanitizado: apenas code/title da Meta, nunca token
        `Meta Templates API ${response.status}: ${errorDetail?.title ?? errorDetail?.message ?? 'Unknown error'}`,
        {
          upstreamStatus: response.status,
          meta_error_code: errorDetail?.code,
          meta_error_title: errorDetail?.title,
          retryAfterMs:
            retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        },
      );
    }

    return responseBody;
  }
}
