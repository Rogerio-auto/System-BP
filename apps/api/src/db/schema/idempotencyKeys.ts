// =============================================================================
// idempotencyKeys.ts — Schema Drizzle para tabela idempotency_keys.
//
// Cache de resposta HTTP para endpoints que suportam o header Idempotency-Key.
// Garante que clientes retentarão a mesma requisição sem reprocessar lógica.
//
// LGPD: response_body NÃO deve conter PII — apenas { ok: true, id: uuid }.
// Retenção: job diário remove linhas com mais de 24h (índice em created_at).
// =============================================================================
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    /**
     * Chave primária — valor do header `Idempotency-Key` enviado pelo caller.
     * Para o webhook Meta usamos o `wa_message_id` como chave determinística.
     */
    key: text('key').primaryKey().notNull(),

    /** Endpoint que originou a chave. Ex: "POST /api/whatsapp/webhook". */
    endpoint: text('endpoint').notNull(),

    /**
     * SHA-256 (hex) do corpo bruto da requisição.
     * Usado para detectar requisições com mesma chave mas corpo diferente
     * (retorna 422 nesses casos — semântica RFC do Idempotency-Key).
     */
    requestHash: text('request_hash').notNull(),

    /** HTTP status code da resposta original. */
    responseStatus: integer('response_status').notNull(),

    /**
     * Corpo da resposta original para replay.
     *
     * LGPD: NUNCA armazenar PII aqui. Estrutura esperada:
     *   { ok: true, id: "<uuid>" }  para POST de criação
     *   { ok: true }                para ações sem recurso criado
     */
    responseBody: jsonb('response_body').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Índice em created_at para o job de limpeza periódica
    idxCreatedAt: index('idx_idempotency_keys_created_at').on(table.createdAt),
  }),
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
