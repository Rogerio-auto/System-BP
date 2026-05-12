// =============================================================================
// whatsapp/schemas.ts — Zod schemas para validação de borda do webhook WhatsApp.
//
// Referência de payload: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
//
// LGPD: os schemas mapeiam fieldsdo payload bruto. Os valores de PII
// (from, text.body) são validados na borda mas NÃO logados.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET /api/whatsapp/webhook — Verificação de hub Meta
// ---------------------------------------------------------------------------

export const webhookVerifyQuerySchema = z.object({
  'hub.mode': z.string(),
  'hub.verify_token': z.string(),
  'hub.challenge': z.string(),
});

// ---------------------------------------------------------------------------
// POST /api/whatsapp/webhook — Payload do webhook Meta (Cloud API)
//
// Estrutura canônica simplificada — apenas os campos necessários para F1-S19.
// Campos não utilizados no MVP são capturados via passthrough() para que o
// payload completo seja persistido em `whatsapp_messages.payload`.
// ---------------------------------------------------------------------------

/** Texto da mensagem (tipo text). */
const waTextSchema = z.object({
  body: z.string(),
});

/** Objeto `message` dentro do array `messages` do webhook. */
export const waMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().min(1),
    type: z.string().min(1),
    // text é opcional — pode não existir para outros tipos (image, audio, etc.)
    text: waTextSchema.optional(),
  })
  .passthrough();

/** Objeto `value` dentro de `changes[].value`. */
const waValueSchema = z
  .object({
    messaging_product: z.string(),
    metadata: z
      .object({
        display_phone_number: z.string(),
        phone_number_id: z.string(),
      })
      .passthrough(),
    messages: z.array(waMessageSchema).optional(),
    statuses: z
      .array(
        z
          .object({
            id: z.string(),
            status: z.string(),
            timestamp: z.string(),
            recipient_id: z.string(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

/** Objeto `entry[].changes[]`. */
const waChangeSchema = z.object({
  value: waValueSchema,
  field: z.string(),
});

/** Entrada raiz do webhook Meta. */
const waEntrySchema = z.object({
  id: z.string(),
  changes: z.array(waChangeSchema),
});

/** Payload completo do POST do webhook Meta. */
export const webhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(waEntrySchema),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type WaMessage = z.infer<typeof waMessageSchema>;
