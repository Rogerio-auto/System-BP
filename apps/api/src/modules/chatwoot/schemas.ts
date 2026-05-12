// =============================================================================
// chatwoot/schemas.ts — Zod schemas para validação de borda do webhook Chatwoot.
//
// Referência de payload: https://www.chatwoot.com/docs/product/others/webhooks
//
// Estratégia:
//   - Schemas parciais — apenas os campos consumidos pelo módulo são validados.
//   - Campos extras do payload bruto são permitidos via .passthrough() para que
//     o payload completo possa ser persistido em chatwoot_events.payload.
//   - Zod valida na borda HTTP (controller) antes de qualquer lógica de negócio.
//
// LGPD §8.3:
//   - Campos como `content` (texto de mensagem) podem conter PII.
//   - Esses campos são validados na borda mas NUNCA logados em nível info.
//   - O pino.redact em app.ts cobre `*.content` globalmente.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitivas compartilhadas
// ---------------------------------------------------------------------------

/** Contato no Chatwoot — retornado em messages e conversations. */
const chatwootContactSchema = z
  .object({
    id: z.number().int(),
    // LGPD: name e phone_number são PII — presentes mas nunca logados
    name: z.string().optional(),
    phone_number: z.string().optional(),
  })
  .passthrough();

/** Conversa retornada em eventos de conversa. */
const chatwootConversationSchema = z
  .object({
    id: z.number().int(),
    status: z.string(),
    account_id: z.number().int(),
    // updated_at pode ser Unix timestamp (number) ou ISO string dependendo da versão do Chatwoot
    updated_at: z.union([z.number(), z.string()]),
  })
  .passthrough();

/** Agente retornado em atribuição. */
const chatwootAgentSchema = z
  .object({
    id: z.number().int(),
    name: z.string().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Event: message_created
// ---------------------------------------------------------------------------

/**
 * Payload do evento `message_created` do webhook Chatwoot.
 *
 * Estrutura real do Chatwoot:
 *   {
 *     event: "message_created",
 *     id: <message_id>,
 *     content: "<texto da mensagem>",
 *     message_type: "incoming" | "outgoing",
 *     created_at: <unix_ts>,
 *     conversation: { id, account_id, updated_at, ... },
 *     account: { id, ... },
 *     ...
 *   }
 */
export const chatwootMessageCreatedPayloadSchema = z
  .object({
    event: z.literal('message_created'),
    id: z.number().int(),
    // content pode ter PII — validado mas nunca logado
    content: z.string().optional(),
    // "incoming" (cliente → agente) ou "outgoing" (agente → cliente)
    message_type: z.string(),
    created_at: z.union([z.number(), z.string()]),
    conversation: chatwootConversationSchema,
    account: z
      .object({
        id: z.number().int(),
      })
      .passthrough(),
    sender: chatwootContactSchema.optional(),
  })
  .passthrough();

export type ChatwootMessageCreatedPayload = z.infer<typeof chatwootMessageCreatedPayloadSchema>;

// ---------------------------------------------------------------------------
// Event: conversation_status_changed
// ---------------------------------------------------------------------------

/**
 * Payload do evento `conversation_status_changed` do webhook Chatwoot.
 *
 *   {
 *     event: "conversation_status_changed",
 *     id: <conversation_id>,
 *     status: "open" | "resolved" | "pending",
 *     updated_at: <unix_ts>,
 *     account: { id, ... },
 *     ...
 *   }
 */
export const chatwootStatusChangedPayloadSchema = z
  .object({
    event: z.literal('conversation_status_changed'),
    id: z.number().int(),
    status: z.string(),
    updated_at: z.union([z.number(), z.string()]),
    account: z
      .object({
        id: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();

export type ChatwootStatusChangedPayload = z.infer<typeof chatwootStatusChangedPayloadSchema>;

// ---------------------------------------------------------------------------
// Event: conversation_assignee_changed
// ---------------------------------------------------------------------------

/**
 * Payload do evento `conversation_assignee_changed` do webhook Chatwoot.
 *
 *   {
 *     event: "conversation_assignee_changed",
 *     id: <conversation_id>,
 *     updated_at: <unix_ts>,
 *     meta: { assignee: { id, name } | null },
 *     account: { id, ... },
 *     ...
 *   }
 */
export const chatwootAssigneeChangedPayloadSchema = z
  .object({
    event: z.literal('conversation_assignee_changed'),
    id: z.number().int(),
    updated_at: z.union([z.number(), z.string()]),
    meta: z
      .object({
        assignee: chatwootAgentSchema.nullable().optional(),
      })
      .passthrough()
      .optional(),
    account: z
      .object({
        id: z.number().int(),
      })
      .passthrough(),
  })
  .passthrough();

export type ChatwootAssigneeChangedPayload = z.infer<typeof chatwootAssigneeChangedPayloadSchema>;

// ---------------------------------------------------------------------------
// Union de payloads whitelisted + schema genérico para eventos ignorados
// ---------------------------------------------------------------------------

/**
 * Schema para o campo `event` de qualquer payload Chatwoot.
 * Usado para discriminar o tipo antes de fazer parse completo.
 */
export const chatwootEventTypeSchema = z.object({
  event: z.string(),
});

export type ChatwootEventType = z.infer<typeof chatwootEventTypeSchema>;

/**
 * Schema union para os 3 event types whitelisted.
 * Discriminated via o campo `event`.
 */
export const chatwootWhitelistedPayloadSchema = z.discriminatedUnion('event', [
  chatwootMessageCreatedPayloadSchema,
  chatwootStatusChangedPayloadSchema,
  chatwootAssigneeChangedPayloadSchema,
]);

export type ChatwootWhitelistedPayload = z.infer<typeof chatwootWhitelistedPayloadSchema>;

/**
 * Nomes dos event types whitelisted (para guards de tipo).
 */
export const CHATWOOT_WHITELISTED_EVENTS = [
  'message_created',
  'conversation_status_changed',
  'conversation_assignee_changed',
] as const;

export type ChatwootWhitelistedEventType = (typeof CHATWOOT_WHITELISTED_EVENTS)[number];

/**
 * Verifica se um event type está na whitelist.
 */
export function isChatwootWhitelisted(
  eventType: string,
): eventType is ChatwootWhitelistedEventType {
  return (CHATWOOT_WHITELISTED_EVENTS as readonly string[]).includes(eventType);
}

// ---------------------------------------------------------------------------
// Helper: extrair updated_at como Date de um payload recebido
// ---------------------------------------------------------------------------

/**
 * Normaliza o campo updated_at/created_at de um payload Chatwoot para Date.
 *
 * O Chatwoot pode enviar o timestamp como:
 *   - Unix timestamp (number, em segundos)
 *   - ISO 8601 string
 *
 * Se inválido, usa now() como fallback defensivo.
 */
export function parseChatwootTimestamp(value: number | string): Date {
  if (typeof value === 'number') {
    // Unix timestamp em segundos
    const ts = value * 1000;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  // ISO string
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date() : d;
}
