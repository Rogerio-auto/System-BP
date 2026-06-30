// =============================================================================
// notifications/email/resendClient.ts — Cliente HTTP para o Resend (F24-S03).
//
// Usa fetch nativo (Node 18+). Sem SDK externo — mantém a dep tree enxuta.
//
// Retry exponencial:
//   Tentativas: 3 (inicial + 2 retries).
//   Delay base: 500ms. Fator: 2 (500ms → 1000ms → 2000ms).
//   Retenta apenas em erros de rede e 5xx. 4xx são terminais (dados inválidos).
//
// LGPD §8.5:
//   - Nunca logar o endereço de email (PII) em chamadas aqui.
//   - Nunca logar o corpo HTML — pode ter PII indireta.
//   - O chamador (senders/email.ts) é responsável pelo redact no logger Pino.
// =============================================================================

const RESEND_API_BASE = 'https://api.resend.com';
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Corpo da requisição POST /emails da Resend API v1. */
export interface ResendEmailRequest {
  /** Endereço remetente. Ex: "Nome <email@domínio.com>" */
  from: string;
  /** Lista de destinatários — LGPD: não persistir nem logar. */
  to: string[];
  subject: string;
  html: string;
  /** Reply-To opcional. */
  reply_to?: string;
  /** Cabeçalhos extras opcionais. */
  headers?: Record<string, string>;
}

/** Resposta de sucesso do POST /emails. */
export interface ResendEmailResponse {
  id: string;
}

// ---------------------------------------------------------------------------
// Erro tipado
// ---------------------------------------------------------------------------

/** Erro retornado pela Resend API. */
export interface ResendApiErrorBody {
  statusCode: number;
  message: string;
  name: string;
}

/**
 * Erro lançado quando a Resend API retorna status != 2xx ou quando
 * ocorre falha de rede após esgotar as tentativas de retry.
 */
export class ResendApiError extends Error {
  /** HTTP status code retornado pela Resend (0 = falha de rede). */
  readonly statusCode: number;
  /** `name` do erro conforme a Resend API (ex: "missing_required_field"). */
  readonly resendName: string;
  /** Indica se o erro é recuperável (5xx, rede) ou terminal (4xx). */
  readonly retryable: boolean;

  constructor(statusCode: number, resendName: string, message: string) {
    super(message);
    this.name = 'ResendApiError';
    this.statusCode = statusCode;
    this.resendName = resendName;
    // 4xx são erros de dados → não adianta retentar. 5xx e 0 (rede) = retryable.
    this.retryable = statusCode === 0 || statusCode >= 500;
  }
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Aguarda `ms` milissegundos. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calcula o delay de backoff exponencial com jitter leve.
 * delay = base * 2^attempt + jitter(0..50ms)
 */
function backoffDelay(attempt: number): number {
  // attempt: 0-indexed (0 = primeiro retry, 1 = segundo retry)
  return BASE_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 50);
}

// ---------------------------------------------------------------------------
// Cliente público
// ---------------------------------------------------------------------------

/**
 * Envia um email via Resend API com retry exponencial (3 tentativas).
 *
 * LGPD: não loga endereço de email — apenas o id da mensagem retornado
 * pela Resend (opaco). O chamador controla o logging com pino.redact.
 *
 * @throws {ResendApiError} — erro de API 4xx (terminal) ou falha após esgotamento
 *   de retries (5xx / rede). Nunca lança Error genérico.
 */
export async function resendSendEmail(
  apiKey: string,
  request: ResendEmailRequest,
): Promise<ResendEmailResponse> {
  let lastError: ResendApiError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Aguarda backoff em retries (não no primeiro attempt)
    if (attempt > 0 && lastError !== null) {
      if (!lastError.retryable) {
        // 4xx: erro terminal, não retentar
        throw lastError;
      }
      await sleep(backoffDelay(attempt - 1));
    }

    try {
      const response = await fetch(`${RESEND_API_BASE}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // Identifica o cliente nos logs do Resend
          'User-Agent': 'elemento-api/1.0',
        },
        body: JSON.stringify(request),
      });

      if (response.ok) {
        // `as` justificado: response.ok garante que o corpo é ResendEmailResponse
        const data = (await response.json()) as ResendEmailResponse;
        return data;
      }

      // Erro HTTP — tenta parsear o corpo de erro da Resend
      let errorBody: ResendApiErrorBody;
      try {
        // `as` justificado: a Resend API sempre retorna este envelope em erros
        errorBody = (await response.json()) as ResendApiErrorBody;
      } catch {
        errorBody = {
          statusCode: response.status,
          message: `HTTP ${response.status} ${response.statusText}`,
          name: 'unknown_error',
        };
      }

      lastError = new ResendApiError(response.status, errorBody.name, errorBody.message);
    } catch (cause: unknown) {
      // Falha de rede (fetch lança TypeError em caso de DNS/timeout/etc.)
      const message = cause instanceof Error ? cause.message : 'Falha de rede desconhecida';
      lastError = new ResendApiError(0, 'network_error', message);
    }
  }

  // Esgotou todas as tentativas
  throw lastError ?? new ResendApiError(0, 'unknown_error', 'Todas as tentativas falharam');
}
