// =============================================================================
// workers/livechat-ai.ts — Worker de resposta da IA no livechat (F16-S29).
//
// Consume hm.q.livechat.ai (F16-S28), executa LangGraph e responde via sendMessage.
// NAO usa Chatwoot — resposta via pipeline do livechat nativo.
//
// LGPD: apenas IDs opacos em logs; reply.content nao logado em nivel info.
// =============================================================================
import type amqplib from 'amqplib';
import { and, eq } from 'drizzle-orm';
import { z, ZodError } from 'zod';

import { env } from '../config/env.js';
import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import { aiConversationStates, conversations, messages } from '../db/schema/index.js';
import { LangGraphClient } from '../integrations/langgraph/client.js';
import type { LangGraphClientOptions } from '../integrations/langgraph/client.js';
import type { LangGraphWhatsAppRequest } from '../integrations/langgraph/schemas.js';
import { logger } from '../lib/logger.js';
import { envelopeSchema } from '../lib/queue/envelope.js';
import { closeRabbitMQ, connectRabbitMQ, getRabbitChannel } from '../lib/queue/index.js';
import { QUEUES } from '../lib/queue/topology.js';
import { sendMessage } from '../modules/conversations/send.service.js';
import type { SendActorContext } from '../modules/conversations/send.service.js';
import { getOrCreateConversationState } from '../modules/livechat/ai-conversation-state.js';
import { triggerLivechatHandoff } from '../modules/livechat/ai-handoff.js';
import { normalizePhone } from '../shared/phone.js';

const log = logger.child({ worker: 'livechat-ai' });

// Schema do job
const LivechatAiJobSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  contactRemoteId: z.string().min(1),
});
type LivechatAiJob = z.infer<typeof LivechatAiJobSchema>;

function makeBotActor(organizationId: string): SendActorContext {
  return {
    userId: null, // sistema/bot: null para FK uuid valida no audit_logs
    organizationId,
    role: 'system',
    cityScopeIds: null,
  };
}

export async function processJob(
  rawBody: Buffer,
  db: Database = defaultDb,
  lgOptions: LangGraphClientOptions = {},
): Promise<'ack' | 'nack'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf-8'));
  } catch {
    log.error('livechat-ai: JSON parse error');
    return 'nack';
  }

  const envelopeResult = envelopeSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    log.error({ issues: envelopeResult.error.issues }, 'livechat-ai: envelope invalido — nack');
    return 'nack';
  }
  const { organizationId, payload: rawPayload } = envelopeResult.data;

  const jobResult = LivechatAiJobSchema.safeParse(rawPayload);
  if (!jobResult.success) {
    log.error(
      { organizationId, issues: jobResult.error.issues },
      'livechat-ai: job invalido — nack',
    );
    return 'nack';
  }
  const job: LivechatAiJob = jobResult.data;
  const { channelId, conversationId, messageId } = job;

  log.info(
    { organizationId, channelId, conversationId, messageId },
    'livechat-ai: processando job',
  );

  // Carrega conversa
  const [convRow] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    )
    .limit(1);
  if (convRow === undefined) {
    log.warn(
      { organizationId, conversationId, messageId },
      'livechat-ai: conversa nao encontrada — ack skip',
    );
    return 'ack';
  }

  // Carrega mensagem
  const [msgRow] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
    .limit(1);
  if (msgRow === undefined) {
    log.warn(
      { organizationId, conversationId, messageId },
      'livechat-ai: mensagem nao encontrada — ack skip',
    );
    return 'ack';
  }

  // Normaliza phone E.164 (LGPD: nao logar)
  const phoneResult = normalizePhone(job.contactRemoteId);
  const customerPhoneE164 =
    phoneResult.isValid && phoneResult.e164 !== null
      ? phoneResult.e164
      : job.contactRemoteId.startsWith('+')
        ? job.contactRemoteId
        : `+${job.contactRemoteId}`;
  const phoneNormalized = customerPhoneE164.replace(/\D/g, '');

  const convState = await getOrCreateConversationState(db, phoneNormalized, organizationId);

  // Idempotencia por messageId
  const stateSnapshot = (convState.state ?? {}) as Record<string, unknown>;
  if (stateSnapshot['last_processed_livechat_message_id'] === messageId) {
    log.info(
      { organizationId, conversationId, messageId },
      'livechat-ai: messageId ja processado — ack idempotente',
    );
    return 'ack';
  }

  // Monta request LangGraph
  const messageText = msgRow.content ?? '';
  const correlationId = `livechat_msg_${messageId}`;
  const idempotencyKey = `livechat_msg_${messageId}`;

  const langGraphRequest: LangGraphWhatsAppRequest = {
    organization_id: organizationId,
    conversation_id: convState.conversationId,
    lead_id: convRow.leadId ?? convState.leadId ?? null,
    customer_phone: customerPhoneE164,
    message_text: messageText,
    message_attachments: [],
    message_timestamp: msgRow.createdAt?.toISOString() ?? new Date().toISOString(),
    channel: 'whatsapp',
    chatwoot_conversation_id: '0',
    chatwoot_account_id: String(env.CHATWOOT_ACCOUNT_ID ?? '0'),
    metadata: {
      city_id: convRow.cityId ?? null,
      city_name: null,
      // Push name do WhatsApp (contacts[].profile.name) capturado no webhook e
      // salvo em conversations.contact_name. Vira o nome inicial do lead (em vez de
      // "Desconhecido"); a IA sobrescreve com o nome real via update_lead_profile.
      customer_name: convRow.contactName ?? null,
      previous_state_loaded:
        Object.keys(stateSnapshot).filter((k) => k !== 'last_processed_livechat_message_id')
          .length > 0,
    },
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
  };

  const langGraph = new LangGraphClient(lgOptions);
  let aiResponse: Awaited<ReturnType<typeof langGraph.processWhatsAppMessage>>;

  try {
    aiResponse = await langGraph.processWhatsAppMessage(langGraphRequest, correlationId);
  } catch (lgErr) {
    const errMsg =
      lgErr instanceof ZodError
        ? `ZodError: ${lgErr.issues.length} issue(s)`
        : lgErr instanceof Error
          ? lgErr.message.slice(0, 200)
          : String(lgErr).slice(0, 200);

    log.error(
      {
        organizationId,
        conversationId,
        messageId,
        errName: lgErr instanceof Error ? lgErr.name : 'unknown',
        errMsg,
      },
      'livechat-ai: LangGraph falhou — handoff',
    );
    await triggerLivechatHandoff(db, {
      organizationId,
      conversationId,
      messageId,
      reason: 'ai_unavailable',
    });
    await db
      .update(aiConversationStates)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(aiConversationStates.conversationId, convState.conversationId));
    return 'ack';
  }

  log.info(
    {
      organizationId,
      conversationId,
      messageId,
      graphVersion: aiResponse.graph_version,
      latencyMs: aiResponse.latency_ms,
      replyType: aiResponse.reply.type,
      handoffRequired: aiResponse.handoff.required,
    },
    'livechat-ai: LangGraph respondeu',
  );

  // Envia reply(s) pelo livechat via sendMessage.
  // F16-S44: pipeline agentica retorna messages[] — iterar e enviar cada mensagem na ordem,
  // com idempotency key unica por indice para garantir deduplicacao individual.
  // Retrocompat: quando messages vazio, usa reply.content (funil antigo / flag OFF).
  // LGPD: nao logar conteudo de mensagens — apenas IDs e contadores.
  const botActor: SendActorContext = makeBotActor(organizationId);

  if (aiResponse.messages.length > 0) {
    // Pipeline agentica: N mensagens curtas em sequencia.
    // .entries() dá [indice, conteudo] com conteudo tipado como string
    // (evita string|undefined do noUncheckedIndexedAccess no acesso por indice).
    for (const [i, msgContent] of aiResponse.messages.entries()) {
      // Idempotency key unica por indice: evita deduplicacao entre mensagens distintas
      const idempKey = `ai_reply_${messageId}_${i}`;
      try {
        await sendMessage(
          db,
          botActor,
          conversationId,
          { type: 'text', content: msgContent },
          idempKey,
        );
      } catch (sendErr) {
        log.error(
          { organizationId, conversationId, messageId, msgIndex: i, err: sendErr },
          'livechat-ai: falha ao enviar mensagem agentica — nack para DLX',
        );
        throw sendErr;
      }
    }
    log.info(
      { organizationId, conversationId, messageId, msgCount: aiResponse.messages.length },
      'livechat-ai: messages[] enviadas via sendMessage (pipeline agentica)',
    );
  } else {
    // Funil antigo / flag OFF: usa reply.content como unica mensagem
    const canSendReply =
      aiResponse.reply.type !== 'none' && aiResponse.reply.content.trim().length > 0;

    if (canSendReply) {
      const idempKey = `ai_reply_${messageId}`;
      try {
        await sendMessage(
          db,
          botActor,
          conversationId,
          { type: 'text', content: aiResponse.reply.content },
          idempKey,
        );
        log.info(
          { organizationId, conversationId, messageId, replyType: aiResponse.reply.type },
          'livechat-ai: reply enviada via sendMessage (funil legado)',
        );
      } catch (sendErr) {
        log.error(
          { organizationId, conversationId, messageId, err: sendErr },
          'livechat-ai: falha ao enviar reply — nack para DLX',
        );
        throw sendErr;
      }
    } else {
      log.info(
        { organizationId, conversationId, messageId, replyType: aiResponse.reply.type },
        'livechat-ai: reply nao enviada (type=none ou conteudo vazio)',
      );
    }
  }

  if (aiResponse.handoff.required) {
    log.info(
      { organizationId, conversationId, messageId, reason: aiResponse.handoff.reason },
      'livechat-ai: handoff sinalizado pelo LangGraph',
    );
    await triggerLivechatHandoff(db, {
      organizationId,
      conversationId,
      messageId,
      reason: aiResponse.handoff.reason ?? 'ai_requested',
    });
  }

  // Atualiza ai_conversation_states
  const updatedLeadId = aiResponse.lead_id ?? convRow.leadId ?? convState.leadId;
  const updatedState: Record<string, unknown> = {
    ...(typeof convState.state === 'object' && convState.state !== null
      ? (convState.state as Record<string, unknown>)
      : {}),
    last_processed_livechat_message_id: messageId,
  };

  await db
    .update(aiConversationStates)
    .set({
      leadId: updatedLeadId ?? null,
      currentNode: aiResponse.state.current_stage ?? convState.currentNode,
      graphVersion: aiResponse.graph_version,
      lastMessageAt: new Date(),
      state: updatedState,
      updatedAt: new Date(),
    })
    .where(eq(aiConversationStates.conversationId, convState.conversationId));

  log.info({ organizationId, conversationId, messageId }, 'livechat-ai: processamento concluido');
  return 'ack';
}

async function startConsumer(
  db: Database,
  lgOptions: LangGraphClientOptions = {},
): Promise<string> {
  const ch = getRabbitChannel();
  await ch.prefetch(1);

  const { consumerTag } = await ch.consume(
    QUEUES.livechatAi,
    async (msg: amqplib.ConsumeMessage | null) => {
      if (msg === null) {
        log.warn('livechat-ai: consumer cancelled by broker');
        return;
      }
      let outcome: 'ack' | 'nack' = 'nack';
      try {
        outcome = await processJob(msg.content, db, lgOptions);
      } catch (err) {
        log.error({ err }, 'livechat-ai: unhandled error — nack without requeue');
        outcome = 'nack';
      }
      try {
        if (outcome === 'ack') {
          ch.ack(msg);
        } else {
          ch.nack(msg, false, false);
        }
      } catch (ackErr) {
        log.warn({ err: ackErr }, 'livechat-ai: ack/nack error (channel closed?)');
      }
    },
    { noAck: false },
  );

  log.info({ consumerTag, queue: QUEUES.livechatAi }, 'livechat-ai: consumer started');
  return consumerTag;
}

async function main(): Promise<void> {
  log.info('livechat-ai: starting worker');
  await connectRabbitMQ();
  // F16-S49: timeout configurável p/ o LangGraph. O turno agêntico é mais lento
  // que o funil; 8s (default do client) causava fallback de handoff indevido.
  const consumerTag = await startConsumer(defaultDb, {
    timeoutMs: env.LANGGRAPH_AI_TIMEOUT_MS,
  });

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'livechat-ai: shutdown signal received — draining');
    try {
      const ch = getRabbitChannel();
      await ch.cancel(consumerTag);
    } catch (err) {
      log.warn({ err }, 'livechat-ai: error cancelling consumer');
    }
    try {
      await closeRabbitMQ();
    } catch (err) {
      log.warn({ err }, 'livechat-ai: error closing RabbitMQ');
    }
    log.info('livechat-ai: shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'livechat-ai: unhandledRejection — encerrando worker');
    process.exit(1);
  });
  log.info('livechat-ai: worker ready — waiting for messages');
}

if (
  process.argv[1]?.endsWith('livechat-ai.ts') === true ||
  process.argv[1]?.endsWith('livechat-ai.js') === true
) {
  main().catch((err: unknown) => {
    log.fatal({ err }, 'livechat-ai: fatal error in main');
    process.exit(1);
  });
}
