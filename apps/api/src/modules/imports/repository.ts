// =============================================================================
// modules/imports/repository.ts — Queries Drizzle para import_batches e import_rows.
//
// Todas as queries são organizadas por operação: insert, find, update, bulk.
// Sem lógica de negócio — apenas I/O com o banco.
// =============================================================================
import { and, eq, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import type { ImportBatchStatus, ImportBatchInsert } from '../../db/schema/importBatches.js';
import { importBatches } from '../../db/schema/importBatches.js';
import type { ImportRowStatus, ImportRowInsert } from '../../db/schema/importRows.js';
import { importRows } from '../../db/schema/importRows.js';
import type { ImportBatch, ImportRow } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export async function insertBatch(db: Database, data: ImportBatchInsert): Promise<ImportBatch> {
  const [created] = await db.insert(importBatches).values(data).returning();

  if (created === undefined) {
    throw new Error('insertBatch: nenhuma linha retornada');
  }
  return created;
}

export async function findBatchById(
  db: Database,
  id: string,
  organizationId: string,
): Promise<ImportBatch | null> {
  const results = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, id), eq(importBatches.organizationId, organizationId)))
    .limit(1);

  return results[0] ?? null;
}

export async function findActiveBatchByHash(
  db: Database,
  organizationId: string,
  fileHash: string,
): Promise<ImportBatch | null> {
  const results = await db
    .select()
    .from(importBatches)
    .where(
      and(eq(importBatches.organizationId, organizationId), eq(importBatches.fileHash, fileHash)),
    )
    .limit(1);

  return results[0] ?? null;
}

export async function updateBatchStatus(
  db: Database,
  id: string,
  status: ImportBatchStatus,
): Promise<ImportBatch> {
  const [updated] = await db
    .update(importBatches)
    .set({ status, updatedAt: new Date() })
    .where(eq(importBatches.id, id))
    .returning();

  if (updated === undefined) {
    throw new Error(`updateBatchStatus: batch ${id} não encontrado`);
  }
  return updated;
}

export async function updateBatchCounters(
  db: Database,
  id: string,
  counters: {
    totalRows?: number;
    validRows?: number;
    invalidRows?: number;
    processedRows?: number;
    status?: ImportBatchStatus;
  },
): Promise<void> {
  await db
    .update(importBatches)
    .set({ ...counters, updatedAt: new Date() })
    .where(eq(importBatches.id, id));
}

export async function confirmBatch(
  db: Database,
  id: string,
  confirmedByUserId: string,
): Promise<ImportBatch> {
  const [updated] = await db
    .update(importBatches)
    .set({
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedByUserId,
      updatedAt: new Date(),
    })
    .where(eq(importBatches.id, id))
    .returning();

  if (updated === undefined) {
    throw new Error(`confirmBatch: batch ${id} não encontrado`);
  }
  return updated;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export async function bulkInsertRows(db: Database, rows: ImportRowInsert[]): Promise<void> {
  if (rows.length === 0) return;

  // Inserir em chunks de 500 para evitar limites de parâmetro
  const CHUNK_SIZE = 500;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await db.insert(importRows).values(chunk).onConflictDoNothing();
  }
}

export async function findRowsByBatch(
  db: Database,
  batchId: string,
  options: {
    status?: ImportRowStatus;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ImportRow[]> {
  const conditions = [eq(importRows.batchId, batchId)];
  if (options.status !== undefined) {
    conditions.push(eq(importRows.status, options.status));
  }

  return db
    .select()
    .from(importRows)
    .where(and(...conditions))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);
}

export async function countRowsByStatus(
  db: Database,
  batchId: string,
): Promise<Record<ImportRowStatus, number>> {
  const results = await db
    .select({
      status: importRows.status,
      count: sql<number>`count(*)::int`,
    })
    .from(importRows)
    .where(eq(importRows.batchId, batchId))
    .groupBy(importRows.status);

  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.status] = r.count;
  }

  return {
    pending: counts['pending'] ?? 0,
    valid: counts['valid'] ?? 0,
    invalid: counts['invalid'] ?? 0,
    persisted: counts['persisted'] ?? 0,
    failed: counts['failed'] ?? 0,
  };
}

export async function updateRowStatus(
  db: Database,
  rowId: string,
  status: ImportRowStatus,
  entityId?: string,
): Promise<void> {
  await db
    .update(importRows)
    .set({ status, entityId: entityId ?? null, updatedAt: new Date() })
    .where(eq(importRows.id, rowId));
}

export async function findValidRowsForBatch(db: Database, batchId: string): Promise<ImportRow[]> {
  return db
    .select()
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), eq(importRows.status, 'valid')));
}

export async function incrementProcessedRows(db: Database, batchId: string): Promise<void> {
  await db
    .update(importBatches)
    .set({
      processedRows: sql`${importBatches.processedRows} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(importBatches.id, batchId));
}
