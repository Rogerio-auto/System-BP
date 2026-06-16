// =============================================================================
// meta-webhook/dedup.ts — Idempotência por (provider, event_id) em webhook_events.
//
// Fluxo:
//   1. `isDuplicate(tx, provider, eventId)` → true se já existe registro.
//   2. `recordEvent(tx, params)` → insere em webhook_events antes de publicar.
//      Se publicação falhar, o caller retorna 500 para a Meta fazer retry.
//      Na retry, isDuplicate retorna true (não reprocessa).
//
// LGPD (doc 17 §8.3):
//   - raw_payload armazenado por 30 dias (expires_at automático no schema).
//   - Nunca logar raw_payload — apenas provider e event_id.
//   - organization_id pode ser NULL durante ingest (resolvido pelo worker S08).
//
// Isolamento de transação:
//   Ambas as funções recebem uma transação Drizzle ativa (`tx`) para garantir
//   que a inserção e a verificação acontecem no mesmo snapshot de DB,
//   evitando race conditions em recebimentos concorrentes do mesmo event_id.
// =============================================================================
import { eq, and } from 'drizzle-orm';

import { webhookEvents } from '../../db/schema/webhookEvents.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Interface estrutural mínima para a transação/db Drizzle. */
export interface DedupTx {
  select(fields?: unknown): {
    from(table: typeof webhookEvents): {
      where(condition: unknown): Promise<ReadonlyArray<{ id: string }>>;
    };
  };
  insert(table: typeof webhookEvents): {
    values(row: typeof webhookEvents.$inferInsert): Promise<unknown>;
  };
}

/** Parâmetros para registrar um evento de webhook. */
export interface RecordEventParams {
  /** Provider de origem (meta_whatsapp | meta_instagram). */
  provider: string;
  /** ID único do evento no provider — parte da chave de dedup (provider, event_id). */
  eventId: string;
  /** Tipo do evento (message | status | template_status_update | …). */
  eventType: string;
  /**
   * Payload bruto do webhook.
   * LGPD: pode conter PII — retenção 30 dias via expires_at no schema.
   * Nunca logar este campo.
   */
  rawPayload: unknown;
  /**
   * Organization ID que recebeu o webhook.
   * NULL durante ingest inicial (resolvido pelo worker S08 via entry[].id).
   */
  organizationId: string | null;
}

// ---------------------------------------------------------------------------
// isDuplicate — verifica existência antes de processar
// ---------------------------------------------------------------------------

/**
 * Verifica se já existe um registro em `webhook_events` para o par (provider, event_id).
 *
 * Deve ser chamado dentro de uma transação com `SELECT FOR UPDATE` implícito
 * para evitar race conditions em recebimentos concorrentes.
 *
 * @param db        Instância de DB ou transação Drizzle.
 * @param provider  Provider de origem.
 * @param eventId   ID único do evento.
 * @returns         `true` se duplicado (já processado ou em processamento).
 */
export async function isDuplicate(
  db: DedupTx,
  provider: string,
  eventId: string,
): Promise<boolean> {
  // `id` é o único campo que precisamos — minimiza payload do SELECT.
  const rows = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)));

  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// recordEvent — insere antes de publicar no RabbitMQ
// ---------------------------------------------------------------------------

/**
 * Insere um registro em `webhook_events` como parte do processamento do webhook.
 *
 * Este registro deve ser criado ANTES de publicar na fila. Se a publicação
 * falhar, o Meta retenta o webhook e `isDuplicate` já retornará `true`,
 * impedindo processamento duplicado.
 *
 * @param db     Instância de DB ou transação Drizzle.
 * @param params Dados do evento.
 * @returns      UUID do registro inserido.
 */
export async function recordEvent(db: DedupTx, params: RecordEventParams): Promise<void> {
  await db.insert(webhookEvents).values({
    provider: params.provider,
    eventId: params.eventId,
    eventType: params.eventType,
    rawPayload: params.rawPayload,
    organizationId: params.organizationId,
    // createdAt e expiresAt têm default no DB (now() e now() + 30 days).
    // processedAt é NULL — será atualizado pelo worker S08 ao concluir.
  });
}
