// =============================================================================
// integrations/channels/shared/errors.ts — Erros compartilhados da camada de canais.
//
// Hierarquia:
//   AppError (shared/errors.ts)
//     └─ ChannelError        — erro genérico de canal (base)
//          ├─ SignatureError  — HMAC inválido/ausente (→ 403 no webhook handler)
//          ├─ ProviderError   — erro retornado pelo provider (ex: Meta API error code)
//          └─ UnsupportedMessageTypeError — tipo não suportado pelo adapter
//
// Regra: nunca `throw new Error(...)`. Sempre subclasse de AppError.
// =============================================================================
import { AppError } from '../../../shared/errors.js';
import type { ErrorCode } from '../../../shared/errors.js';

// ---------------------------------------------------------------------------
// Códigos de erro de canal (complementam ErrorCode do shared/errors.ts)
// ---------------------------------------------------------------------------

/**
 * Código de erro específico de canal — discrimina o subtipo para o error handler.
 * Prefixo `CHANNEL_` evita colisão com ErrorCode global.
 */
export type ChannelErrorCode =
  | 'CHANNEL_ERROR'
  | 'CHANNEL_SIGNATURE_INVALID'
  | 'CHANNEL_PROVIDER_ERROR'
  | 'CHANNEL_UNSUPPORTED_MESSAGE_TYPE';

// ---------------------------------------------------------------------------
// ChannelError — base
// ---------------------------------------------------------------------------

/**
 * Erro base da camada de canais.
 * Todos os erros específicos de canal estendem esta classe.
 *
 * @example
 * throw new ChannelError('Não foi possível conectar ao canal', { channelId });
 */
export class ChannelError extends AppError {
  readonly channelCode: ChannelErrorCode;

  constructor(
    message: string,
    channelCode: ChannelErrorCode = 'CHANNEL_ERROR',
    httpStatusCode = 502,
    appErrorCode: ErrorCode = 'EXTERNAL_SERVICE_ERROR',
    details?: unknown,
  ) {
    super(httpStatusCode, appErrorCode, message, details);
    this.name = 'ChannelError';
    this.channelCode = channelCode;
    // Garante instanceof correto após transpile ESM
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// SignatureError — HMAC inválido ou ausente
// ---------------------------------------------------------------------------

/**
 * Lançado quando o header `X-Hub-Signature-256` está ausente ou o HMAC
 * não corresponde ao `app_secret` do canal.
 *
 * O webhook handler deve converter em 403 Forbidden — não revela detalhes
 * do motivo (timing-safe: não vaza se a assinatura está "quase" certa).
 *
 * @example
 * throw new SignatureError('Assinatura ausente', 'missing_header');
 */
export class SignatureError extends ChannelError {
  readonly reason: 'missing_header' | 'invalid_format' | 'hmac_mismatch' | 'secret_unavailable';

  constructor(
    message: string,
    reason: SignatureError['reason'] = 'hmac_mismatch',
    details?: unknown,
  ) {
    // 403 Forbidden — assinatura inválida não é erro do servidor (502)
    super(message, 'CHANNEL_SIGNATURE_INVALID', 403, 'FORBIDDEN', details);
    this.name = 'SignatureError';
    this.reason = reason;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// ProviderError — erro retornado pela API do provider
// ---------------------------------------------------------------------------

/**
 * Lançado quando a API do provider (Meta Graph API, WAHA) retorna um erro HTTP.
 *
 * Preserva o `upstreamStatus` para que o caller possa decidir retry vs. abort:
 *   - 429 → retentável com backoff
 *   - 5xx → retentável com backoff
 *   - 4xx (exceto 429) → não retentável
 *
 * `providerCode` é o código numérico retornado pelo provider nos erros estruturados
 * (ex: códigos Meta: 130472 = opt-out, 131026 = rate limit, 131047 = message undeliverable).
 *
 * @example
 * throw new ProviderError('Meta API rate limit', 429, 131026, { wamid });
 */
export class ProviderError extends ChannelError {
  readonly upstreamStatus: number;
  readonly providerCode?: number | undefined;
  readonly providerTitle?: string | undefined;
  readonly retryAfterMs?: number | undefined;

  constructor(
    message: string,
    upstreamStatus: number,
    providerCode?: number | undefined,
    details?: unknown,
    retryAfterMs?: number | undefined,
    providerTitle?: string | undefined,
  ) {
    super(message, 'CHANNEL_PROVIDER_ERROR', 502, 'EXTERNAL_SERVICE_ERROR', details);
    this.name = 'ProviderError';
    this.upstreamStatus = upstreamStatus;
    if (providerCode !== undefined) {
      this.providerCode = providerCode;
    }
    if (providerTitle !== undefined) {
      this.providerTitle = providerTitle;
    }
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Indica se o erro é elegível para retry automático.
   * Retry em: 429 (rate limit), 5xx (servidor fora), status=0 (erro de rede/timeout).
   */
  get isRetryable(): boolean {
    return this.upstreamStatus === 429 || this.upstreamStatus >= 500 || this.upstreamStatus === 0;
  }
}

// ---------------------------------------------------------------------------
// UnsupportedMessageTypeError — tipo de mensagem não suportado pelo adapter
// ---------------------------------------------------------------------------

/**
 * Lançado quando o adapter recebe um tipo de mensagem que não consegue
 * processar (nem mapear para `type: 'unsupported'`).
 *
 * Ex: adapter WhatsApp recebe tipo "poll" que não está no contrato.
 * O inbound worker captura este erro e faz NACK sem retry (mensagem descartada).
 *
 * @example
 * throw new UnsupportedMessageTypeError('poll', 'meta_whatsapp');
 */
export class UnsupportedMessageTypeError extends ChannelError {
  readonly messageType: string;
  readonly provider: string;

  constructor(messageType: string, provider: string, details?: unknown) {
    super(
      `Tipo de mensagem não suportado: "${messageType}" (provider: ${provider})`,
      'CHANNEL_UNSUPPORTED_MESSAGE_TYPE',
      422,
      'VALIDATION_ERROR',
      details,
    );
    this.name = 'UnsupportedMessageTypeError';
    this.messageType = messageType;
    this.provider = provider;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Verifica se `e` é um ChannelError (ou subclasse). */
export function isChannelError(e: unknown): e is ChannelError {
  return e instanceof ChannelError;
}

/** Verifica se `e` é um SignatureError. */
export function isSignatureError(e: unknown): e is SignatureError {
  return e instanceof SignatureError;
}

/** Verifica se `e` é um ProviderError. */
export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Verifica se `e` é um UnsupportedMessageTypeError. */
export function isUnsupportedMessageTypeError(e: unknown): e is UnsupportedMessageTypeError {
  return e instanceof UnsupportedMessageTypeError;
}

// ---------------------------------------------------------------------------
// Códigos de erro Meta conhecidos (referência — não exaustivo)
// ---------------------------------------------------------------------------

/**
 * Códigos de erro conhecidos da Meta Business Messaging API.
 * Fonte: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 *
 * Usar em `ProviderError.providerCode` para tratamento diferenciado no caller.
 */
export const META_ERROR_CODES = {
  /** Contato optou por não receber mensagens. */
  OPT_OUT: 130472,
  /** Rate limit da plataforma excedido. */
  RATE_LIMIT: 131026,
  /** Mensagem não entregável (contato bloqueou/número inválido). */
  UNDELIVERABLE: 131047,
  /** Template inválido ou não aprovado. */
  TEMPLATE_INVALID: 131051,
  /** Erro de formato na mensagem. */
  FORMAT_ERROR: 132001,
  /** Expiração da janela de 24h (mensagem de template necessária). */
  WINDOW_EXPIRED: 131049,
} as const satisfies Record<string, number>;
