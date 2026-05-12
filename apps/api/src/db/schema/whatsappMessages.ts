// =============================================================================
// whatsappMessages.ts — Schema Drizzle para tabela whatsapp_messages.
//
// Armazena o payload bruto de cada mensagem recebida/enviada via Cloud API Meta.
//
// LGPD §8.5 — ATENÇÃO:
//   O campo `payload` CONTÉM PII (telefone "from", texto "text.body").
//   - Acesso controlado por RBAC (permissão `whatsapp:read`).
//   - Logs NÃO registram `payload` diretamente (pino.redact em app.ts).
//   - Outbox NÃO carrega payload — apenas IDs.
//   - Este é o único repositório autoritativo do corpo das mensagens.
//
// Idempotência:
//   `wa_message_id` tem índice UNIQUE. Inserção duplicada viola a constraint
//   e é tratada como no-op pelo service (ON CONFLICT DO NOTHING ou catch).
// =============================================================================
import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** FK multi-tenant. Toda linha pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * Identificador único dado pela Cloud API Meta (campo `id` do objeto message).
     * Unique garante que o mesmo webhook não seja persistido duas vezes.
     */
    waMessageId: text('wa_message_id').notNull(),

    /**
     * FK opcional para a conversa do Chatwoot (null até o upsert de conversa).
     * Preenchido pelo handler de `whatsapp.message_received`.
     */
    conversationId: uuid('conversation_id'),

    /** 'inbound' = mensagem recebida do cliente; 'outbound' = enviada pela plataforma. */
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),

    /**
     * Payload completo do webhook Meta (JSONB).
     *
     * LGPD §8.3 — PII presente:
     *   - `from`: número WhatsApp do cidadão (E.164)
     *   - `text.body`: mensagem livre (pode conter CPF, endereço, etc.)
     *
     * Acesso controlado. Pino redact cobre os paths na camada de log.
     * Outbox não carrega este campo.
     */
    payload: jsonb('payload').notNull(),

    /** Timestamp da mensagem conforme campo `timestamp` do webhook Meta. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // UNIQUE em wa_message_id — garante idempotência de segundo nível
    uniqueIndex('uq_whatsapp_messages_wa_message_id').on(table.waMessageId),

    // Índice composto para queries por organização ordenadas por data (dashboard)
    index('idx_whatsapp_messages_org_received').on(table.organizationId, table.receivedAt),
  ],
);

export type WhatsappMessage = typeof whatsappMessages.$inferSelect;
export type NewWhatsappMessage = typeof whatsappMessages.$inferInsert;
