// =============================================================================
// chatwootEvents.ts — Schema Drizzle para tabela chatwoot_events.
//
// Armazena o payload bruto de cada evento recebido do webhook Chatwoot.
//
// LGPD §8.5 — ATENÇÃO:
//   O campo `payload` PODE CONTER PII (conteúdo de mensagens, dados de contato).
//   - Acesso controlado por RBAC (permissão `chatwoot:read`).
//   - Logs NÃO registram `payload` diretamente (pino.redact em app.ts).
//   - Outbox NÃO carrega payload — apenas IDs.
//   - Este é o único repositório autoritativo dos eventos brutos do Chatwoot.
//
// Idempotência:
//   Unique index em (organization_id, chatwoot_id, updated_at_chatwoot).
//   Inserção duplicada viola a constraint e é tratada como no-op pelo service.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * citext: tipo PostgreSQL case-insensitive.
 * Requer extension citext (criada em 0000_init.sql).
 * Drizzle não exporta citext diretamente — usamos customType.
 */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const chatwootEvents = pgTable(
  'chatwoot_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** FK multi-tenant. Toda linha pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    /**
     * ID numérico do objeto raiz do evento no Chatwoot.
     * Para message_created → message.id.
     * Para conversation_status_changed / conversation_assignee_changed → conversation.id.
     */
    chatwootId: integer('chatwoot_id').notNull(),

    /**
     * Tipo do evento conforme enviado pelo Chatwoot.
     * Ex: "message_created", "conversation_status_changed".
     * Tipo citext para comparação case-insensitive.
     */
    eventType: citext('event_type').notNull(),

    /**
     * Payload completo do webhook Chatwoot (JSONB).
     *
     * LGPD §8.3 — PII possível:
     *   - content: conteúdo de mensagens (texto livre do cidadão)
     *   - contact: nome, telefone, email do cidadão
     *
     * Acesso controlado. Pino redact cobre os paths na camada de log.
     * Outbox não carrega este campo.
     */
    payload: jsonb('payload').notNull(),

    /**
     * Timestamp do objeto no Chatwoot (updated_at ou created_at do evento).
     * Combinado com chatwootId forma a chave de idempotência por organização.
     */
    updatedAtChatwoot: timestamp('updated_at_chatwoot', { withTimezone: true }).notNull(),

    /** Timestamp de recebimento pelo backend. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Timestamp de processamento pelo outbox worker.
     * null = evento ainda não processado.
     */
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => ({
    // UNIQUE em (organization_id, chatwoot_id, updated_at_chatwoot) — idempotência
    uqOrgIdUpdatedAt: uniqueIndex('uq_chatwoot_events_org_id_updated_at').on(
      table.organizationId,
      table.chatwootId,
      table.updatedAtChatwoot,
    ),

    // Índice em event_type para queries de processamento por tipo
    idxEventType: index('idx_chatwoot_events_event_type').on(table.eventType),

    // Índice em received_at para limpeza e queries temporais
    idxReceivedAt: index('idx_chatwoot_events_received_at').on(table.receivedAt),
  }),
);

export type ChatwootEvent = typeof chatwootEvents.$inferSelect;
export type NewChatwootEvent = typeof chatwootEvents.$inferInsert;
