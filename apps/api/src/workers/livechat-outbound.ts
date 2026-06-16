// =============================================================================
// workers/livechat-outbound.ts — Worker de mensagens outbound (F16-S10).
//
// Processo Node.js SEPARADO.
// Iniciado via: pnpm --filter @elemento/api worker:livechat-outbound
//
// Responsabilidade:
//   Consome a fila `hm.q.outbound.request`, executa o pipeline de envio:
//
//   1. Parse do envelope (`envelopeSchema`) + payload (`OutboundJobSchema`).
//   2. Adquire lock FIFO por conversa (`hm:lock:outbound:{conversationId}`)
//      para garantir ordem de entrega sem race condition.
//   3. Busca o canal via `findChannel` (service S07) e os segredos via DB.
//   4. Verifica janela de composição via `getComposerState` (S07):
//        - `open`          → qualquer tipo de mensagem permitido.
//        - `template_only` → apenas `type='template'`; demais: marcar `failed`, ack.
//        - `closed`        → não enviar; marcar `failed`, ack.
//   5. Decifra `access_token_enc` via `decryptPii` e cria `GraphClient`.
//   6. Decifra `contact_phone_enc` da conversa (quando disponível).
//   7. Serializa o job via `serializeOutboundJob` (S05).
//   8. Envia via `GraphClient.post('/{phoneNumberId}/messages', payload)` (S04).
//   9. Persiste com `updateViewStatus(messageId, 'sent', externalId)` (S07).
//  10. Publica `message:new` (socket.relay) para o agente ver no frontend.
//  11. ack após sucesso.
//
// Retry / nack:
//   - `ProviderError.isRetryable = true` → nack(requeue=true) (max 3 requeue; DLX cuida do resto).
//   - `ProviderError.isRetryable = false` → nack(requeue=false) → DLX.
//   - `DistributedLockError`               → nack(requeue=true) — lock temporariamente ocupado.
//   - Payload inválido / erro de parse     → nack(requeue=false) — mensagem descartada.
//
// Graceful shutdown:
//   SIGTERM/SIGINT → cancela consumer → fecha canal RabbitMQ → fecha Redis → exit 0.
//
// LGPD (doc 17 §8.3, §8.5):
//   - Logs: apenas IDs opacos (conversationId, messageId, channelId) e enums.
//     NUNCA content, contactName, contactRemoteId, access_token em logs.
//   - access_token_enc decifrado só em memória e descartado após uso.
//   - contact_phone_enc decifrado só em memória para o envio — não logado.
//   - socket.relay payload: apenas IDs + tipo + timestamp (sem content).
// =============================================================================

import { OutboundJobSchema } from '@elemento/shared-schemas';
import type { OutboundJob } from '@elemento/shared-schemas';
import type amqplib from 'amqplib';
import { eq } from 'drizzle-orm';

import { db as defaultDb } from '../db/client.js';
import type { Database } from '../db/client.js';
import type { Channel } from '../db/schema/channels.js';
import { channelSecrets } from '../db/schema/channelSecrets.js';
import { conversations } from '../db/schema/conversations.js';
import { serializeOutboundJob } from '../integrations/channels/meta/whatsapp/serializer.js';
import { ProviderError } from '../integrations/channels/shared/errors.js';
import { createGraphClient } from '../integrations/channels/shared/graphClient.js';
import { decryptPii } from '../lib/crypto/pii.js';
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
import {
  connectRedis,
  closeRedis,
  runWithDistributedLock,
  DistributedLockError,
} from '../lib/redis/index.js';
import { findChannel, getComposerState, updateViewStatus } from '../modules/livechat/service.js';

// ---------------------------------------------------------------------------
// Logger — herdado do logger canônico com redact de PII
// ---------------------------------------------------------------------------

const log = logger.child({ worker: 'livechat-outbound' });

// ---------------------------------------------------------------------------
// Constantes de lock FIFO
// ---------------------------------------------------------------------------

/** Prefixo da chave de lock por conversa. */
const LOCK_KEY_PREFIX = 'hm:lock:outbound';

/** TTL do lock FIFO (ms). Uma mensagem deve ser enviada em menos de 30s. */
const LOCK_TTL_MS = 30_000;

/** Tempo máximo esperando pelo lock antes de nack+requeue. */
const LOCK_MAX_WAIT_MS = 5_000;

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/** Payload publicado na fila socket.relay para o socket server (S14). */
interface SocketRelayPayload {
  readonly room: string;
  readonly event: 'message:new' | 'message:status_changed';
  readonly data: Record<string, unknown>;
}

/** Resultado de processOutbound — ação que o consumer deve executar. */
type ProcessResult = { action: 'ack' } | { action: 'nack'; requeue: boolean };

// ---------------------------------------------------------------------------
// processOutboundJob — pipeline de um job de envio
// ---------------------------------------------------------------------------

/**
 * Processa um job da fila `hm.q.outbound.request`.
 *
 * Retorna 'ack' se o job foi processado (com sucesso ou falha definitiva).
 * Retorna 'nack' com requeue=true/false dependendo do tipo de erro.
 *
 * @param rawBody  Buffer raw do RabbitMQ.
 * @param db       Instância Drizzle (injetável para testes).
 * @returns        Resultado da ação: ack ou nack com requeue.
 */
export async function processOutboundJob(
  rawBody: Buffer,
  db: Database = defaultDb,
): Promise<ProcessResult> {
  // ------------------------------------------------------------------
  // 1. Parse JSON
  // ------------------------------------------------------------------
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf-8'));
  } catch (err) {
    log.error({ err }, 'livechat-outbound: JSON parse error — nack sem requeue');
    return { action: 'nack', requeue: false };
  }

  // ------------------------------------------------------------------
  // 2. Parse do envelope
  // ------------------------------------------------------------------
  const envelopeResult = envelopeSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    log.error(
      { issues: envelopeResult.error.issues },
      'livechat-outbound: envelope inválido — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  const { organizationId, payload: rawPayload } = envelopeResult.data;

  // ------------------------------------------------------------------
  // 3. Parse do payload como OutboundJob
  // ------------------------------------------------------------------
  const jobResult = OutboundJobSchema.safeParse(rawPayload);
  if (!jobResult.success) {
    log.error(
      { organizationId, issues: jobResult.error.issues },
      'livechat-outbound: OutboundJob inválido — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  const job = jobResult.data;

  // typing_indicator não requer envio real — ack silencioso
  if (job.type === 'typing_indicator') {
    log.debug(
      { organizationId, channelId: job.channelId, conversationId: job.conversationId },
      'livechat-outbound: typing_indicator — ack silencioso (sem envio)',
    );
    return { action: 'ack' };
  }

  // ig_private_reply / ig_public_reply: suporte futuro (IG adapter não implementado)
  if (job.type === 'ig_private_reply' || job.type === 'ig_public_reply') {
    log.warn(
      { organizationId, channelId: job.channelId, jobType: job.type },
      'livechat-outbound: tipo IG não suportado ainda — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  // A partir daqui, job tem conversationId e messageId (tipos com envio real).
  // TypeScript narrowing: todos os tipos restantes têm conversationId e messageId.
  const { channelId, conversationId, messageId } = job;

  // ------------------------------------------------------------------
  // 4. Lock FIFO por conversa — garante ordem entre mensagens concorrentes
  // ------------------------------------------------------------------
  try {
    return await runWithDistributedLock(
      `${LOCK_KEY_PREFIX}:${conversationId}`,
      LOCK_TTL_MS,
      async () => sendWithinLock(db, organizationId, channelId, conversationId, messageId, job),
      { maxWaitMs: LOCK_MAX_WAIT_MS },
    );
  } catch (err) {
    if (err instanceof DistributedLockError) {
      // Lock temporariamente ocupado — requeue para tentar novamente
      log.warn(
        { organizationId, channelId, conversationId, messageId },
        'livechat-outbound: lock FIFO ocupado — nack com requeue',
      );
      return { action: 'nack', requeue: true };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// sendWithinLock — pipeline de envio dentro do lock FIFO
// ---------------------------------------------------------------------------

/**
 * Executa o pipeline de envio enquanto o lock FIFO está ativo.
 * Separado para clareza e testabilidade.
 */
async function sendWithinLock(
  db: Database,
  organizationId: string,
  channelId: string,
  conversationId: string,
  messageId: string,
  job: Exclude<
    OutboundJob,
    { type: 'typing_indicator' } | { type: 'ig_private_reply' } | { type: 'ig_public_reply' }
  >,
): Promise<ProcessResult> {
  // ------------------------------------------------------------------
  // 5. Busca canal e conversa para validação de janela
  // ------------------------------------------------------------------
  const channel = await findChannel(db, channelId, organizationId);

  // Busca conversa para getComposerState (precisa de lastInboundAt)
  const [convRow] = await db
    .select({
      id: conversations.id,
      lastInboundAt: conversations.lastInboundAt,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (convRow === undefined) {
    log.error(
      { organizationId, channelId, conversationId, messageId },
      'livechat-outbound: conversa não encontrada — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  // ------------------------------------------------------------------
  // 6. Verificação de janela (defesa em profundidade — LGPD + Meta Policy)
  // ------------------------------------------------------------------
  const composerState = getComposerState(convRow, channel);

  if (composerState.window === 'closed') {
    // Janela fechada: não enviar — marcar como failed e ack
    log.warn(
      {
        organizationId,
        channelId,
        conversationId,
        messageId,
        // LGPD: não logar jobType se contiver PII; type é enum seguro
        jobType: job.type,
      },
      'livechat-outbound: janela fechada — mensagem marcada como failed (ack)',
    );

    await updateViewStatus(db, messageId, 'failed');
    await publishSocketStatusChanged(
      organizationId,
      conversationId,
      channelId,
      messageId,
      'failed',
    );
    return { action: 'ack' };
  }

  if (composerState.window === 'template_only' && job.type !== 'template') {
    // Janela template_only: apenas templates são permitidos
    log.warn(
      {
        organizationId,
        channelId,
        conversationId,
        messageId,
        jobType: job.type,
      },
      'livechat-outbound: janela template_only — tipo rejeitado, mensagem marcada como failed (ack)',
    );

    await updateViewStatus(db, messageId, 'failed');
    await publishSocketStatusChanged(
      organizationId,
      conversationId,
      channelId,
      messageId,
      'failed',
    );
    return { action: 'ack' };
  }

  // human_agent_tag: meta_instagram entre 24h–7d — por ora aceitamos todos os tipos
  // (suporte específico ao tag virá em slot dedicado de IG)

  // ------------------------------------------------------------------
  // 7. Busca segredos do canal e decifra access_token
  // ------------------------------------------------------------------
  const [secretRow] = await db
    .select({
      accessTokenEnc: channelSecrets.accessTokenEnc,
    })
    .from(channelSecrets)
    .where(eq(channelSecrets.channelId, channelId))
    .limit(1);

  if (secretRow === undefined || secretRow.accessTokenEnc === null) {
    log.error(
      { organizationId, channelId, conversationId, messageId },
      'livechat-outbound: segredos do canal ausentes — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  // LGPD: decifra em memória — NUNCA logar o token
  const accessToken = await decryptPii(secretRow.accessTokenEnc);

  // ------------------------------------------------------------------
  // 8. Cria GraphClient com token decifrado
  // ------------------------------------------------------------------
  const client = createGraphClient({
    accessToken,
    // Timeout menor que TTL do lock para garantir que encerramos antes
    defaultTimeoutMs: 20_000,
  });

  // ------------------------------------------------------------------
  // 9. Obtém phoneNumberId para roteamento da chamada à Meta API
  // ------------------------------------------------------------------
  const phoneNumberId = resolvePhoneNumberId(channel);
  if (phoneNumberId === null) {
    log.error(
      { organizationId, channelId, conversationId, messageId, provider: channel.provider },
      'livechat-outbound: phoneNumberId ausente no canal — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  // ------------------------------------------------------------------
  // 10. Serializa o payload via serializer Meta (S05)
  // ------------------------------------------------------------------
  let metaPayload: ReturnType<typeof serializeOutboundJob>;
  try {
    metaPayload = serializeOutboundJob(job);
  } catch (err) {
    log.error(
      { organizationId, channelId, conversationId, messageId, err },
      'livechat-outbound: falha na serialização do job — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  // ------------------------------------------------------------------
  // 11. Envia via Meta Graph API
  // ------------------------------------------------------------------
  let externalId: string;
  try {
    // `as` justificado: MetaOutboundPayload satisfaz Readonly<Record<string, unknown>>.
    const response = await client.post<{ messages: ReadonlyArray<{ id: string }> }>(
      `/${phoneNumberId}/messages`,
      metaPayload as Readonly<Record<string, unknown>>,
    );

    const msgId = response.messages[0]?.id;
    if (msgId === undefined || msgId === '') {
      // Resposta 2xx mas sem messages[0].id — tratar como erro não-retentável
      log.error(
        { organizationId, channelId, conversationId, messageId },
        'livechat-outbound: Meta API retornou sem messages[0].id — nack sem requeue',
      );
      await updateViewStatus(db, messageId, 'failed');
      await publishSocketStatusChanged(
        organizationId,
        conversationId,
        channelId,
        messageId,
        'failed',
      );
      return { action: 'nack', requeue: false };
    }

    externalId = msgId;
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.isRetryable) {
        // Erro retentável (429, 5xx, timeout) — requeue para retry
        log.warn(
          {
            organizationId,
            channelId,
            conversationId,
            messageId,
            upstreamStatus: err.upstreamStatus,
            providerCode: err.providerCode,
          },
          'livechat-outbound: ProviderError retentável — nack com requeue',
        );
        return { action: 'nack', requeue: true };
      }

      // Erro terminal (4xx, opt-out, etc.) — marcar failed e ack
      log.error(
        {
          organizationId,
          channelId,
          conversationId,
          messageId,
          upstreamStatus: err.upstreamStatus,
          providerCode: err.providerCode,
        },
        'livechat-outbound: ProviderError terminal — mensagem marcada como failed (ack)',
      );
      await updateViewStatus(db, messageId, 'failed');
      await publishSocketStatusChanged(
        organizationId,
        conversationId,
        channelId,
        messageId,
        'failed',
      );
      return { action: 'ack' };
    }

    // Erro desconhecido — nack sem requeue (provavelmente bug no código)
    log.error(
      { organizationId, channelId, conversationId, messageId, err },
      'livechat-outbound: erro desconhecido no envio — nack sem requeue',
    );
    return { action: 'nack', requeue: false };
  }

  // ------------------------------------------------------------------
  // 12. Persiste externalId e atualiza view_status para 'sent'
  // ------------------------------------------------------------------
  await updateViewStatus(db, messageId, 'sent', externalId);

  log.info(
    {
      organizationId,
      channelId,
      conversationId,
      messageId,
      // LGPD: externalId (wamid) não é PII — é ID técnico opaco do provider
      externalId,
      jobType: job.type,
    },
    'livechat-outbound: mensagem enviada com sucesso',
  );

  // ------------------------------------------------------------------
  // 13. Publica message:new no socket relay para o agente ver no frontend
  // LGPD: payload sem content — apenas IDs + tipo + timestamp
  // ------------------------------------------------------------------
  const relayPayload: SocketRelayPayload = {
    room: conversationId,
    event: 'message:new',
    data: {
      messageId,
      conversationId,
      channelId,
      organizationId,
      jobType: job.type,
      direction: 'outbound',
      externalId,
      viewStatus: 'sent',
      sentAt: new Date().toISOString(),
    },
  };

  await publish(QUEUES.socketRelay, makeEnvelope(QUEUES.socketRelay, organizationId, relayPayload));

  return { action: 'ack' };
}

// ---------------------------------------------------------------------------
// Helpers privados
// ---------------------------------------------------------------------------

/**
 * Publica evento `message:status_changed` no socket relay.
 * LGPD: sem content, sem contactRemoteId — apenas IDs opacos e status.
 */
async function publishSocketStatusChanged(
  organizationId: string,
  conversationId: string,
  channelId: string,
  messageId: string,
  viewStatus: 'failed' | 'sent' | 'delivered' | 'read',
): Promise<void> {
  const relayPayload: SocketRelayPayload = {
    room: conversationId,
    event: 'message:status_changed',
    data: {
      messageId,
      conversationId,
      channelId,
      organizationId,
      viewStatus,
    },
  };

  await publish(QUEUES.socketRelay, makeEnvelope(QUEUES.socketRelay, organizationId, relayPayload));
}

/**
 * Resolve o phoneNumberId/resourceId do canal para o roteamento da Meta API.
 * Retorna null se o canal não tiver o campo obrigatório configurado.
 */
function resolvePhoneNumberId(channel: Channel): string | null {
  if (channel.provider === 'meta_whatsapp') {
    return channel.phoneNumberId ?? null;
  }
  if (channel.provider === 'meta_instagram') {
    return channel.igUserId ?? null;
  }
  // WAHA: não usa o GraphClient da Meta — provider incompatível aqui
  return null;
}

// ---------------------------------------------------------------------------
// startConsumer — registra consumer RabbitMQ
// ---------------------------------------------------------------------------

/**
 * Inicia o consumer da fila `hm.q.outbound.request`.
 *
 * @param db  Instância Drizzle (injetável para testes).
 * @returns   consumerTag para cancelamento no shutdown.
 */
async function startConsumer(db: Database): Promise<string> {
  const ch = getRabbitChannel();

  // Prefetch 1: processa uma mensagem por vez (FIFO + backpressure seguro)
  await ch.prefetch(1);

  const { consumerTag } = await ch.consume(
    QUEUES.outboundRequest,
    async (msg: amqplib.ConsumeMessage | null) => {
      if (msg === null) {
        log.warn('livechat-outbound: consumer cancelled by broker');
        return;
      }

      let result: ProcessResult = { action: 'nack', requeue: false };
      try {
        result = await processOutboundJob(msg.content, db);
      } catch (err) {
        log.error({ err }, 'livechat-outbound: unhandled error — nack sem requeue');
        result = { action: 'nack', requeue: false };
      }

      try {
        if (result.action === 'ack') {
          ch.ack(msg);
        } else {
          // requeue=true: volta para a fila; requeue=false: vai para DLX (hm.dlx)
          ch.nack(msg, false, result.requeue);
        }
      } catch (ackErr) {
        log.warn({ err: ackErr }, 'livechat-outbound: ack/nack error (canal fechado?)');
      }
    },
    { noAck: false },
  );

  log.info({ consumerTag, queue: QUEUES.outboundRequest }, 'livechat-outbound: consumer iniciado');
  return consumerTag;
}

// ---------------------------------------------------------------------------
// main — entry point do processo
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log.info('livechat-outbound: iniciando worker');

  // 1. Conecta Redis (para lock FIFO)
  connectRedis();

  // 2. Conecta RabbitMQ e declara topologia (idempotente)
  await connectRabbitMQ();

  // 3. Inicia consumer
  const consumerTag = await startConsumer(defaultDb);

  // ------------------------------------------------------------------
  // Graceful shutdown: SIGTERM / SIGINT
  // ------------------------------------------------------------------
  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'livechat-outbound: sinal de shutdown recebido — drenando fila');

    try {
      const ch = getRabbitChannel();
      await ch.cancel(consumerTag);
      log.info({ consumerTag }, 'livechat-outbound: consumer cancelado');
    } catch (err) {
      log.warn({ err }, 'livechat-outbound: erro ao cancelar consumer');
    }

    try {
      await closeRabbitMQ();
      log.info('livechat-outbound: conexão RabbitMQ fechada');
    } catch (err) {
      log.warn({ err }, 'livechat-outbound: erro ao fechar RabbitMQ');
    }

    try {
      await closeRedis();
      log.info('livechat-outbound: conexão Redis fechada');
    } catch (err) {
      log.warn({ err }, 'livechat-outbound: erro ao fechar Redis');
    }

    log.info('livechat-outbound: shutdown completo');
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.fatal({ err: reason }, 'livechat-outbound: unhandledRejection — encerrando worker');
    process.exit(1);
  });

  log.info('livechat-outbound: worker pronto — aguardando mensagens');
}

// Executa apenas quando iniciado diretamente (não em imports de teste)
if (
  process.argv[1]?.endsWith('livechat-outbound.ts') === true ||
  process.argv[1]?.endsWith('livechat-outbound.js') === true
) {
  main().catch((err: unknown) => {
    log.fatal({ err }, 'livechat-outbound: erro fatal no main');
    process.exit(1);
  });
}
