// =============================================================================
// importRows.ts — Schema Drizzle para import_rows (F1-S17).
//
// Representa uma linha individual de um lote de importação.
// raw_data: objeto JSON original da linha (colunas como lidas do arquivo).
// normalized_data: objeto JSON após parseRow + validateRow (pronto para persistir).
// validation_errors: lista de strings com erros da validateRow.
//
// LGPD §8.5: raw_data pode conter PII (phone, email, cpf bruto).
//   Nunca logar raw_data sem aplicar redact.
//   Após processamento, raw_data pode ser purged por job de retenção.
// =============================================================================
import { relations, sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, timestamp, uuid, text } from 'drizzle-orm/pg-core';

import { importBatches } from './importBatches.js';

// ---------------------------------------------------------------------------
// Enum de status de linha
// ---------------------------------------------------------------------------

export const IMPORT_ROW_STATUSES = ['pending', 'valid', 'invalid', 'persisted', 'failed'] as const;

export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

export const importRows = pgTable(
  'import_rows',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    batchId: uuid('batch_id').notNull(),

    /** Índice da linha no arquivo original (0-based). */
    rowIndex: integer('row_index').notNull(),

    /**
     * Linha bruta como lida do CSV/XLSX.
     * LGPD: pode conter PII. Nunca logar sem redact.
     */
    rawData: jsonb('raw_data')
      .notNull()
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),

    /**
     * Dados normalizados após parseRow + validateRow.
     * Pronto para ser passado ao adapter.persistRow.
     */
    normalizedData: jsonb('normalized_data').$type<Record<string, unknown>>(),

    /**
     * Lista de erros de validação (quando status = 'invalid').
     * Formato: string[].
     */
    validationErrors: jsonb('validation_errors').$type<string[]>(),

    /** Estado do processamento desta linha. */
    status: text('status').notNull().default('pending').$type<ImportRowStatus>(),

    /**
     * UUID da entidade criada após persistRow (quando status = 'persisted').
     * Ex: lead.id, customer.id.
     */
    entityId: uuid('entity_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idxBatchStatus: index('idx_import_rows_batch_status').on(table.batchId, table.status),
  }),
);

// ---------------------------------------------------------------------------
// Relações
// ---------------------------------------------------------------------------

export const importRowsRelations = relations(importRows, ({ one }) => ({
  batch: one(importBatches, {
    fields: [importRows.batchId],
    references: [importBatches.id],
  }),
}));

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type ImportRow = typeof importRows.$inferSelect;
export type ImportRowInsert = typeof importRows.$inferInsert;
