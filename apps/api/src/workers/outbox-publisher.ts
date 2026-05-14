// =============================================================================
// workers/outbox-publisher.ts — Worker de publicação do Outbox.
//
// Processo Node.js SEPARADO do servidor Fastify. Nunca importado por app.ts.
// Iniciado via: pnpm --filter @elemento/api worker:outbox
//
// Fluxo:
//   1. LISTEN 'outbox_new' — acordado por NOTIFY do trigger Postgres (baixa latência).
//   2. Ao acordar (ou no poll interval de fallback de 5s):
//      SELECT ... FOR UPDATE SKIP LOCKED — pega até 50 eventos pendentes.
//      SKIP LOCKED garante que múltiplas instâncias não colidam.
//   3. Para cada evento, roteia para handlers registrados (por event_name).
//   4. Idempotência via event_processing_logs: INSERT (event_id, handler_name).
//      Se unique constraint disparar → skip silencioso.
//   5. Sucesso: UPDATE event_outbox SET processed_at = now().
//   6. Falha: incrementa attempts + grava last_error (backoff exponencial).
//   7. Após MAX_ATTEMPTS falhas: move para event_dlq, seta failed_at.
//
// LGPD §8.5: payload não contém PII bruta. Handlers que precisam de PII
//   devem chamar GET /internal/<recurso>/:id com X-Internal-Token.
// =============================================================================
import { and, eq } from 'drizzle-orm';
import pg from 'pg';

import { env } from '../config/env.js';
import type { EventOutbox } from '../db/schema/events.js';
import { eventProcessingLogs } from '../db/schema/events.js';
import type { RegisteredHandler } from '../events/handlers.js';
import { getHandlers, setupHandlers } from '../events/handlers.js';

import { createWorkerRuntime } from './_runtime.js';

const { Client } = pg;

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const WORKER_NAME = 'outbox-publisher';
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
/** Poll interval de fallback (ms) — quando NOTIFY não chega (ex: restart). */
const POLL_INTERVAL_MS = 5_000;
/** Backoff exponencial base (ms). */
const BACKOFF_BASE_MS = 1_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts), 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Row retornada pelo SELECT raw do pg (snake_case do Postgres)
interface RawEventRow {
  id: string;
  organization_id: string;
  event_name: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  payload: unknown;
  correlation_id: string | null;
  idempotency_key: string;
  attempts: number;
  last_error: string | null;
  processed_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
}

function mapRowToEvent(row: RawEventRow): EventOutbox {
  return {
    id: row.id,
    organizationId: row.organization_id,
    eventName: row.event_name,
    eventVersion: Number(row.event_version),
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: row.payload,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key,
    attempts: Number(row.attempts),
    lastError: row.last_error,
    processedAt: row.processed_at,
    failedAt: row.failed_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type Db = ReturnType<typeof createWorkerRuntime>['db'];
type Logger = ReturnType<typeof createWorkerRuntime>['logger'];

// ---------------------------------------------------------------------------
// Executar um handler com idempotência
// ---------------------------------------------------------------------------

type HandlerOutcome =
  | { outcome: 'success' }
  | { outcome: 'skipped' }
  | { outcome: 'failed'; errorMessage: string };

async function runHandler(
  db: Db,
  event: EventOutbox,
  registered: RegisteredHandler,
  logger: Logger,
): Promise<HandlerOutcome> {
  const startMs = Date.now();
  const { id: eventId, organizationId } = event;
  const { name: handlerName } = registered;

  // Inserir registro de idempotência antes de executar.
  // ON CONFLICT DO NOTHING + RETURNING permite distinguir "inserido" de "já existe"
  // de forma idiomática, sem depender de matching de mensagem de erro do Postgres
  // (que varia com o locale — em pt-BR vem "duplicar valor da chave...").
  const inserted = await db
    .insert(eventProcessingLogs)
    .values({
      eventId,
      organizationId,
      handlerName,
      status: 'success', // optimistic; atualizado abaixo se falhar
      durationMs: null,
    })
    .onConflictDoNothing({
      target: [eventProcessingLogs.eventId, eventProcessingLogs.handlerName],
    })
    .returning({ id: eventProcessingLogs.id });

  if (inserted.length === 0) {
    // Já existe log para este (event_id, handler_name) — handler já rodou em
    // tentativa anterior. Skip silencioso; processBatch marcará o evento como
    // processed_at desde que nenhum outro handler do batch falhe.
    logger.debug({ eventId, handlerName }, 'already processed — idempotency skip');
    return { outcome: 'skipped' };
  }

  // Executar o handler
  try {
    await registered.fn(event);
    const durationMs = Date.now() - startMs;

    await db
      .update(eventProcessingLogs)
      .set({ durationMs, status: 'success' })
      .where(
        and(
          eq(eventProcessingLogs.eventId, eventId),
          eq(eventProcessingLogs.handlerName, handlerName),
        ),
      );

    logger.debug({ eventId, handlerName, durationMs }, 'handler success');
    return { outcome: 'success' };
  } catch (handlerErr) {
    const durationMs = Date.now() - startMs;
    const errorMessage = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);

    await db
      .update(eventProcessingLogs)
      .set({ status: 'failed', errorMessage, durationMs })
      .where(
        and(
          eq(eventProcessingLogs.eventId, eventId),
          eq(eventProcessingLogs.handlerName, handlerName),
        ),
      );

    logger.warn({ eventId, handlerName, err: handlerErr }, 'handler failed');
    return { outcome: 'failed', errorMessage };
  }
}

// ---------------------------------------------------------------------------
// Processar um batch de eventos
// ---------------------------------------------------------------------------

async function processBatch(db: Db, pool: pg.Pool, logger: Logger): Promise<number> {
  const client = await pool.connect();
  let processedCount = 0;

  try {
    await client.query('BEGIN');

    // FOR UPDATE SKIP LOCKED — múltiplas instâncias do worker não colidem
    const result = await client.query<RawEventRow>(
      `SELECT
        id, organization_id, event_name, event_version,
        aggregate_type, aggregate_id, payload,
        correlation_id, idempotency_key,
        attempts, last_error, processed_at, failed_at, created_at
       FROM event_outbox
       WHERE processed_at IS NULL
         AND failed_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE],
    );

    const events = result.rows.map(mapRowToEvent);

    if (events.length === 0) {
      await client.query('COMMIT');
      return 0;
    }

    logger.debug({ count: events.length }, 'processing batch');

    for (const event of events) {
      const handlers = getHandlers(event.eventName);
      let anyFailed = false;
      let lastErrorMsg: string | null = null;

      if (handlers.length === 0) {
        // Nenhum handler registrado — marcar como processado (fan-out futuro)
        logger.debug(
          { eventId: event.id, eventName: event.eventName },
          'no handlers registered — marking processed',
        );
      } else {
        for (const registered of handlers) {
          const result = await runHandler(db, event, registered, logger);
          if (result.outcome === 'failed') {
            anyFailed = true;
            lastErrorMsg = result.errorMessage;
          }
        }
      }

      const newAttempts = event.attempts + 1;

      if (!anyFailed) {
        // Sucesso (ou sem handlers) — marcar como processado
        await client.query('UPDATE event_outbox SET processed_at = now() WHERE id = $1', [
          event.id,
        ]);
        processedCount++;
      } else if (newAttempts >= MAX_ATTEMPTS) {
        // Esgotou tentativas — mover para DLQ
        logger.warn(
          { eventId: event.id, eventName: event.eventName, attempts: newAttempts },
          'max attempts reached — moving to DLQ',
        );

        await client.query(
          `INSERT INTO event_dlq
            (original_event_id, organization_id, event_name, event_version,
             aggregate_type, aggregate_id, payload, correlation_id,
             total_attempts, last_error)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
          [
            event.id,
            event.organizationId,
            event.eventName,
            event.eventVersion,
            event.aggregateType,
            event.aggregateId,
            JSON.stringify(event.payload),
            event.correlationId,
            newAttempts,
            lastErrorMsg ?? event.lastError,
          ],
        );

        await client.query(
          'UPDATE event_outbox SET failed_at = now(), attempts = $1, last_error = $2 WHERE id = $3',
          [newAttempts, lastErrorMsg ?? event.lastError, event.id],
        );
      } else {
        // Falha parcial — incrementar attempts + gravar último erro p/ diagnose.
        // Nota: o backoff efetivo é o poll interval (5s) — não há sleep aqui pois
        // o worker já libera o batch e volta a dormir até NOTIFY/poll. backoffMs()
        // é apenas hint informacional no log para correlacionar com retries.
        const backoffHintMs = backoffMs(newAttempts);
        logger.warn(
          {
            eventId: event.id,
            attempts: newAttempts,
            lastError: lastErrorMsg,
            backoffHintMs,
          },
          'retry scheduled',
        );

        await client.query('UPDATE event_outbox SET attempts = $1, last_error = $2 WHERE id = $3', [
          newAttempts,
          lastErrorMsg,
          event.id,
        ]);
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* ignorar erro de rollback se conexão quebrada */
    });
    logger.error({ err }, 'batch transaction error — rolled back');
  } finally {
    client.release();
  }

  return processedCount;
}

// ---------------------------------------------------------------------------
// Loop principal com LISTEN/NOTIFY
// ---------------------------------------------------------------------------

async function runPublisher(): Promise<void> {
  const { logger, pool, db, onShutdown, isShuttingDown } = createWorkerRuntime(WORKER_NAME, 5);

  // Registrar handlers de domínio (F1-S22+) antes de processar eventos
  // Usa setupHandlers() com dynamic import para evitar deps carregadas antes do pool.
  await setupHandlers();
  logger.info({ eventNames: [] }, 'domain handlers registered');

  // Client dedicado para LISTEN (não retorna ao pool — LISTEN é stateful por conexão)
  const listenClient = new Client({
    connectionString: env.DATABASE_URL,
  });

  try {
    await listenClient.connect();
  } catch (err) {
    logger.fatal({ err }, 'failed to connect LISTEN client');
    process.exit(1);
  }

  let notifyPending = false;

  listenClient.on('notification', (msg) => {
    if (msg.channel === 'outbox_new') {
      logger.trace('NOTIFY outbox_new received');
      notifyPending = true;
    }
  });

  listenClient.on('error', (err) => {
    logger.error({ err }, 'LISTEN client error');
  });

  await listenClient.query('LISTEN outbox_new');
  logger.info('listening on PostgreSQL channel outbox_new');

  onShutdown(async () => {
    logger.info('closing LISTEN client');
    try {
      await listenClient.end();
    } catch {
      /* already closed */
    }
  });

  // Processar backlog inicial (eventos antes do LISTEN)
  logger.info('draining initial backlog');
  let n: number;
  do {
    n = await processBatch(db, pool, logger);
  } while (n > 0 && !isShuttingDown());

  logger.info('entering main event loop');

  while (!isShuttingDown()) {
    if (!notifyPending) {
      await sleep(POLL_INTERVAL_MS);
    }

    if (isShuttingDown()) break;

    notifyPending = false;

    // Drenar todos os eventos em batches contínuos
    let batchSize: number;
    do {
      batchSize = await processBatch(db, pool, logger);
      if (batchSize > 0) {
        logger.info({ processed: batchSize }, 'batch complete');
      }
    } while (batchSize >= BATCH_SIZE && !isShuttingDown());
  }

  logger.info('outbox-publisher stopped');
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

runPublisher().catch((err: unknown) => {
  console.error('[outbox-publisher] fatal startup error', err);
  process.exit(1);
});
