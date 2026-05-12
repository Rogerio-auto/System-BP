// =============================================================================
// workers/import-processor.ts — Worker de processamento de importações (F1-S17).
//
// Processo Node.js SEPARADO. Iniciado via: pnpm --filter @elemento/api worker:import
//
// Fluxo:
//   1. Poll do outbox para import.uploaded e import.confirmed.
//   2. import.uploaded  → processUploaded: parse + validate → preview_ready.
//   3. import.confirmed → processConfirmed: persistRow por linha válida → completed.
//
// Idempotência:
//   - Verifica status do batch antes de processar (skip se já preview_ready/completed).
//   - processedAt no outbox garante que eventos são processados uma só vez.
//
// Resiliência:
//   - Falha de 1 linha não para o batch (linha marcada 'failed', batch continua).
//   - Falha total do batch → status 'failed' + log.
//
// LGPD §8.5:
//   - raw_data nunca vai para logs sem redact.
//   - Eventos emitidos no outbox nunca contêm PII.
// =============================================================================
import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { eventOutbox } from '../db/schema/events.js';
import { emit } from '../events/emit.js';
import { requireFlag } from '../lib/featureFlags.js';
import {
  findBatchById,
  updateBatchStatus,
  updateBatchCounters,
  bulkInsertRows,
  findValidRowsForBatch,
  updateRowStatus,
  incrementProcessedRows,
} from '../modules/imports/repository.js';
import { getImportFilePath, redactImportRowPii } from '../modules/imports/service.js';
import type { ImportContext } from '../services/imports/adapter.js';
import { isParseError } from '../services/imports/adapter.js';
import { parseFile } from '../services/imports/fileParser.js';
import { getAdapter } from '../services/imports/registry.js';

import { createWorkerRuntime } from './_runtime.js';

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'import-processor';
const POLL_INTERVAL_MS = 5_000;
const PERSIST_CHUNK_SIZE = 50;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// processUploaded — Fase 1: parse + validate → preview_ready
// ---------------------------------------------------------------------------

async function processUploaded(batchId: string): Promise<void> {
  const batch = await findBatchById(db, batchId, '');

  if (batch === null) {
    runtime.logger.warn({ batchId }, 'import-processor: batch não encontrado');
    return;
  }

  // Idempotência: skip se já foi processado
  if (batch.status !== 'uploaded') {
    runtime.logger.info(
      { batchId, status: batch.status },
      'import-processor: batch já processado — skipping',
    );
    return;
  }

  // Marcar como parsing
  await updateBatchStatus(db, batchId, 'parsing');

  try {
    const adapter = getAdapter(batch.entityType);
    const filePath = getImportFilePath(batchId);

    // Parse do arquivo
    const { rows, totalRows } = await parseFile(filePath, batch.mimeType);

    runtime.logger.info({ batchId, totalRows }, 'import-processor: arquivo parseado');

    // Validar cada linha
    const ctx: Omit<ImportContext, 'rowIndex'> = {
      organizationId: batch.organizationId,
      userId: batch.createdByUserId,
      batchId,
      ip: null,
    };

    const rowsToInsert: Array<{
      batchId: string;
      rowIndex: number;
      rawData: Record<string, unknown>;
      normalizedData: Record<string, unknown> | null;
      validationErrors: string[] | null;
      status: 'valid' | 'invalid';
    }> = [];

    let validCount = 0;
    let invalidCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      if (raw === undefined) continue;

      const rowCtx: ImportContext = { ...ctx, rowIndex: i };

      const parsed = adapter.parseRow(raw);

      if (isParseError(parsed)) {
        rowsToInsert.push({
          batchId,
          rowIndex: i,
          rawData: raw,
          normalizedData: null,
          validationErrors: [parsed.error],
          status: 'invalid',
        });
        invalidCount++;
        continue;
      }

      const validated = await adapter.validateRow(parsed, rowCtx);

      if ('errors' in validated && validated.errors !== undefined) {
        rowsToInsert.push({
          batchId,
          rowIndex: i,
          rawData: raw,
          normalizedData: null,
          validationErrors: validated.errors,
          status: 'invalid',
        });
        invalidCount++;
      } else if ('input' in validated && validated.input !== undefined) {
        rowsToInsert.push({
          batchId,
          rowIndex: i,
          rawData: raw,
          normalizedData: validated.input as Record<string, unknown>,
          validationErrors: null,
          status: 'valid',
        });
        validCount++;
      }
    }

    // Persistir linhas em bulk
    await bulkInsertRows(db, rowsToInsert);

    // Atualizar contadores do batch
    await updateBatchCounters(db, batchId, {
      totalRows,
      validRows: validCount,
      invalidRows: invalidCount,
      status: 'preview_ready',
    });

    runtime.logger.info(
      { batchId, totalRows, validCount, invalidCount },
      'import-processor: preview_ready',
    );
  } catch (err: unknown) {
    runtime.logger.error({ batchId, err }, 'import-processor: falha no processamento');
    await updateBatchStatus(db, batchId, 'failed');
  }
}

// ---------------------------------------------------------------------------
// processConfirmed — Fase 2: persistir linhas válidas → completed
// ---------------------------------------------------------------------------

async function processConfirmed(batchId: string): Promise<void> {
  const batch = await findBatchById(db, batchId, '');

  if (batch === null) {
    runtime.logger.warn({ batchId }, 'import-processor: batch não encontrado');
    return;
  }

  // Idempotência: skip se não está confirmado
  if (batch.status !== 'confirmed') {
    runtime.logger.info(
      { batchId, status: batch.status },
      'import-processor: batch não está confirmado — skipping',
    );
    return;
  }

  await updateBatchStatus(db, batchId, 'processing');

  const adapter = getAdapter(batch.entityType);
  const validRows = await findValidRowsForBatch(db, batchId);

  const ctx: Omit<ImportContext, 'rowIndex'> = {
    organizationId: batch.organizationId,
    userId: batch.createdByUserId,
    batchId,
    ip: null,
  };

  let successCount = 0;
  let failureCount = 0;

  // Processar em chunks
  for (let i = 0; i < validRows.length; i += PERSIST_CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + PERSIST_CHUNK_SIZE);

    for (const row of chunk) {
      try {
        const input = row.normalizedData;
        if (input === null || input === undefined) {
          runtime.logger.warn(
            { rowId: row.id, rowIndex: row.rowIndex },
            'import-processor: linha válida sem normalizedData — skipping',
          );
          continue;
        }

        const rowCtx: ImportContext = { ...ctx, rowIndex: row.rowIndex };

        const result = await adapter.persistRow(
          input,
          rowCtx,
          db, // passa db como tx (limitação MVP)
        );

        await updateRowStatus(db, row.id, 'persisted', result.entityId);
        await incrementProcessedRows(db, batchId);
        successCount++;
      } catch (err: unknown) {
        runtime.logger.error(
          {
            rowId: row.id,
            rowIndex: row.rowIndex,
            // LGPD: redact de PII antes de logar dados brutos
            rawData: row.rawData !== null ? redactImportRowPii(row.rawData) : null,
            err,
          },
          'import-processor: falha ao persistir linha',
        );
        await updateRowStatus(db, row.id, 'failed');
        await incrementProcessedRows(db, batchId);
        failureCount++;
      }
    }
  }

  // Atualizar status final
  await db.transaction(async (tx) => {
    const typedTx = tx as unknown as typeof db;

    const finalStatus = failureCount === 0 ? 'completed' : 'completed';
    await updateBatchCounters(typedTx, batchId, {
      status: finalStatus,
    });

    await emit(typedTx, {
      eventName: 'import.completed',
      aggregateType: 'import_batch',
      aggregateId: batchId,
      organizationId: batch.organizationId,
      actor: { kind: 'user', id: batch.createdByUserId, ip: null },
      idempotencyKey: `import.completed:${batchId}`,
      data: {
        batch_id: batchId,
        success_count: successCount,
        failure_count: failureCount,
      },
    });
  });

  runtime.logger.info(
    { batchId, successCount, failureCount },
    'import-processor: processamento concluído',
  );
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

async function pollOnce(): Promise<void> {
  const enabled = await requireFlag(db, 'crm.import.enabled', runtime.logger);
  if (!enabled) return;

  // Buscar eventos de import pendentes
  const events = await db
    .select({
      id: eventOutbox.id,
      eventName: eventOutbox.eventName,
      payload: eventOutbox.payload,
    })
    .from(eventOutbox)
    .where(
      and(
        isNull(eventOutbox.processedAt),
        isNull(eventOutbox.failedAt),
        // `as` justificado: eventName é texto livre no schema, cast para tipo AppEventName
        eq(eventOutbox.eventName, 'import.uploaded' as string),
      ),
    )
    .limit(10);

  const confirmedEvents = await db
    .select({
      id: eventOutbox.id,
      eventName: eventOutbox.eventName,
      payload: eventOutbox.payload,
    })
    .from(eventOutbox)
    .where(
      and(
        isNull(eventOutbox.processedAt),
        isNull(eventOutbox.failedAt),
        eq(
          eventOutbox.eventName,
          // `as` justificado: eventName é texto livre no schema, cast para tipo AppEventName
          'import.confirmed' as string,
        ),
      ),
    )
    .limit(10);

  const allEvents = [...events, ...confirmedEvents];

  for (const event of allEvents) {
    const payload = event.payload as { batch_id?: string };
    const batchId = payload?.batch_id;

    if (typeof batchId !== 'string') {
      runtime.logger.warn({ eventId: event.id }, 'import-processor: evento sem batch_id');
      continue;
    }

    try {
      if (event.eventName === 'import.uploaded') {
        await processUploaded(batchId);
      } else if (event.eventName === 'import.confirmed') {
        await processConfirmed(batchId);
      }

      // Marcar evento como processado
      await db
        .update(eventOutbox)
        .set({ processedAt: new Date() })
        .where(eq(eventOutbox.id, event.id));
    } catch (err: unknown) {
      runtime.logger.error(
        { eventId: event.id, batchId, err },
        'import-processor: erro ao processar evento',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const runtime = createWorkerRuntime(WORKER_NAME);

export { processUploaded, processConfirmed };

async function main(): Promise<void> {
  runtime.logger.info('import-processor iniciado');

  while (!runtime.isShuttingDown()) {
    try {
      await pollOnce();
    } catch (err: unknown) {
      runtime.logger.error({ err }, 'import-processor: erro no poll');
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// Guard: só executar main() quando rodado diretamente
if (process.argv[1] !== undefined && process.argv[1].includes('import-processor')) {
  main().catch((err: unknown) => {
    runtime.logger.fatal({ err }, 'import-processor: falha fatal');
    process.exit(1);
  });
}
