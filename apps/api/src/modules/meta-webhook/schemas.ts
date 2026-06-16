// =============================================================================
// meta-webhook/schemas.ts — Zod schemas do envelope Meta Webhook.
//
// Cobre os dois tipos de objeto suportados pelo live chat multicanal:
//   - whatsapp_business_account  (Cloud API mensagens / status / templates)
//   - instagram                  (Messenger API DMs / comentários)
//
// O campo `entry[].id` é o WABA ID (WhatsApp) ou o Facebook Page ID (Instagram),
// e é a chave usada para resolver o canal e o app_secret em `channel_secrets`.
//
// LGPD (doc 17 §8.3):
//   - `entry` pode conter PII dentro de changes.value.messages[].text.body e .from.
//   - Nunca logar o payload inteiro — apenas provider + event_id.
//   - Salvar raw_payload em webhook_events com retenção de 30 dias.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Query string do handshake GET
// ---------------------------------------------------------------------------

/** Parâmetros de query para verificação do webhook Meta (GET). */
export const metaVerifyQuerySchema = z.object({
  'hub.mode': z.string().describe('Deve ser "subscribe" para aceitar'),
  'hub.verify_token': z.string().describe('Token configurado no painel Meta — validado por-app'),
  'hub.challenge': z.string().describe('Echo retornado ao Meta para confirmar a URL'),
});

export type MetaVerifyQuery = z.infer<typeof metaVerifyQuerySchema>;

// ---------------------------------------------------------------------------
// Envelope de webhook Meta (POST body)
// ---------------------------------------------------------------------------

/**
 * Schema mínimo do envelope Meta Webhook.
 *
 * Validamos apenas a estrutura de roteamento (object + entry[].id).
 * O payload interno (changes.value.messages) é passado ao worker S08
 * sem parse adicional aqui — S05 (adapter) faz o parse tipado.
 *
 * Por que passthrough()?
 *   O envelope Meta pode conter campos extras em entries futuras.
 *   passthrough() preserva campos desconhecidos sem errar, permitindo que o
 *   rawPayload salvo em webhook_events inclua tudo que a Meta enviou.
 */
const metaEntrySchema = z
  .object({
    /** WABA ID (whatsapp_business_account) ou FB Page ID (instagram). */
    id: z.string().min(1).describe('WABA ID ou FB Page ID — chave para resolver o canal'),
    changes: z
      .array(z.unknown())
      .describe('Array de mudanças — processado pelo worker S08 via adapter'),
  })
  .passthrough();

export const metaWebhookBodySchema = z
  .object({
    /**
     * Tipo do objeto Meta que emitiu o evento.
     * Usado para identificar o provider ao salvar em webhook_events.
     */
    object: z
      .enum(['whatsapp_business_account', 'instagram'])
      .describe('Provider de origem do evento'),
    entry: z
      .array(metaEntrySchema)
      .min(1)
      .describe('Cada entrada representa um WABA/Page com mudanças'),
  })
  .passthrough();

export type MetaWebhookBody = z.infer<typeof metaWebhookBodySchema>;
