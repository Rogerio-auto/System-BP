// =============================================================================
// services/outbox/dlq.ts — Helpers para Dead-Letter Queue (DLQ) do outbox.
//
// Usa a tabela event_dlq (F1-S15, schema/events.ts) que já é alimentada
// pelo worker outbox-publisher quando um evento esgota MAX_ATTEMPTS.
//
// Responsabilidades:
//   - moveToDlq:       marca evento outbox como failed_permanent e insere na DLQ.
//   - replayFromDlq:   cria nova entrada em event_outbox a partir de uma DLQ row.
//   - listPendingDlq:  lista entradas não reprocessadas (uso admin).
//
// Nota: o worker já insere diretamente via SQL raw (performance). Estes helpers
// usam Drizzle e são destinados ao service/controller layer (admin endpoints,
// handler service).
//
// LGPD §8.5: o payload da DLQ segue a mesma restrição do outbox — sem PII bruta.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { eventDlq, eventOutbox } from '../../db/schema/events.js';
import type { EventDlq, EventOutbox } from '../../db/schema/events.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface MoveToDlqParams {
  event: EventOutbox;
  lastError: string;
}

export interface ReplayFromDlqParams {
  dlqId: string;
  /** UUID do usuário admin que disparou o replay. */
  actorUserId: string;
}

export interface ReplayFromDlqResult {
  newEventId: string;
}

export interface ListPendingDlqParams {
  organizationId?: string;
  eventName?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// moveToDlq
// ---------------------------------------------------------------------------

/**
 * Move um evento do outbox para a DLQ após falha permanente.
 *
 * Operação: INSERT em event_dlq + UPDATE failed_at em event_outbox.
 * Não usa transaction explícita — em caso de falha parcial, o worker
 * verá o evento ainda sem failed_at e o retentará (idempotente).
 *
 * @returns UUID da row inserida em event_dlq.
 */
export async function moveToDlq({ event, lastError }: MoveToDlqParams): Promise<string> {
  const dlqId = randomUUID();

  await db.insert(eventDlq).values({
    id: dlqId,
    originalEventId: event.id,
    organizationId: event.organizationId,
    eventName: event.eventName,
    eventVersion: event.eventVersion,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    // Payload sem PII — mesma regra LGPD §8.5 do outbox.
    payload: event.payload as Record<string, unknown>,
    correlationId: event.correlationId ?? null,
    totalAttempts: event.attempts + 1,
    lastError,
    reprocessed: false,
    reprocessEventId: null,
    reprocessedAt: null,
  });

  await db
    .update(eventOutbox)
    .set({
      failedAt: new Date(),
      attempts: event.attempts + 1,
      lastError,
    })
    .where(eq(eventOutbox.id, event.id));

  return dlqId;
}

// ---------------------------------------------------------------------------
// replayFromDlq
// ---------------------------------------------------------------------------

/**
 * Retenta um evento da DLQ criando uma nova entrada em event_outbox.
 *
 * O novo evento tem attempts=0 e idempotency_key único para evitar
 * colisão com a entrada original. A row da DLQ é marcada como reprocessada.
 *
 * @throws Error se dlqId não existir ou já estiver reprocessada.
 * @returns UUID do novo evento em event_outbox.
 */
export async function replayFromDlq({
  dlqId,
  actorUserId,
}: ReplayFromDlqParams): Promise<ReplayFromDlqResult> {
  // Buscar row da DLQ
  const rows = await db.select().from(eventDlq).where(eq(eventDlq.id, dlqId)).limit(1);

  const dlqRow = rows[0];
  if (dlqRow === undefined) {
    throw new Error(`DLQ entry not found: ${dlqId}`);
  }
  if (dlqRow.reprocessed) {
    throw new Error(`DLQ entry already reprocessed: ${dlqId}`);
  }

  const newEventId = randomUUID();
  const now = new Date();

  // Inserir novo evento no outbox com attempts zerados
  await db.insert(eventOutbox).values({
    id: newEventId,
    organizationId: dlqRow.organizationId,
    eventName: dlqRow.eventName,
    eventVersion: dlqRow.eventVersion,
    aggregateType: dlqRow.aggregateType,
    aggregateId: dlqRow.aggregateId,
    payload: dlqRow.payload as Record<string, unknown>,
    correlationId: dlqRow.correlationId ?? null,
    // Chave de idempotência única: sinaliza que é replay (evita colisão com original)
    idempotencyKey: `dlq-replay:${dlqId}:${actorUserId}`,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
  });

  // Marcar DLQ como reprocessada
  await db
    .update(eventDlq)
    .set({
      reprocessed: true,
      reprocessEventId: newEventId,
      reprocessedAt: now,
    })
    .where(eq(eventDlq.id, dlqId));

  return { newEventId };
}

// ---------------------------------------------------------------------------
// listPendingDlq
// ---------------------------------------------------------------------------

/**
 * Lista entradas da DLQ não reprocessadas, com paginação.
 * Usado pelo endpoint admin GET /api/admin/dlq.
 */
export async function listPendingDlq(params: ListPendingDlqParams = {}): Promise<EventDlq[]> {
  const { organizationId, eventName, limit = 50, offset = 0 } = params;

  const conditions = [eq(eventDlq.reprocessed, false)];

  if (organizationId !== undefined) {
    conditions.push(eq(eventDlq.organizationId, organizationId));
  }
  if (eventName !== undefined) {
    conditions.push(eq(eventDlq.eventName, eventName));
  }

  return db
    .select()
    .from(eventDlq)
    .where(and(...conditions))
    .orderBy(desc(eventDlq.movedAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Busca uma entry da DLQ por ID. Retorna undefined se não existir.
 */
export async function findDlqById(dlqId: string): Promise<EventDlq | undefined> {
  const rows = await db.select().from(eventDlq).where(eq(eventDlq.id, dlqId)).limit(1);
  return rows[0];
}
