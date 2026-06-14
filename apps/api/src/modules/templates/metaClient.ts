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

// ---------------------------------------------------------------------------
// Allowlist de MIME types aceitos pela Meta para mídia em templates.
//
// Fonte: Meta Cloud API — suporte a mídia em mensagens / templates.
// Nota: fileParser.ts (CSV/XLSX) tem allowlist própria para outro domínio;
// não reutilizamos para evitar acoplamento entre módulos não relacionados.
// Se ampliar, atualizar também em integrations/meta-whatsapp/client.ts.
// ---------------------------------------------------------------------------
const META_ALLOWED_MEDIA_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

type MetaAllowedMediaMimeType = (typeof META_ALLOWED_MEDIA_MIME_TYPES)[number];

function assertAllowedMimeType(mimeType: string): asserts mimeType is MetaAllowedMediaMimeType {
  if (!(META_ALLOWED_MEDIA_MIME_TYPES as ReadonlyArray<string>).includes(mimeType)) {
    throw new ExternalServiceError(
      `MIME type não permitido para upload Meta: valor rejeitado pela allowlist`,
      { upstreamStatus: 0 },
    );
  }
}
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

/**
 * Componente de template Meta (catálogo).
 *
 * Para HEADER com mídia (boleto):
 *   - `format`: 'DOCUMENT' | 'IMAGE' | 'VIDEO'
 *   - `example.header_handle`: obtido via `uploadSampleForTemplate()`.
 *
 * Para HEADER com texto: `format: 'TEXT'` + `text`.
 * Para BODY/FOOTER: apenas `text` (format não se aplica).
 * Para BUTTONS: usar estrutura apropriada (não detalhado neste slot).
 */
export interface MetaTemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  /** Conteúdo textual do componente (BODY, FOOTER, ou HEADER de texto). */
  text?: string;
  /**
   * Formato do componente HEADER.
   * TEXT: cabeçalho de texto (com `text`).
   * DOCUMENT/IMAGE/VIDEO: cabeçalho de mídia (requer `example.header_handle`).
   */
  format?: 'TEXT' | 'DOCUMENT' | 'IMAGE' | 'VIDEO';
  /**
   * Exemplos exigidos pela Meta para componentes com variáveis ou mídia.
   * Para HEADER de mídia: `header_handle` é o handle da amostra subida via resumable upload.
   * Para BODY com variáveis: `body_text` é uma lista de arrays de valores de exemplo.
   */
  example?: {
    /** Handles de amostras de mídia (obtidos via uploadSampleForTemplate). */
    header_handle?: string[];
    /** Valores de exemplo para variáveis do corpo {{1}}, {{2}}, etc. */
    body_text?: string[][];
  };
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
// Tipos internos de resposta para resumable upload
// ---------------------------------------------------------------------------

interface MetaResumableStartResponse {
  id?: string;
  error?: { message: string; code: number; title?: string };
}

interface MetaResumableFinishResponse {
  /** handle gerado para uso em example.header_handle do template. */
  h?: string;
  error?: { message: string; code: number; title?: string };
}

// ---------------------------------------------------------------------------
// Options de injeção (para testes)
// ---------------------------------------------------------------------------

export interface MetaTemplatesClientOptions {
  accessToken?: string;
  wabaId?: string;
  /**
   * Meta App ID (necessário para resumable upload de amostras de template).
   * Lido de META_APP_ID se ausente.
   * Opcional: uploadSampleForTemplate() lança se ausente ao ser chamado.
   */
  appId?: string;
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
  /**
   * App ID da Meta (opcional no construtor — obrigatório apenas para uploadSampleForTemplate).
   * Lido de META_APP_ID no env; ausente em dev/test é aceito.
   */
  private readonly appId: string | undefined;
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
    // appId: injeção via options tem precedência (testes); depois META_APP_ID do env.
    // Não lançamos erro aqui — uploadSampleForTemplate() lança se for chamado sem appId.
    this.appId = options.appId ?? env.META_APP_ID;
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

  /**
   * Faz upload de uma **amostra** de mídia para uso em `example.header_handle` ao registrar
   * um template com header de mídia (DOCUMENT/IMAGE/VIDEO) na Meta.
   *
   * Fluxo de resumable upload (Meta Graph API):
   *   1. POST /{app_id}/uploads  → inicia a sessão, retorna `upload_session_id`.
   *   2. POST /{upload_session_id} (binário, Authorization: OAuth) → retorna `h` (header_handle).
   *
   * O `header_handle` retornado deve ser salvo em `whatsapp_templates.header_handle`
   * e incluído no payload de `submitTemplate()` como `example.header_handle: [handle]`.
   *
   * **Atenção:** Este upload é apenas da **amostra** para aprovação do template.
   * Para enviar o boleto real em runtime, usar `MetaWhatsAppClient.uploadMedia()` (F5-S03).
   * Ver doc 07 §1.6 #midia-boleto para o fluxo completo.
   *
   * LGPD §8.3: `bytes` nunca são logados. Apenas `mimeType` aparece em contexto de erro.
   * O token de acesso nunca é exposto em erros lançados.
   *
   * @param bytes     Bytes do arquivo de amostra.
   * @param mimeType  MIME type (ex: "application/pdf", "image/jpeg").
   * @returns         `header_handle` para uso em MetaTemplateComponent.example.header_handle.
   * @throws          ExternalServiceError se META_APP_ID não configurado ou falha na API.
   */
  async uploadSampleForTemplate(bytes: Buffer, mimeType: string): Promise<string> {
    if (!this.appId) {
      throw new ExternalServiceError(
        'META_APP_ID não configurado — necessário para resumable upload de amostras de template',
        { upstreamStatus: 0 },
      );
    }

    // M-1: rejeitar MIME types fora da allowlist ANTES de qualquer chamada HTTP.
    assertAllowedMimeType(mimeType);

    // Etapa 1: iniciar sessão de upload (com retry via requestWithRetry)
    const startUrl = `${META_GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${this.appId}/uploads`;
    const startPayload: Record<string, unknown> = {
      file_length: bytes.length,
      file_type: mimeType,
    };
    const startRaw = (await this.requestWithRetry(
      'POST',
      startUrl,
      startPayload,
    )) as MetaResumableStartResponse;

    if (!startRaw.id) {
      throw new ExternalServiceError('Meta API: resumable upload (start) não retornou session id', {
        upstreamStatus: 0,
        mimeType,
      });
    }

    const uploadSessionId = startRaw.id;

    // L-2: encodeURIComponent para consistência com outros IDs de path (ex: metaTemplateId).
    // M-2: etapa 2 agora passa por requestWithRetryResumable (429/5xx com backoff).
    const uploadUrl = `${META_GRAPH_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(uploadSessionId)}`;
    const finishRaw = await this.requestWithRetryResumable(uploadUrl, bytes, mimeType);

    if (!finishRaw.h) {
      throw new ExternalServiceError(
        'Meta API: resumable upload (finish) não retornou header_handle',
        { upstreamStatus: 0, mimeType },
      );
    }

    return finishRaw.h;
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

  /**
   * Wrapper de retry para a etapa 2 do resumable upload (M-2).
   *
   * A etapa 1 já usa requestWithRetry. A etapa 2 (envio binário) precisa do mesmo
   * tratamento de 429/5xx — separamos em método próprio porque o body é Buffer, não JSON.
   * Mesma lógica de backoff/jitter/Retry-After de requestWithRetry.
   */
  private async requestWithRetryResumable(
    url: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<MetaResumableFinishResponse> {
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
        return await this.doFetchResumableUpload(url, bytes, mimeType);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
      }
    }

    throw lastError;
  }

  /**
   * Executa a etapa 2 do resumable upload (envio dos bytes) para a Meta Graph API.
   *
   * A Meta usa "Authorization: OAuth <token>" (não Bearer) neste endpoint específico.
   * Content-Type deve ser o mimeType do arquivo, não application/json.
   * M-1: mimeType já foi validado contra allowlist em uploadSampleForTemplate antes de chegar aqui.
   *
   * LGPD §8.3: `bytes` nunca são logados. Token nunca exposto em erro.
   */
  private async doFetchResumableUpload(
    url: string,
    bytes: Buffer,
    mimeType: string,
  ): Promise<MetaResumableFinishResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          // Meta Graph API usa "OAuth" (não "Bearer") no upload de bytes do resumable upload.
          Authorization: `OAuth ${this.accessToken}`,
          'Content-Type': mimeType,
          file_offset: '0',
        },
        // Buffer como body binário — Node fetch aceita BufferSource.
        body: bytes,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ExternalServiceError(
          `Meta Templates API (resumable upload) timeout após ${this.timeoutMs}ms`,
          { upstreamStatus: 0, mimeType },
        );
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
      const errorDetail = (responseBody as MetaResumableFinishResponse | null)?.error;
      const retryAfterRaw = response.status === 429 ? response.headers.get('retry-after') : null;
      const retryAfterMs = retryAfterRaw !== null ? parseInt(retryAfterRaw, 10) * 1000 : undefined;

      throw new ExternalServiceError(
        `Meta Templates API (resumable upload) ${response.status}: ${errorDetail?.title ?? errorDetail?.message ?? 'Unknown error'}`,
        {
          upstreamStatus: response.status,
          meta_error_code: errorDetail?.code,
          meta_error_title: errorDetail?.title,
          mimeType,
          retryAfterMs:
            retryAfterMs !== undefined && Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
        },
      );
    }

    return (responseBody ?? {}) as MetaResumableFinishResponse;
  }
}
