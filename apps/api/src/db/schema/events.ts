// =============================================================================
// events.ts — Tabelas do Outbox pattern (F1-S15).
//
// Três tabelas:
//   1. event_outbox         — fila transacional de eventos a publicar.
//   2. event_processing_logs — idempotência por (event_id, handler_name).
//   3. event_dlq            — Dead-Letter Queue: eventos que esgotaram tentativas.
//
// LGPD §8.5 — CRÍTICO:
//   O payload de event_outbox carrega APENAS referências (UUIDs opacos).
//   NUNCA CPF, e-mail, telefone, RG, nome completo, data de nascimento brutos.
//   O consumidor hidrata PII via /internal/* sob escopo adequado.
//   Qualquer PR que viole essa regra deve ser bloqueado em revisão.
//
// Atomicidade:
//   emit(tx, event) insere em event_outbox dentro da MESMA transação do domínio.
//   Se a transação do domínio fizer rollback, o evento também é desfeito.
//   O worker outbox-publisher lê apenas eventos não processados e os entrega.
// =============================================================================
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// FK para organizations declarada na migration SQL (ver 0003_outbox_events.sql).
// Drizzle não expõe foreignKey() para migrations manuais — FK definida via SQL puro.

// ---------------------------------------------------------------------------
// 1. event_outbox — tabela de saída transacional
// ---------------------------------------------------------------------------

export const eventOutbox = pgTable(
  'event_outbox',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** FK multi-tenant. Toda linha pertence a uma organização. */
    organizationId: uuid('organization_id').notNull(),

    // -------------------------------------------------------------------------
    // Identificação do evento
    // -------------------------------------------------------------------------

    /** Ex: "leads.created", "kanban.stage_updated". Formato: "<dominio>.<acao>". */
    eventName: text('event_name').notNull(),

    /** Versão do contrato do evento. Quebra de contrato → incrementar. */
    eventVersion: integer('event_version').notNull().default(1),

    // -------------------------------------------------------------------------
    // Agregado que originou o evento
    // -------------------------------------------------------------------------

    /** Ex: "lead", "kanban_card", "simulation". */
    aggregateType: text('aggregate_type').notNull(),

    /**
     * UUID opaco do agregado.
     * LGPD §8.5: este campo é um identificador interno, não PII.
     * O consumidor usa este ID para hidratar dados via /internal/* se precisar.
     */
    aggregateId: uuid('aggregate_id').notNull(),

    // -------------------------------------------------------------------------
    // Payload
    // -------------------------------------------------------------------------

    /**
     * Payload do evento em JSONB.
     *
     * REGRA ABSOLUTA LGPD §8.5:
     *   - Somente IDs/UUIDs opacos, flags, métricas e metadados estruturais.
     *   - PROIBIDO: CPF, RG, e-mail, telefone, nome completo, data de nascimento,
     *     endereço, qualquer dado que identifique diretamente a pessoa.
     *   - Se precisar de PII no handler, use cpf_hash (HMAC) — nunca CPF bruto.
     *   - O handler chama /internal/<recurso>/:id para hidratar PII sob escopo.
     *
     * Estrutura esperada (ver docs/04-eventos.md §2):
     *   {
     *     event_id: uuid,       // duplicado aqui para conveniência do handler
     *     occurred_at: ISO8601,
     *     actor: { kind, id, ip },
     *     correlation_id: uuid | null,
     *     data: { ... }         // específico do evento, SEM PII bruta
     *   }
     */
    payload: jsonb('payload').notNull(),

    // -------------------------------------------------------------------------
    // Rastreabilidade
    // -------------------------------------------------------------------------

    /** Propagado de webhook → outbox → handler → integração externa. */
    correlationId: uuid('correlation_id'),

    /**
     * Chave de idempotência por organização.
     * Formato recomendado: "<event_name>:<aggregate_id>:<ts_epoch_ms>".
     * Unique por (organization_id, idempotency_key) — índice abaixo.
     * Previne duplicação em caso de retry do caller antes do commit.
     */
    idempotencyKey: text('idempotency_key').notNull(),

    // -------------------------------------------------------------------------
    // Estado de processamento
    // -------------------------------------------------------------------------

    /** Quantas tentativas de publicação já foram feitas. */
    attempts: integer('attempts').notNull().default(0),

    /** Texto do último erro (stack truncado). Null se nenhuma falha ainda. */
    lastError: text('last_error'),

    /**
     * Timestamp em que o worker marcou este evento como publicado com sucesso.
     * null = ainda pendente de publicação.
     * O índice parcial WHERE processed_at IS NULL torna a query do worker eficiente.
     */
    processedAt: timestamp('processed_at', { withTimezone: true }),

    /**
     * Timestamp em que o evento foi movido para DLQ (após >= 5 falhas).
     * null = ainda em retry normal.
     */
    failedAt: timestamp('failed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // FK multi-tenant
    // Nota: não declaramos foreignKey() aqui porque a migration SQL a define
    // de forma mais legível. Drizzle ainda infere a relação para queries.

    // B-tree em FK para joins org → events
    index('idx_event_outbox_org').on(table.organizationId),

    // Índice parcial para o worker — só eventos pendentes (não processados, não em DLQ)
    // Drizzle não suporta .where() em index() — gerado na migration SQL manualmente.
    // Declaramos um index simples para o Drizzle; o parcial está na migration.
    index('idx_event_outbox_pending').on(table.createdAt),

    // B-tree em aggregate_id para ordenação serial por agregado (ordering guarantee)
    index('idx_event_outbox_aggregate').on(table.aggregateType, table.aggregateId),

    // Unique composto: (org, idempotency_key) para prevenir duplicatas de emissão
    uniqueIndex('uq_event_outbox_idempotency').on(table.organizationId, table.idempotencyKey),
  ],
);

export type EventOutbox = typeof eventOutbox.$inferSelect;
export type NewEventOutbox = typeof eventOutbox.$inferInsert;

// ---------------------------------------------------------------------------
// 2. event_processing_logs — idempotência por (event_id, handler_name)
// ---------------------------------------------------------------------------

/**
 * Garante at-least-once delivery com idempotência no consumer.
 * Antes de processar, o handler tenta inserir aqui.
 * Se já existir (duplicate key), o handler pula silenciosamente.
 * Status: 'success' | 'failed' | 'skipped'
 */
export const eventProcessingLogs = pgTable(
  'event_processing_logs',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** FK para event_outbox.id */
    eventId: uuid('event_id').notNull(),

    organizationId: uuid('organization_id').notNull(),

    /**
     * Nome do handler que processou o evento.
     * Ex: "kanban.on_lead_created", "chatwoot.sync_attributes".
     * Junto com event_id, forma a chave de idempotência.
     */
    handlerName: text('handler_name').notNull(),

    /** 'success' | 'failed' | 'skipped' */
    status: text('status', { enum: ['success', 'failed', 'skipped'] }).notNull(),

    /** Texto de erro quando status = 'failed'. */
    errorMessage: text('error_message'),

    /** Latência de processamento em ms. */
    durationMs: integer('duration_ms'),

    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Unique por (event_id, handler_name) — garante idempotência
    uniqueIndex('uq_event_processing_event_handler').on(table.eventId, table.handlerName),

    // B-tree em event_id para joins outbox → logs
    index('idx_event_processing_event_id').on(table.eventId),

    // B-tree em org para queries de observabilidade
    index('idx_event_processing_org').on(table.organizationId),
  ],
);

export type EventProcessingLog = typeof eventProcessingLogs.$inferSelect;
export type NewEventProcessingLog = typeof eventProcessingLogs.$inferInsert;

// ---------------------------------------------------------------------------
// 3. event_dlq — Dead-Letter Queue
// ---------------------------------------------------------------------------

/**
 * Eventos movidos da event_outbox após esgotamento de tentativas (>= 5 falhas).
 * Visível em tela admin com filtros, detalhe e botão "Reprocessar".
 * Reprocessar: cria nova linha em event_outbox com attempts=0.
 */
export const eventDlq = pgTable(
  'event_dlq',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /** ID original da linha em event_outbox que falhou. */
    originalEventId: uuid('original_event_id').notNull(),

    organizationId: uuid('organization_id').notNull(),

    eventName: text('event_name').notNull(),
    eventVersion: integer('event_version').notNull().default(1),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),

    /** Payload copiado de event_outbox.payload (sem PII — mesma regra LGPD §8.5). */
    payload: jsonb('payload').notNull(),

    correlationId: uuid('correlation_id'),

    /** Total de tentativas feitas antes de mover para DLQ. */
    totalAttempts: integer('total_attempts').notNull(),

    /** Último erro que causou a movimentação para DLQ. */
    lastError: text('last_error'),

    /**
     * true = reprocessado manualmente via admin.
     * Quando true, reprocess_event_id aponta para o novo evento em event_outbox.
     */
    reprocessed: boolean('reprocessed').notNull().default(false),

    /** FK para o novo event_outbox.id criado ao reprocessar. */
    reprocessEventId: uuid('reprocess_event_id'),

    movedAt: timestamp('moved_at', { withTimezone: true }).notNull().defaultNow(),
    reprocessedAt: timestamp('reprocessed_at', { withTimezone: true }),
  },
  (table) => [
    // B-tree em org para queries de observabilidade e admin
    index('idx_event_dlq_org').on(table.organizationId),

    // B-tree em original_event_id para rastrear origem
    index('idx_event_dlq_original').on(table.originalEventId),

    // B-tree para filtrar não-reprocessados (lista admin)
    index('idx_event_dlq_pending_reprocess').on(table.reprocessed),
  ],
);

export type EventDlq = typeof eventDlq.$inferSelect;
export type NewEventDlq = typeof eventDlq.$inferInsert;
