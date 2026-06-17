// =============================================================================
// workers/livechat-inbound.ts — Worker de mensagens inbound (F16-S08).
//
// Processo Node.js SEPARADO.
// Iniciado via: pnpm --filter @elemento/api worker:livechat-inbound
//
// Responsabilidade:
//   Consome a fila `hm.q.inbound.message` (declarada em F16-S01), parseia o
//   envelope e payload via Zod, e executa o pipeline de persistência:
//
//   Para InboundEvent type='message':
//     1. Busca canal (channel) para obter cityId.
//     2. ensureContactConversation → garante conversa ativa (idempotente).
//     2b. [F16-S22] linkOrCreateLeadForConversation → vincula/cria lead no primeiro inbound.
//         - Falha não quebra o pipeline: ack normal.
//     3. persistInboundMessage    → persiste mensagem (idempotente por external_id).
//        - null → duplicata; ack silencioso.
//     4. Se mediaRef → publica na fila `hm.q.inbound.media` para o media worker (S09).
//     5. Publica evento `message:new` na fila `hm.q.socket.relay` para o socket server (S14).
//     6. ack.
//
//   Para InboundEvent type='status':
//     1. updateViewStatus com externalId + status do provider.
//     2. Publica `conversation:updated` no socket relay.
//     3. ack.
//
//   Outros tipos (story_mention, story_reply, share, comment, postback, reaction, referral):
//     ack silencioso — processamento futuro (F16-S09+).
//
//   Em caso de exceção não recuperável:
//     nack com requeue=false → mensagem vai para o DLX (hm.dlx).
//
// Graceful shutdown:
//   SIGTERM/SIGINT → cancela consumer → fecha canal e conexão RabbitMQ → exit.
//
// LGPD (doc 17 §8.3, §8.5):
//   - Logs: apenas IDs opacos (conversationId, messageId, channelId) e flags.
//     NUNCA content, contactName, contactRemoteId, externalId em texto plano.
//   - Outbox events sem PII bruta (implementado em service.ts — S07).
//   - socket.relay payload: apenas IDs + tipo + timestamp (sem content).
// =============================================================================

import { InboundEventSchema } from '@elemento/shared-schemas';
import type amqplib from 'amqplib';
import { eq } from 'drizzle-orm';

import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import { messages } from '../db/schema/messages.js';
import { logger } from '../lib/logger.js';
import { envelopeSchema } from '../lib/queue/envelope.js';
import {
  closeRabbitMQ,
  connectRabbitMQ,
  getRabbitChannel,
  makeEnvelope,
  publish,
  QUEUES,
} from '../lib/queue/index.js';
import { shouldAiRespond } from '../modules/livechat/ai-gate.js';
import {
  ensureContactConversation,
  findChannel,
  linkOrCreateLeadForConversation,
  persistInboundMessage,
  updateViewStatus,
} from '../modules/livechat/service.js';

// ---------------------------------------------------------------------------
// Logger para este worker — herdado do logger canônico (redact de PII)
// ---------------------------------------------------------------------------

const log = logger.child({ worker: 'livechat-inbound' });

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/** Payload publicado na fila socket.relay para o socket server (S14). */
interface SocketRelayPayload {
  readonly room: string;
  readonly event: 'message:new' | 'conversation:updated';
  readonly data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// processMessage — pipeline de uma mensagem RabbitMQ
// ---------------------------------------------------------------------------

/**
 * Processa uma mensagem da fila `hm.q.inbound.message`.
 *
 * @param rawBody  Conteúdo bruto do buffer RabbitMQ.
 * @param db       Instância Drizzle (injetável para testes).
 * @returns        'ack' | 'nack'
 */
export async function processMessage(
  rawBody: Buffer,
  db: Database = defaultDb,
): Promise<'ack' | 'nack'> {
  // ------------------------------------------------------------------
  // 1. Parse do envelope padrão
  // ------------------------------------------------------------------
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf-8'));
  } catch (err) {
    log.error({ err }, 'livechat-inbound: JSON parse error — nack');
    return 'nack';
  }

  const envelopeResult = envelopeSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    log.error(
      { issues: envelopeResult.error.issues },
      'livechat-inbound: envelope inválido — nack',
    );
    return 'nack';
  }

  const { organizationId, payload: rawPayload } = envelopeResult.data;

  // ------------------------------------------------------------------
  // 2a. Early exit for known-unsupported event types (before strict validation)
  //     These types are intentionally ignored (future F16-S09+).
  // ------------------------------------------------------------------
  const SILENTLY_ACKED_TYPES = new Set([
    'story_mention',
    'story_reply',
    'share',
    'comment',
    'postback',
    'reaction',
    'referral',
  ]);
  const rawPayloadObj =
    typeof rawPayload === 'object' && rawPayload !== null
      ? (rawPayload as Record<string, unknown>)
      : {};
  const rawEventType = rawPayloadObj.type;
  if (typeof rawEventType === 'string' && SILENTLY_ACKED_TYPES.has(rawEventType)) {
    log.info(
      { organizationId, channelId: rawPayloadObj.channelId, eventType: rawEventType },
      'livechat-inbound: unsupported event type — ack silently',
    );
    return 'ack';
  }

  // ------------------------------------------------------------------
  // 2. Parse do payload como InboundEvent
  // ------------------------------------------------------------------
  const eventResult = InboundEventSchema.safeParse(rawPayload);
  if (!eventResult.success) {
    log.error(
      { organizationId, issues: eventResult.error.issues },
      'livechat-inbound: InboundEvent inválido — nack',
    );
    return 'nack';
  }

  const event = eventResult.data;
  const channelId = event.channelId;

  // ------------------------------------------------------------------
  // 3. Roteamento por tipo de evento
  // ------------------------------------------------------------------
  try {
    if (event.type === 'message') {
      // ----------------------------------------------------------------
      // 3a. Busca o canal para obter cityId (necessário para applyCityScope)
      // ----------------------------------------------------------------
      const channel = await findChannel(db, channelId, organizationId);

      // ----------------------------------------------------------------
      // 3b. Garante contato/conversa (idempotente)
      // ----------------------------------------------------------------
      const { conversation } = await ensureContactConversation(db, {
        organizationId,
        channelId,
        // LGPD: contactRemoteId pode ser telefone E.164 — não logar
        contactRemoteId: event.contactRemoteId,
        // Nome de exibição do contato (opcional — vem do array contacts do webhook)
        contactName: event.contactName,
        // cityId herdado do canal para applyCityScope
        cityId: channel.cityId ?? undefined,
      });

      const conversationId = conversation.id;

      // ----------------------------------------------------------------
      // 3b-F16-S22. Vincula/cria lead no primeiro inbound (dedupe-and-link)
      // Apenas para conversas novas (lead_id NULL). Falha não quebra o ack.
      // LGPD: contactRemoteId nunca logado aqui — passado opaco ao service.
      // ----------------------------------------------------------------
      if (conversation.leadId === null || conversation.leadId === undefined) {
        await linkOrCreateLeadForConversation(db, {
          conversationId,
          organizationId,
          // LGPD: contactRemoteId pode ser telefone E.164 — não logar
          contactRemoteId: event.contactRemoteId,
          contactName: event.contactName,
          cityId: channel.cityId ?? undefined,
        });
      }

      // ----------------------------------------------------------------
      // 3c. Persiste a mensagem (idempotente por (channel_id, external_id))
      // ----------------------------------------------------------------
      const message = await persistInboundMessage(db, {
        organizationId,
        channelId,
        conversationId,
        externalId: event.externalId,
        messageType: event.messageType,
        // LGPD: content é PII — não logar
        content: event.content,
        // mediaRef do InboundEventSchema (shared-schemas) já usa {refOrUrl, mimeType, sha256, fileName}
        // — mesmo shape que PersistInboundMessageInput espera. Passa direto.
        mediaRef: event.mediaRef,
        // InboundEventSchema (shared-schemas) não inclui replyTo — será adicionado em F16-S05
        metadata: event.metadata,
        rawTimestamp: event.rawTimestamp,
      });

      // null → duplicata — ack silencioso (idempotente)
      if (message === null) {
        log.debug(
          { organizationId, channelId, conversationId },
          'livechat-inbound: duplicate message — ack silently',
        );
        return 'ack';
      }

      // LGPD §8.3: log apenas com IDs opacos (sem content, sem externalId em prod)
      log.info(
        {
          organizationId,
          channelId,
          conversationId,
          messageId: message.id,
          // `message.type` é o campo correto no schema (não messageType)
          messageType: message.type,
          hasMedia: event.mediaRef !== undefined,
        },
        'livechat-inbound: message persisted',
      );

      // ----------------------------------------------------------------
      // 3d. Enfileira mídia para download assíncrono (S09)
      // ----------------------------------------------------------------
      if (event.mediaRef !== undefined) {
        await publish(
          QUEUES.inboundMedia,
          makeEnvelope(QUEUES.inboundMedia, organizationId, {
            organizationId,
            channelId,
            conversationId,
            messageId: message.id,
            mediaRef: event.mediaRef,
            provider: event.provider,
          }),
        );

        log.debug(
          { organizationId, channelId, conversationId, messageId: message.id },
          'livechat-inbound: media queued for download',
        );
      }

      // ----------------------------------------------------------------
      // 3e. Publica evento no socket relay (S14)
      // LGPD: payload sem content — apenas IDs + tipo + flag de mídia
      // ----------------------------------------------------------------
      const relayPayload: SocketRelayPayload = {
        room: conversationId,
        event: 'message:new',
        data: {
          messageId: message.id,
          conversationId,
          channelId,
          organizationId,
          // `type` é o nome do campo no schema de messages (doc 17: sem content)
          messageType: message.type,
          direction: 'inbound',
          hasMedia: event.mediaRef !== undefined,
          createdAt: message.createdAt,
        },
      };

      await publish(
        QUEUES.socketRelay,
        makeEnvelope(QUEUES.socketRelay, organizationId, relayPayload),
      );

      // ----------------------------------------------------------------
      // 3f. Gate da IA — publica em hm.q.livechat.ai se gate passar (F16-S28)
      // Falha de publish nao quebra o ack: try/catch com warning.
      // LGPD: job sem PII bruta — apenas IDs internos opacos + contactRemoteId opaco.
      // contactRemoteId e opaco (identificador do provider, sem PII legivel fora contexto).
      // ----------------------------------------------------------------
      try {
        const aiShouldRespond = await shouldAiRespond({
          db,
          organizationId,
          // LGPD: contactRemoteId nunca logado — apenas comparado com allowlist
          contactRemoteId: event.contactRemoteId,
          // `message.type` e o tipo real persistido (normalizado pelo schema)
          messageType: message.type,
        });

        if (aiShouldRespond) {
          await publish(
            QUEUES.livechatAi,
            makeEnvelope(QUEUES.livechatAi, organizationId, {
              organizationId,
              channelId,
              conversationId,
              messageId: message.id,
              // contactRemoteId opaco: nao eh CPF nem nome — e o ID do provider (ex: wamid normalizado)
              // Necessario para o worker de IA identificar a origem da resposta.
              contactRemoteId: event.contactRemoteId,
            }),
          );

          log.info(
            { organizationId, channelId, conversationId, messageId: message.id },
            'livechat-inbound: job de IA enfileirado em hm.q.livechat.ai',
          );
        }
      } catch (err) {
        // Falha de gate/publish nao quebra o ack — apenas warning
        log.warn(
          { err, organizationId, channelId, conversationId },
          'livechat-inbound: falha ao verificar gate IA ou publicar job — continuando',
        );
      }

      return 'ack';
    }

    if (event.type === 'status') {
      // ----------------------------------------------------------------
      // 3f. Atualiza view_status de mensagem outbound
      //
      // O externalId do status callback é o wamid da mensagem OUTBOUND
      // (retornado pelo provider quando a mensagem foi enviada).
      // Precisamos resolver para o internal messageId antes de chamar
      // updateViewStatus, que opera por ID interno.
      // ----------------------------------------------------------------
      const [msgRow] = await db
        .select({ id: messages.id, conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.externalId, event.externalId))
        .limit(1);

      if (msgRow === undefined) {
        // Mensagem não encontrada — pode ser status de mensagem anterior à migração
        // ou race condition. ack silencioso para não acumular no DLX.
        log.debug(
          { organizationId, channelId },
          'livechat-inbound: status update for unknown message — ack silently',
        );
        return 'ack';
      }

      await updateViewStatus(db, msgRow.id, event.status);

      // Publica conversation:updated no socket relay para atualizar o front
      // LGPD: sem externalId (wamid) no relay — apenas IDs internos opacos
      const relayPayload: SocketRelayPayload = {
        room: msgRow.conversationId,
        event: 'conversation:updated',
        data: {
          messageId: msgRow.id,
          conversationId: msgRow.conversationId,
          channelId,
          organizationId,
          viewStatus: event.status,
        },
      };

      await publish(
        QUEUES.socketRelay,
        makeEnvelope(QUEUES.socketRelay, organizationId, relayPayload),
      );

      log.debug(
        { organizationId, channelId, messageId: msgRow.id, viewStatus: event.status },
        'livechat-inbound: status update processed',
      );

      return 'ack';
    }

    // Outros tipos não mapeados acima: ack silencioso
    log.debug(
      { organizationId, channelId, eventType: event.type },
      'livechat-inbound: event type not yet handled — ack silently',
    );
    return 'ack';
  } catch (err) {
    log.error(
      { err, organizationId, channelId: event.channelId },
      'livechat-inbound: pipeline error — nack',
    );
    return 'nack';
  }
}

// ---------------------------------------------------------------------------
// startConsumer — registra consumer RabbitMQ e processa mensagens
// ---------------------------------------------------------------------------

/**
 * Inicia o consumer da fila `hm.q.inbound.message`.
 *
 * @param db  Instância Drizzle (injetável para testes).
 * @returns   consumerTag para cancelamento no shutdown.
 */
async function startConsumer(db: Database): Promise<string> {
  const ch = getRabbitChannel();

  // Prefetch 1: processa uma mensagem por vez (backpressure seguro)
  await ch.prefetch(1);

  const { consumerTag } = await ch.consume(
    QUEUES.inboundMessage,
    async (msg: amqplib.ConsumeMessage | null) => {
      if (msg === null) {
        // Consumer cancelled by broker
        log.warn('livechat-inbound: consumer cancelled by broker');
        return;
      }

      let outcome: 'ack' | 'nack' = 'nack';
      try {
        outcome = await processMessage(msg.content, db);
      } catch (err) {
        log.error({ err }, 'livechat-inbound: unhandled error — nack without requeue');
        outcome = 'nack';
      }

      try {
        if (outcome === 'ack') {
          ch.ack(msg);
        } else {
          // requeue=false → vai para o DLX (hm.dlx) configurado na topologia S01
          ch.nack(msg, false, false);
        }
      } catch (ackErr) {
        // Canal pode ter sido fechado durante shutdown — apenas loga
        log.warn({ err: ackErr }, 'livechat-inbound: ack/nack error (channel closed?)');
      }
    },
    { noAck: false },
  );

  log.info({ consumerTag, queue: QUEUES.inboundMessage }, 'livechat-inbound: consumer started');
  return consumerTag;
}

// ---------------------------------------------------------------------------
// main — entry point do processo
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info('livechat-inbound: starting worker');

  // Conecta ao RabbitMQ e declara topologia (idempotente)
  await connectRabbitMQ();

  // Inicia consumer com o db singleton do processo
  const consumerTag = await startConsumer(defaultDb);

  // ------------------------------------------------------------------
  // Graceful shutdown: SIGTERM / SIGINT
  // ------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'livechat-inbound: shutdown signal received — draining');

    try {
      // 1. Cancela o consumer (para de receber novas mensagens)
      const ch = getRabbitChannel();
      await ch.cancel(consumerTag);
      log.info({ consumerTag }, 'livechat-inbound: consumer cancelled');
    } catch (err) {
      log.warn({ err }, 'livechat-inbound: error cancelling consumer');
    }

    try {
      // 2. Fecha canal e conexão RabbitMQ
      await closeRabbitMQ();
      log.info('livechat-inbound: RabbitMQ connection closed');
    } catch (err) {
      log.warn({ err }, 'livechat-inbound: error closing RabbitMQ connection');
    }

    log.info('livechat-inbound: shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'livechat-inbound: unhandledRejection — encerrando worker');
    process.exit(1);
  });

  log.info('livechat-inbound: worker ready — waiting for messages');
}

// Executa apenas quando iniciado diretamente (não em imports de teste)
if (
  process.argv[1]?.endsWith('livechat-inbound.ts') === true ||
  process.argv[1]?.endsWith('livechat-inbound.js') === true
) {
  main().catch((err: unknown) => {
    log.fatal({ err }, 'livechat-inbound: fatal error in main');
    process.exit(1);
  });
}
