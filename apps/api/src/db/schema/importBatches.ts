// =============================================================================
// importBatches.ts — Schema Drizzle para import_batches (F1-S17).
//
// Representa um lote de importação CSV/XLSX.
// Estados: uploaded → parsing → preview_ready → confirmed → processing
//          → completed / failed / cancelled.
//
// LGPD §8.5: raw_data nas import_rows é PII — nunca logar sem redact.
// =============================================================================
import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { organizations } from './organizations.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// Enums (text com check constraint — não pgEnum para evitar migrações complexas)
// ---------------------------------------------------------------------------

export const IMPORT_BATCH_STATUSES = [
  'uploaded',
  'parsing',
  'preview_ready',
  'confirmed',
  'processing',
  'completed',
  'failed',
  'cancelled',
] as const;

export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const IMPORT_ENTITY_TYPES = ['leads', 'customers', 'agents', 'credit_analyses'] as const;

export type ImportEntityType = (typeof IMPORT_ENTITY_TYPES)[number];

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: uuid('organization_id').notNull(),
    createdByUserId: uuid('created_by_user_id').notNull(),

    /** Tipo de entidade importada. */
    entityType: text('entity_type').notNull().$type<ImportEntityType>(),

    /** Nome original do arquivo. */
    fileName: text('file_name').notNull(),
    /** Tamanho em bytes. */
    fileSize: integer('file_size').notNull(),
    /** MIME type: text/csv ou application/vnd.openxmlformats-officedocument.spreadsheetml.sheet. */
    mimeType: text('mime_type').notNull(),
    /** SHA-256 do conteúdo para idempotência. */
    fileHash: text('file_hash').notNull(),

    /** Estado atual do batch. */
    status: text('status').notNull().default('uploaded').$type<ImportBatchStatus>(),

    /** Total de linhas detectadas no arquivo. */
    totalRows: integer('total_rows').notNull().default(0),
    /** Linhas válidas após validação. */
    validRows: integer('valid_rows').notNull().default(0),
    /** Linhas com erro de validação. */
    invalidRows: integer('invalid_rows').notNull().default(0),
    /** Linhas processadas (persistidas ou failed). */
    processedRows: integer('processed_rows').notNull().default(0),

    /** Mapeamento de colunas (salvo pelo usuário ou inferido automaticamente). */
    columnMapping: jsonb('column_mapping'),

    /** Timestamp de confirmação pelo usuário. */
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** Usuário que confirmou a importação. */
    confirmedByUserId: uuid('confirmed_by_user_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Índice único parcial por (organization_id, file_hash) em batches ativos
    // Nota: a cláusula WHERE parcial é implementada na migration SQL diretamente.
    // Drizzle 0.34.1 não suporta índice parcial via API — definido apenas em 0012_imports.sql.
    index('idx_import_batches_org_hash').on(table.organizationId, table.fileHash),
    index('idx_import_batches_org_status').on(table.organizationId, table.status, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Relações
// ---------------------------------------------------------------------------

export const importBatchesRelations = relations(importBatches, ({ one }) => ({
  organization: one(organizations, {
    fields: [importBatches.organizationId],
    references: [organizations.id],
  }),
  createdByUser: one(users, {
    fields: [importBatches.createdByUserId],
    references: [users.id],
  }),
}));

// ---------------------------------------------------------------------------
// Tipos inferidos
// ---------------------------------------------------------------------------

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportBatchInsert = typeof importBatches.$inferInsert;
