// =============================================================================
// integrations/channels/meta/whatsapp/errors.ts — Mapeamento de códigos de
// erro da Meta WhatsApp Cloud API para retryable/terminal.
//
// Fonte: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
//
// Semântica:
//   retryable=true  → erro transitório; o outbound worker pode tentar novamente
//                     (ex: rate limit, server overload, timeout de rede).
//   retryable=false → erro terminal; retry não vai ajudar; marcar mensagem como
//                     falha permanente e notificar agente.
//
// LGPD (doc 17 §8.3): nunca incluir `to` (número do destinatário) no message
// ou details dos erros — apenas o código e título da Meta.
// =============================================================================

// ---------------------------------------------------------------------------
// Definições de código de erro WhatsApp
// ---------------------------------------------------------------------------

export interface WhatsAppErrorEntry {
  /** Código numérico retornado pela Meta na resposta de erro. */
  readonly code: number;
  /** Título canônico da Meta (em inglês, para diagnóstico). */
  readonly title: string;
  /**
   * true  → o outbound worker pode fazer retry com backoff.
   * false → erro terminal; não faz sentido tentar novamente sem intervenção.
   */
  readonly retryable: boolean;
  /** Categoria humana do erro para agrupamento em dashboards. */
  readonly category: 'rate_limit' | 'routing' | 'template' | 'format' | 'policy' | 'server';
}

// ---------------------------------------------------------------------------
// Catálogo de códigos de erro WA Cloud API
//
// Referências:
//   https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
//   https://developers.facebook.com/docs/whatsapp/on-premises/errors
// ---------------------------------------------------------------------------

export const WA_ERROR_CATALOG: ReadonlyArray<WhatsAppErrorEntry> = [
  // ── Rate limits ──────────────────────────────────────────────────────────
  {
    code: 130429,
    title: 'Rate limit hit',
    retryable: true,
    category: 'rate_limit',
  },
  {
    code: 131026,
    title: 'Message undeliverable — rate limit exceeded',
    retryable: true,
    category: 'rate_limit',
  },
  {
    code: 131048,
    title: 'Spam rate limit hit',
    retryable: true,
    category: 'rate_limit',
  },
  {
    code: 131056,
    title: 'Too many messages sent to phone number in a short period',
    retryable: true,
    category: 'rate_limit',
  },
  // ── Routing / delivery ───────────────────────────────────────────────────
  {
    code: 130472,
    title: "User's number is part of an experiment",
    retryable: false, // opt-out / segment — não vai mudar com retry
    category: 'policy',
  },
  {
    code: 131021,
    title: 'Recipient cannot be sender',
    retryable: false,
    category: 'routing',
  },
  {
    code: 131026,
    title: 'Message undeliverable',
    retryable: false,
    category: 'routing',
  },
  {
    code: 131047,
    title: 'Re-engagement message — outside 24h window',
    retryable: false, // janela expirou; precisa de template HSM
    category: 'routing',
  },
  {
    code: 131049,
    title: '24h window expired — use a message template',
    retryable: false,
    category: 'routing',
  },
  // ── Template ─────────────────────────────────────────────────────────────
  {
    code: 131051,
    title: 'Unsupported message type — template invalid or not approved',
    retryable: false,
    category: 'template',
  },
  {
    code: 132000,
    title: 'Template parameter count mismatch',
    retryable: false,
    category: 'template',
  },
  {
    code: 132001,
    title: 'Template does not exist',
    retryable: false,
    category: 'template',
  },
  {
    code: 132005,
    title: 'Template hydrated text too long',
    retryable: false,
    category: 'template',
  },
  {
    code: 132007,
    title: 'Template format character policy violated',
    retryable: false,
    category: 'template',
  },
  {
    code: 132008,
    title: 'Template parameter type mismatch',
    retryable: false,
    category: 'template',
  },
  {
    code: 132009,
    title: 'Template parameter format mismatch',
    retryable: false,
    category: 'template',
  },
  {
    code: 132012,
    title: 'Template button index out of bounds',
    retryable: false,
    category: 'template',
  },
  {
    code: 132015,
    title: 'Template is paused',
    retryable: true, // pode ser retomado após revisão — retry em horas
    category: 'template',
  },
  {
    code: 132016,
    title: 'Template is in quarantine',
    retryable: false,
    category: 'template',
  },
  {
    code: 132068,
    title: 'Flow is not in PUBLISHED state',
    retryable: false,
    category: 'template',
  },
  {
    code: 132069,
    title: 'Flow is blocked',
    retryable: false,
    category: 'template',
  },
  // ── Format ───────────────────────────────────────────────────────────────
  {
    code: 131009,
    title: 'Parameter value is not valid',
    retryable: false,
    category: 'format',
  },
  {
    code: 100,
    title: 'Invalid parameter',
    retryable: false,
    category: 'format',
  },
  // ── Server / infra ───────────────────────────────────────────────────────
  {
    code: 1,
    title: 'Unknown error',
    retryable: true, // código genérico — pode ser transitório
    category: 'server',
  },
  {
    code: 2,
    title: 'Service temporarily unavailable',
    retryable: true,
    category: 'server',
  },
  {
    code: 3,
    title: 'Capability or permissions issue',
    retryable: false,
    category: 'server',
  },
  {
    code: 10,
    title: 'Permission denied',
    retryable: false,
    category: 'policy',
  },
  {
    code: 4,
    title: 'API call limit reached',
    retryable: true,
    category: 'rate_limit',
  },
  {
    code: 131000,
    title: 'Something went wrong',
    retryable: true,
    category: 'server',
  },
  {
    code: 131005,
    title: 'Access denied',
    retryable: false,
    category: 'policy',
  },
  {
    code: 131008,
    title: 'Required parameter is missing',
    retryable: false,
    category: 'format',
  },
  {
    code: 131016,
    title: 'Service unavailable',
    retryable: true,
    category: 'server',
  },
  {
    code: 131031,
    title: 'Business account locked',
    retryable: false,
    category: 'policy',
  },
  {
    code: 131042,
    title: 'Business eligibility — payment issue',
    retryable: false,
    category: 'policy',
  },
  {
    code: 131043,
    title: 'Message expired',
    retryable: false,
    category: 'routing',
  },
  {
    code: 131045,
    title: 'Incorrect certificate',
    retryable: false,
    category: 'policy',
  },
  {
    code: 131052,
    title: 'Media download error',
    retryable: true, // CDN pode estar sobrecarregado
    category: 'server',
  },
  {
    code: 131053,
    title: 'Media upload error',
    retryable: true,
    category: 'server',
  },
];

// ---------------------------------------------------------------------------
// Lookup index por código
// ---------------------------------------------------------------------------

// Construído uma única vez na importação do módulo.
// `as` justificado: Record<number, WhatsAppErrorEntry> é o tipo inferido correto;
// o compiler infere ReadonlyMap, não Record.
const _catalogByCode = new Map<number, WhatsAppErrorEntry>(
  WA_ERROR_CATALOG.map((e) => [e.code, e]),
);

/**
 * Retorna a entrada do catálogo para um código de erro WA, ou `undefined` se
 * o código não estiver mapeado.
 */
export function lookupWaError(code: number): WhatsAppErrorEntry | undefined {
  return _catalogByCode.get(code);
}

/**
 * Determina se um código de erro WA é retentável.
 *
 * Regra de fallback: se o código não estiver no catálogo e o HTTP status for
 * 429 ou 5xx, considera retentável. Caso contrário, terminal.
 *
 * @param waCode       Código WA (ex: 131026).
 * @param httpStatus   Status HTTP da resposta (ex: 429, 500).
 */
export function isWaErrorRetryable(waCode: number, httpStatus: number): boolean {
  const entry = _catalogByCode.get(waCode);
  if (entry !== undefined) {
    return entry.retryable;
  }
  // Fallback por HTTP status quando código não está mapeado
  return httpStatus === 429 || httpStatus >= 500;
}
