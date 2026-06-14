// =============================================================================
// webhookEvents.ts - Eventos de webhook recebidos dos providers (F16-S02).
//
// Tabela de dedup + audit de webhooks recebidos do Meta/WAHA.
// Garante idempotencia: (provider, event_id) unico.
//
// Retencao: 30 dias via expires_at (job de purge a implementar).
// raw_payload: JSON do webhook como recebido (para debug e re-processamento).
//
// LGPD (doc 17):
//   - raw_payload pode conter PII (numero de telefone, nome do contato).
//   - Retencao limitada a 30 dias (proporcionalidade, art. 9 LGPD).
//   - Nao incluir raw_payload em logs — apenas event_id e provider.
// =============================================================================
import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** Provider de origem (meta_whatsapp | meta_instagram | waha). */
    provider: text('provider').notNull(),

    /** ID unico do evento no provider. Parte da chave de dedup. */
    eventId: text('event_id').notNull(),

    /** Tipo do evento (message | status | comment | reaction | ...). */
    eventType: text('event_type').notNull(),

    /**
     * Payload bruto do webhook (JSON).
     * LGPD: pode conter PII — retencao maxima 30 dias. Nunca logar.
     */
    rawPayload: jsonb('raw_payload').notNull(),

    /** Quando o evento foi processado. NULL = pendente ou com falha. */
    processedAt: timestamp('processed_at', { withTimezone: true }),

    /** Erro de processamento (se falhou). */
    processingError: text('processing_error'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),

    /**
     * Data de expiracao para purge automatico (30 dias).
     * Job de purge exclui linhas onde expires_at < now().
     */
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 days'`),
  },
  (t) => ({
    uqProviderEventId: uniqueIndex('webhook_events_provider_event_id_key').on(
      t.provider,
      t.eventId,
    ),
    idxProviderType: index('webhook_events_provider_type_idx').on(t.provider, t.eventType),
    idxUnprocessed: index('webhook_events_unprocessed_idx').on(t.processedAt, t.createdAt),
    idxExpiresAt: index('webhook_events_expires_at_idx').on(t.expiresAt),
  }),
);

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;
