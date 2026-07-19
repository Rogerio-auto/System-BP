// =============================================================================
// meta-webhook/service.ts — Despacho por provider e publicação no RabbitMQ.
//
// Responsabilidades:
//   1. Para cada entry no envelope Meta, identificar o provider e o canal.
//   2. Verificar dedup por (provider, eventId) via dedup.ts.
//   3. Registrar em webhook_events (inclui rawPayload LGPD-retido).
//   4. Publicar envelope na exchange `hm.channels` com routing key
//      `hm.q.inbound.message` (worker S08 consome e parseia via adapter S05).
//   5. Registrar em audit_logs (action: webhook.received) dentro da mesma tx.
//
// Routing key:
//   `hm.q.inbound.message` — binding no topology.ts é `hm.q.inbound.message.#`
//   Esta key cai na fila `hm.q.inbound.message` (worker inbound S08).
//
// Envelope payload:
//   { provider, channelId, entryId, rawPayload }
//   O worker S08 usa channelId para buscar as credenciais e chamar o adapter.
//
// LGPD (doc 17 §8.3):
//   - Não logar rawPayload (pode conter número de telefone, texto de mensagem).
//   - Logar apenas: provider, entryId (WABA/Page ID), channelId (UUID técnico).
//   - audit_logs.after = null (rawPayload não vai para auditoria).
// =============================================================================
import { randomUUID } from 'node:crypto';

import { db } from '../../db/client.js';
import { parseMetaWebhookEnvelope } from '../../integrations/channels/meta/whatsapp/webhook.parser.js';
import { auditLog } from '../../lib/audit.js';
import { logger } from '../../lib/logger.js';
import { makeEnvelope, publish } from '../../lib/queue/index.js';
import { QUEUES } from '../../lib/queue/topology.js';

import { isDuplicate, recordEvent } from './dedup.js';
import type { MetaWebhookBody } from './schemas.js';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/** Resultado do processamento de um evento. */
export interface DispatchResult {
  /** Número de eventos publicados com sucesso. */
  published: number;
  /** Número de eventos ignorados por dedup. */
  skipped: number;
}

/** Contexto do canal resolvido antes de chamar dispatchWebhook. */
export interface ResolvedChannel {
  /** UUID do canal em `channels`. */
  channelId: string;
  /** UUID da organização dona do canal (para audit + envelope). */
  organizationId: string;
  /** UUID da cidade do canal (pode ser null). */
  cityId: string | null;
  /** Provider canônico (meta_whatsapp | meta_instagram). */
  provider: 'meta_whatsapp' | 'meta_instagram';
}

// ---------------------------------------------------------------------------
// dispatchWebhook — processa um entry do envelope Meta
// ---------------------------------------------------------------------------

/**
 * Processa um único `entry` do envelope Meta:
 *   1. Dedup por (provider, entryId).
 *   2. Insere em webhook_events.
 *   3. Publica na fila inbound.
 *   4. Registra em audit_logs.
 *
 * @param body     Payload completo do webhook (após parse Zod).
 * @param channel  Canal resolvido (channelId, organizationId, provider).
 * @param entryId  ID da entry (WABA ID ou FB Page ID) — chave de dedup.
 * @param rawEntry Objeto entry bruto para salvar em rawPayload.
 * @returns        { published, skipped }.
 */
export async function dispatchWebhook(
  body: MetaWebhookBody,
  channel: ResolvedChannel,
  entryId: string,
  rawEntry: unknown,
): Promise<DispatchResult> {
  // eventId é o entryId — a Meta não fornece um UUID global por entry.
  // Usamos entryId como eventId de dedup: a Meta reenvia todos os entries
  // juntos, então entryId (WABA/Page ID) + timestamp do 1º change identifica a entrega.
  // Para granularidade de dedup por change, o worker S08 tem sua própria lógica.
  // Aqui queremos apenas impedir dupla publicação da entrega do webhook inteiro.
  const eventId = `${entryId}:${Date.now()}`;

  // Determinar tipo de evento para classificação em webhook_events
  const eventType = body.object === 'whatsapp_business_account' ? 'inbound_wa' : 'inbound_ig';

  // Verificar dedup
  const duplicate = await isDuplicate(db, channel.provider, eventId);
  if (duplicate) {
    return { published: 0, skipped: 1 };
  }

  // Registrar em webhook_events ANTES de publicar
  // Se a publicação falhar, Meta faz retry — no retry, isDuplicate = true → skip.
  await recordEvent(db, {
    provider: channel.provider,
    eventId,
    eventType,
    rawPayload: rawEntry,
    organizationId: channel.organizationId,
  });

  // Parsear o entry Meta em InboundEvents (mensagens + status) e publicar cada um
  // O worker S08 espera InboundEvent diretamente no envelope.payload
  let eventsPublished = 0;
  try {
    const events = parseMetaWebhookEnvelope(
      { object: body.object, entry: [rawEntry] },
      {
        organizationId: channel.organizationId,
        channelId: channel.channelId,
        provider: channel.provider,
      },
    );
    for (const event of events) {
      const envelope = makeEnvelope(QUEUES.inboundMessage, channel.organizationId, event);
      await publish(QUEUES.inboundMessage, envelope);
      eventsPublished++;
    }
  } catch (err) {
    // Entry com estrutura inesperada — já registrado em webhook_events para replay.
    // LGPD: não logar rawEntry.
    logger.warn(
      { err, channelId: channel.channelId, entryId, provider: channel.provider },
      'meta-webhook: falha ao parsear entry — eventos não publicados',
    );
  }

  // Auditoria: webhook recebido — sem PII, apenas IDs técnicos
  await db.transaction(async (tx) => {
    await auditLog(tx, {
      organizationId: channel.organizationId,
      actor: null, // sistema — sem usuário autenticado
      action: 'webhook.received',
      resource: { type: 'webhook_event', id: randomUUID() },
      after: {
        provider: channel.provider,
        channelId: channel.channelId,
        entryId,
        eventType,
        // LGPD: rawPayload nunca entra no audit log
      },
      correlationId: null,
    });
  });

  return { published: eventsPublished, skipped: 0 };
}
