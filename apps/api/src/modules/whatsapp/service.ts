// =============================================================================
// whatsapp/service.ts — Lógica de negócio para processamento de webhook.
//
// Pipeline (doc 07 §1.1):
//   1. Validar HMAC (feito antes no preHandler).
//   2. Idempotência: checar `idempotency_keys` por (key=wa_message_id).
//   3. Persistir payload bruto em `whatsapp_messages`.
//   4. Emitir evento `whatsapp.message_received` via outbox (sem PII).
//   5. Gravar idempotency key com resposta.
//
// Transacionalidade:
//   - Passos 3, 4 e 5 ocorrem na MESMA transação Drizzle.
//   - Se qualquer passo falhar → rollback → próxima chamada reprocessa.
//   - Se a transação commitar → idempotency key gravada → replay retorna cached.
//
// LGPD §8.5:
//   - Evento `whatsapp.message_received` carrega APENAS IDs (sem PII bruta).
//   - Payload bruto (PII) fica SOMENTE em `whatsapp_messages.payload`.
// =============================================================================
import { eq } from 'drizzle-orm';

import { db } from '../../db/client.js';
import { idempotencyKeys } from '../../db/schema/idempotencyKeys.js';
import { whatsappMessages } from '../../db/schema/whatsappMessages.js';
import { emit } from '../../events/emit.js';

import type { WaMessage, WebhookPayload } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos de retorno
// ---------------------------------------------------------------------------

export interface ProcessWebhookResult {
  /** true = processado agora; false = duplicado (idempotência hit) */
  created: boolean;
  /** UUID da linha em whatsapp_messages (ou null se duplicado sem linha nova) */
  messageId: string | null;
}

// ---------------------------------------------------------------------------
// processWebhookMessage()
// ---------------------------------------------------------------------------

/**
 * Processa uma única mensagem recebida do webhook Meta.
 *
 * @param organizationId  UUID da organização (multi-tenant).
 * @param waMsg           Objeto `message` extraído do webhook.
 * @param rawPayload      Payload completo do webhook (persistido bruto).
 * @param idempotencyKey  Chave de idempotência (= wa_message_id).
 * @param correlationId   UUID de correlação propagado do request.
 */
export async function processWebhookMessage(
  organizationId: string,
  waMsg: WaMessage,
  rawPayload: WebhookPayload,
  idempotencyKey: string,
  correlationId: string,
): Promise<ProcessWebhookResult> {
  // -------------------------------------------------------------------------
  // Passo 2: verificar idempotência antes de abrir transação
  // Leitura outside de tx é aceitável aqui — worst case: duas requisições
  // paralelas com a mesma key passam pelo check e a segunda falhará no
  // UNIQUE do banco (tratado abaixo).
  // -------------------------------------------------------------------------
  const existing = await db
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, idempotencyKey))
    .limit(1);

  if (existing.length > 0) {
    // Duplicado — sem-op. Meta exige 200 rápido.
    return { created: false, messageId: null };
  }

  // -------------------------------------------------------------------------
  // Parsear `timestamp` do webhook (Unix epoch string → Date)
  // -------------------------------------------------------------------------
  const tsEpoch = parseInt(waMsg.timestamp, 10);
  // Se timestamp inválido, usa now() como fallback defensivo
  const receivedAt = Number.isFinite(tsEpoch) ? new Date(tsEpoch * 1000) : new Date();

  // -------------------------------------------------------------------------
  // Passos 3, 4 e 5: transação atômica
  //   3. INSERT whatsapp_messages
  //   4. emit(tx, whatsapp.message_received) — outbox (sem PII)
  //   5. INSERT idempotency_keys
  // -------------------------------------------------------------------------
  let insertedId: string;

  await db.transaction(async (tx) => {
    // Passo 3: persistir payload bruto
    // ON CONFLICT: se outro request paralelo venceu a corrida, a constraint
    // UNIQUE(wa_message_id) lançará — a transação fará rollback e o insert
    // de idempotency_key não ocorrerá. O caller (controller) trata esse caso
    // com uma segunda leitura de idempotency_keys.
    const inserted = await tx
      .insert(whatsappMessages)
      .values({
        organizationId,
        waMessageId: waMsg.id,
        conversationId: null, // preenchido posteriormente pelo handler
        direction: 'inbound',
        // Payload completo (inclui PII). Nunca logado diretamente.
        // `rawPayload` é o objeto parsed — cast seguro via `as unknown` pois
        // `jsonb` do Drizzle aceita qualquer objeto serializável.
        payload: rawPayload as unknown as Record<string, unknown>,
        receivedAt,
      })
      .returning({ id: whatsappMessages.id });

    // inserted pode ser undefined se Drizzle retornar vazio (não deve ocorrer
    // com .returning(), mas noUncheckedIndexedAccess requer a guarda)
    const firstRow = inserted[0];
    if (firstRow === undefined) {
      throw new Error('INSERT whatsapp_messages retornou vazio — inconsistência inesperada');
    }
    insertedId = firstRow.id;

    // Passo 4: emitir evento no outbox (SEM PII — apenas IDs)
    await emit(tx, {
      eventName: 'whatsapp.message_received',
      aggregateType: 'whatsapp_message',
      aggregateId: insertedId,
      organizationId,
      actor: { kind: 'system', id: null, ip: null },
      correlationId,
      idempotencyKey: `whatsapp.message_received:${insertedId}`,
      data: {
        // LGPD §8.5: apenas IDs — sem from, sem text.body
        whatsapp_message_id: waMsg.id,
        chatwoot_conversation_id: null,
        lead_id: null,
      },
    });

    // Passo 5: gravar idempotency key (dentro da transação)
    // Se a transação fizer rollback, a key também não é gravada.
    // LGPD: response_body não contém PII — apenas { ok: true, id: uuid }
    await tx.insert(idempotencyKeys).values({
      key: idempotencyKey,
      endpoint: 'POST /api/whatsapp/webhook',
      requestHash: '', // preenchido pelo controller após o hash do body
      responseStatus: 200,
      responseBody: { ok: true, id: insertedId } as unknown as Record<string, unknown>,
    });
  });

  return { created: true, messageId: insertedId! };
}

// ---------------------------------------------------------------------------
// processWebhook()
//
// Entry point do controller. Itera sobre todos os messages do payload.
// O Meta pode enviar múltiplas mensagens em uma única chamada.
// ---------------------------------------------------------------------------

export async function processWebhook(
  organizationId: string,
  payload: WebhookPayload,
  correlationId: string,
): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const messages = change.value.messages ?? [];
      for (const waMsg of messages) {
        const result = await processWebhookMessage(
          organizationId,
          waMsg,
          payload,
          waMsg.id,
          correlationId,
        );

        if (result.created) {
          processed++;
        } else {
          skipped++;
        }
      }
    }
  }

  return { processed, skipped };
}
