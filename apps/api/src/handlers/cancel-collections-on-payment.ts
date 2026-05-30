// =============================================================================
// handlers/cancel-collections-on-payment.ts — Handler de cancelamento de
// collection_jobs ao registrar pagamento de parcela (F5-S07).
//
// Responsabilidade:
//   Quando payment_due.status muda para 'paid' (via evento futuro ou chamada direta),
//   cancelar todos os collection_jobs com status='scheduled' da mesma parcela,
//   evitando enviar cobranças a quem já pagou.
//
// Uso:
//   Chamado pela service de payment_due ao registrar pagamento (F5-S08):
//     await cancelCollectionJobsOnPayment(db, { paymentDueId, organizationId });
//
//   Também pode ser chamado em um handler de evento 'billing.payment_registered'
//   quando esse evento for implementado em slot futuro.
//
// Fluxo:
//   1. SELECT collection_jobs WHERE payment_due_id=$1 AND status='scheduled' FOR UPDATE SKIP LOCKED.
//   2. UPDATE status='paid_before_send' + last_error='payment_registered'.
//   3. Emitir billing.collection_cancelled por job cancelado (idempotente por job_id).
//   4. Audit log por job cancelado.
//
// Idempotência:
//   - UPDATE WHERE status='scheduled' é naturalmente idempotente:
//     re-execução com parcela já paga não encontra linhas scheduled.
//   - outbox emit usa idempotency_key: `billing.collection_cancelled:<job_id>:paid`.
//
// LGPD §8.5:
//   - Logs usam apenas IDs opacos (job_id, payment_due_id).
//   - Conteúdo de pagamento NUNCA logado.
//   - Outbox payloads sem PII bruta.
// =============================================================================
import { and, eq } from 'drizzle-orm';
import pino from 'pino';

import { env } from '../config/env.js';
import { db } from '../db/client.js';
import type { Database } from '../db/client.js';
import { collectionJobs } from '../db/schema/index.js';
import { emit } from '../events/emit.js';
import type { DrizzleTx } from '../events/emit.js';
import type { CollectionCancelledData } from '../events/types.js';
import { auditLog } from '../lib/audit.js';
import type { AuditTx } from '../lib/audit.js';

// ---------------------------------------------------------------------------
// Logger auto-suficiente (sem dep do runtime do worker para evitar ciclos)
// ---------------------------------------------------------------------------

/** Redact canônico (doc 17 §8.3). */
const REDACT_PATHS = [
  '*.cpf',
  '*.email',
  '*.telefone',
  '*.phone',
  '*.password',
  '*.senha',
  '*.token',
  '*.document_number',
  '*.birth_date',
  '*.address',
];

const baseLogger = pino({
  name: 'cancel-collections-on-payment',
  level: env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  ...(env.NODE_ENV === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : {}),
});

// ---------------------------------------------------------------------------
// Tipos de entrada
// ---------------------------------------------------------------------------

export interface CancelCollectionsParams {
  paymentDueId: string;
  organizationId: string;
  /** Contexto de correlação para rastreamento (opcional). */
  correlationId?: string;
}

export interface CancelCollectionsResult {
  jobsCancelled: number;
  paymentDueId: string;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

/**
 * Cancela todos os collection_jobs 'scheduled' de uma parcela ao registrar pagamento.
 *
 * Idempotente: se nenhum job scheduled existir, retorna { jobsCancelled: 0 }.
 *
 * @param database  Instância Drizzle injetável (facilita testes).
 * @param params    Parâmetros de cancelamento.
 */
export async function cancelCollectionJobsOnPayment(
  database: Database,
  params: CancelCollectionsParams,
): Promise<CancelCollectionsResult> {
  const { paymentDueId, organizationId, correlationId } = params;
  const logger = baseLogger.child({
    correlation_id: correlationId ?? null,
    payment_due_id: paymentDueId,
  });

  const now = new Date();

  let jobsCancelled = 0;

  await database.transaction(async (tx) => {
    // Justificativa dos casts: Drizzle não exporta NodePgTransaction como tipo público.
    // DrizzleTx e AuditTx são interfaces estruturais compatíveis com a transação.
    const txDb = tx as unknown as Database;
    const txForEmit = tx as unknown as DrizzleTx;
    const txForAudit = tx as unknown as AuditTx;

    // -------------------------------------------------------------------------
    // SELECT FOR UPDATE SKIP LOCKED: fecha race com collection-sender
    // Jobs sendo processados pelo sender (já com lock triggered) são ignorados
    // pelo SKIP LOCKED — o sender perceberá que a parcela está paga ao carregar contexto.
    // -------------------------------------------------------------------------
    const scheduledJobs = await txDb
      .select({ id: collectionJobs.id, ruleId: collectionJobs.ruleId })
      .from(collectionJobs)
      .where(
        and(
          eq(collectionJobs.paymentDueId, paymentDueId),
          eq(collectionJobs.organizationId, organizationId),
          eq(collectionJobs.status, 'scheduled'),
        ),
      )
      .for('update', { skipLocked: true });

    if (scheduledJobs.length === 0) {
      logger.debug(
        { payment_due_id: paymentDueId },
        'nenhum collection_job scheduled para a parcela — no-op',
      );
      return;
    }

    // UPDATE batch: todos os jobs locked → paid_before_send
    await txDb
      .update(collectionJobs)
      .set({
        status: 'paid_before_send',
        lastError: 'payment_registered',
        updatedAt: now,
      })
      .where(
        and(
          eq(collectionJobs.paymentDueId, paymentDueId),
          eq(collectionJobs.organizationId, organizationId),
          eq(collectionJobs.status, 'scheduled'),
        ),
      );

    // Emitir billing.collection_cancelled + audit por job cancelado
    for (const job of scheduledJobs) {
      const cancelledData: CollectionCancelledData = {
        collection_job_id: job.id,
        payment_due_id: paymentDueId,
        rule_id: job.ruleId,
        reason: 'paid_before_send',
      };

      // exactOptionalPropertyTypes: omitir correlationId se undefined (não passar string | undefined).
      const emitEvent = {
        eventName: 'billing.collection_cancelled' as const,
        aggregateType: 'collection_job',
        aggregateId: job.id,
        organizationId,
        actor: { kind: 'system' as const, id: null, ip: null },
        idempotencyKey: `billing.collection_cancelled:${job.id}:paid`,
        data: cancelledData,
        ...(correlationId !== undefined ? { correlationId } : {}),
      };
      await emit(txForEmit, emitEvent);

      await auditLog(txForAudit, {
        organizationId,
        actor: null,
        action: 'billing.collection_cancelled_on_payment',
        resource: { type: 'collection_job', id: job.id },
        after: {
          job_id: job.id,
          // LGPD: apenas IDs opacos — sem valor da parcela ou dados do contrato
          payment_due_id: paymentDueId,
          reason: 'paid_before_send',
        },
        correlationId: correlationId ?? null,
      });
    }

    jobsCancelled = scheduledJobs.length;

    logger.info(
      {
        event: 'billing.collection_cancelled_on_payment',
        payment_due_id: paymentDueId,
        jobs_cancelled: jobsCancelled,
      },
      `${String(jobsCancelled)} collection_job(s) cancelado(s) por pagamento da parcela`,
    );
  });

  return { jobsCancelled, paymentDueId };
}

// ---------------------------------------------------------------------------
// Fábrica de handler — injeção de db para testes
// ---------------------------------------------------------------------------

/**
 * Retorna uma função bound ao db singleton ou ao db injetado.
 * Permite usar em handlers de eventos futuros ou chamada direta de services.
 */
export function buildCancelCollectionsOnPaymentHandler(
  _db: Database = db,
): (params: CancelCollectionsParams) => Promise<CancelCollectionsResult> {
  return (params: CancelCollectionsParams) => cancelCollectionJobsOnPayment(_db, params);
}
