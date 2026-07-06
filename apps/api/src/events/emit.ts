// =============================================================================
// events/emit.ts — Helper `emit(tx, event)` para inserção transacional no outbox.
//
// CONTRATO:
//   - Recebe uma transação Drizzle ATIVA (nunca cria a própria).
//   - Insere em event_outbox na MESMA transação que a mutação de domínio.
//   - Se a transação fizer rollback, o evento também é desfeito (atomicidade).
//   - Não faz commit — o caller controla o ciclo de vida da transação.
//   - Retorna o UUID do evento inserido.
//
// USO CORRETO:
//   await db.transaction(async (tx) => {
//     const lead = await leadsRepo.create(tx, data);
//     await emit(tx, {
//       eventName:      'leads.created',
//       aggregateType:  'lead',
//       aggregateId:    lead.id,
//       organizationId: lead.organizationId,
//       actor:          { kind: 'user', id: userId, ip: requestIp },
//       idempotencyKey: `leads.created:${lead.id}:${Date.now()}`,
//       data:           { lead_id: lead.id, city_id: null, source: 'manual', ... },
//     });
//   });
//
// LGPD §8.5: `event.data` NUNCA deve conter PII bruta.
//   Ver types.ts para os tipos de cada evento — todos os campos são IDs ou métricas.
// =============================================================================
import { randomUUID } from 'node:crypto';

import { eventOutbox } from '../db/schema/events.js';

import type { AppEvent, AppEventName } from './types.js';

// ---------------------------------------------------------------------------
// Tipo da transação Drizzle
// ---------------------------------------------------------------------------
// Drizzle não exporta um tipo público para a transação isolada.
// Usamos uma interface estrutural mínima compatível com NodePgDatabase<Schema>
// (a transação tem os mesmos métodos que o db normal em Drizzle).
// Justificativa do `as DrizzleTx`: sem este tipo estrutural, a única alternativa
// seria `any`, que viola as regras do projeto.

export interface DrizzleTx {
  insert(table: typeof eventOutbox): {
    values(row: typeof eventOutbox.$inferInsert): Promise<unknown>;
  };
}

// ---------------------------------------------------------------------------
// emit()
// ---------------------------------------------------------------------------

/**
 * Emite um evento no outbox dentro da transação ativa.
 *
 * @param tx    Transação Drizzle ativa (não commita).
 * @param event Evento tipado (ver AppEvent em types.ts).
 * @returns UUID do evento inserido em event_outbox.
 *
 * @param opts.onConflictDoNothing Quando `true`, a violação de idempotency_key
 *        vira NO-OP silencioso (dedup) em vez de erro. Use para emissores com
 *        chave DETERMINÍSTICA que podem reemitir a mesma chave (ex.: cities.identified).
 *
 * @throws Postgres unique constraint error se idempotency_key já existir para
 *         esta organização — a transação do caller capturará e fará rollback.
 *         NÃO lança quando `opts.onConflictDoNothing === true`.
 */
export async function emit<K extends AppEventName>(
  tx: DrizzleTx,
  event: AppEvent<K>,
  opts?: { onConflictDoNothing?: boolean },
): Promise<string> {
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();

  const payload = {
    event_id: eventId,
    event_name: event.eventName,
    event_version: event.eventVersion ?? 1,
    occurred_at: occurredAt,
    actor: event.actor,
    correlation_id: event.correlationId ?? null,
    aggregate: {
      type: event.aggregateType,
      id: event.aggregateId,
    },
    // `event.data` é tipado via AppEventDataMap — nenhum campo é PII bruta.
    // O TypeScript garante isso em tempo de compilação via discriminated union.
    data: event.data,
    ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
  };

  const insert = tx.insert(eventOutbox).values({
    id: eventId,
    organizationId: event.organizationId,
    eventName: event.eventName,
    eventVersion: event.eventVersion ?? 1,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    payload,
    correlationId: event.correlationId ?? null,
    idempotencyKey: event.idempotencyKey,
    attempts: 0,
    lastError: null,
    processedAt: null,
    failedAt: null,
  });

  // Emissores com idempotency_key determinística (ex.: cities.identified =
  // city_identify_<lead>_<city>) podem reemitir a mesma chave. Nesse caso a
  // reemissão deve ser NO-OP silencioso (dedup), não erro: sem isso, a violação
  // de uq_event_outbox_idempotency derruba a transação do caller (500 em prod).
  if (opts?.onConflictDoNothing === true) {
    // `as` justificado: DrizzleTx é um tipo estrutural mínimo (values(): Promise)
    // deliberadamente enxuto para manter compatibilidade com os `tx` dos callers.
    // Em runtime, `insert` é o query builder real do Drizzle, que expõe
    // onConflictDoNothing(). Não alargamos a interface pública para não quebrar
    // callers estruturais (ex.: anonymize.ts) — o cast fica isolado aqui.
    await (insert as unknown as { onConflictDoNothing(): Promise<unknown> }).onConflictDoNothing();
  } else {
    await insert;
  }

  return eventId;
}
