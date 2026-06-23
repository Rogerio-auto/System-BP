// =============================================================================
// conversations/send.service.ts — Serviço de envio de mensagem (F16-S13).
//
// Responsabilidades:
//   - sendMessage: valida janela 24h, idempotência, persiste e enfileira.
//   - assignConversation: atribui (ou desatribui) agente + relay socket.
//   - resolveConversation: muda status para 'resolved' + relay socket.
//   - generateUploadSignedUrl: gera PUT signed-url R2 para mídia outbound.
//
// Fluxo de envio (sendMessage):
//   1. Busca conversa + canal (garante org scope e cidade).
//   2. Verifica janela 24h via getComposerState (bloqueia texto fora da janela WA).
//   3. Verifica/persiste idempotência em idempotency_keys.
//   4. Persiste mensagem com status 'pending' + publica outbound.request na mesma
//      lógica transacional (não usa db.transaction — RabbitMQ não é XA).
//   5. Publica socket relay conversation:updated.
//   6. Audit log LGPD-safe (sem content/PII) na mesma transação.
//
// LGPD (doc 17 §8.1, §8.3, §8.5):
//   - `content` (corpo da mensagem) NUNCA é logado.
//   - Outbox events e audit log sem PII bruta — apenas IDs opacos.
//   - Signed-url R2: key no padrão `outbound/{orgId}/{uuid}.{ext}` sem PII.
//   - idempotency_keys.response_body: apenas { messageId, status } — sem content.
//
// Erros:
//   - Conversa não encontrada → NotFoundError (404).
//   - Janela fechada para texto livre → WindowClosedError (422).
//   - Idempotência: mesmo Idempotency-Key → retorna resposta cacheada (200).
// =============================================================================

import crypto from 'node:crypto';
import path from 'node:path';

import { and, eq, isNull } from 'drizzle-orm';
import pino from 'pino';

import type { Database } from '../../db/client.js';
import { conversations } from '../../db/schema/conversations.js';
import { idempotencyKeys } from '../../db/schema/idempotencyKeys.js';
import type { AuditTx } from '../../lib/audit.js';
import { auditLog } from '../../lib/audit.js';
import { makeEnvelope, publish } from '../../lib/queue/index.js';
import { QUEUES } from '../../lib/queue/topology.js';
import * as storage from '../../lib/storage/index.js';
import { AppError } from '../../shared/errors.js';
import {
  findChannel,
  getComposerState,
  getConversation,
  persistOutboundMessage,
} from '../livechat/service.js';

import type {
  AssignBody,
  AssignResponse,
  ResolveResponse,
  SendMessageBody,
  SendMessageResponse,
  SignedUrlBody,
  SignedUrlResponse,
} from './send.schema.js';
import { toMessageType } from './send.schema.js';

// ---------------------------------------------------------------------------
// Logger — redact PII (doc 17 §8.3)
// ---------------------------------------------------------------------------

const log = pino({
  name: 'conversations.send.service',
  redact: {
    paths: ['content', 'caption', 'payload'],
    censor: '[redacted]',
  },
});

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/** Contexto do ator autenticado (vem de request.user via controller). */
export interface SendActorContext {
  /** UUID do usuario autenticado. null para atores de sistema (bot/worker). */
  userId: string | null;
  organizationId: string;
  role: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Erros customizados
// ---------------------------------------------------------------------------

/**
 * Janela de envio fechada para o tipo de mensagem solicitado.
 * HTTP 422 — o atendente precisa usar um template.
 *
 * LGPD: não inclui conteúdo da mensagem — apenas metadado de janela.
 */
export class WindowClosedError extends AppError {
  constructor(provider: string, windowState: string) {
    super(
      422,
      'VALIDATION_ERROR',
      `Janela de conversa fechada para o provider '${provider}'. ` +
        `Estado atual: '${windowState}'. ` +
        `Para enviar mensagens fora da janela 24h, use type='template'.`,
      {
        code: 'WINDOW_CLOSED',
        provider,
        windowState,
        cta: 'Use type=template com um template pré-aprovado na Meta.',
      },
    );
    this.name = 'WindowClosedError';
  }
}

// ---------------------------------------------------------------------------
// Idempotência — helpers
// ---------------------------------------------------------------------------

const SEND_ENDPOINT = 'POST /api/conversations/:id/messages';

/**
 * Verifica se já existe uma resposta cacheada para esta Idempotency-Key.
 * Retorna a resposta cacheada ou null.
 */
async function checkIdempotency(db: Database, key: string): Promise<SendMessageResponse | null> {
  const rows = await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1);

  if (rows.length === 0) return null;

  const cached = rows[0]!.responseBody;
  // `as` justificado: responseBody é gravado pelo próprio service com estrutura
  // SendMessageResponse — sem PII bruta (apenas messageId + status).
  return cached as SendMessageResponse;
}

/**
 * Persiste a chave de idempotência na mesma transação da mutação.
 * LGPD: armazena apenas { messageId, status } — sem content/PII.
 */
async function persistIdempotency(
  tx: Database,
  key: string,
  response: SendMessageResponse,
): Promise<void> {
  const requestHash = crypto.createHash('sha256').update(key).digest('hex');

  await tx.insert(idempotencyKeys).values({
    key,
    endpoint: SEND_ENDPOINT,
    requestHash,
    responseStatus: 202,
    // LGPD: sem content/PII — apenas IDs opacos
    responseBody: { messageId: response.messageId, status: response.status },
  });
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

/**
 * Envia uma mensagem de um atendente humano.
 *
 * Fluxo:
 * 1. Busca conversa + canal (verifica org scope e cidade).
 * 2. Valida janela 24h por provider.
 * 3. Verifica idempotência (retorna cacheado se já enviou).
 * 4. Persiste mensagem com status 'pending' via livechatService.
 * 5. Publica outbound.request no RabbitMQ com envelope tipado.
 * 6. Persiste idempotência + audit log.
 * 7. Publica socket relay conversation:updated.
 *
 * @param db           Instância do banco
 * @param actor        Contexto do ator autenticado
 * @param conversationId UUID da conversa (do path param)
 * @param body         Payload discriminado por tipo
 * @param idempotencyKey Valor do header Idempotency-Key (obrigatório)
 * @returns { messageId, status: 'queued' }
 */
export async function sendMessage(
  db: Database,
  actor: SendActorContext,
  conversationId: string,
  body: SendMessageBody,
  idempotencyKey: string,
): Promise<SendMessageResponse> {
  // LGPD: não logar content/payload
  log.debug(
    { organizationId: actor.organizationId, conversationId, type: body.type },
    'send.service: sendMessage start',
  );

  // 1. Busca conversa + canal (verifica org scope)
  const conversation = await getConversation(db, conversationId, actor.organizationId, {
    cityScopeIds: actor.cityScopeIds,
  });

  const channel = await findChannel(db, conversation.channelId, actor.organizationId);

  // 2. Valida janela 24h
  const composerState = getComposerState(conversation, channel);

  // Texto livre bloqueado fora da janela aberta (WA/IG)
  // template e interactive sempre permitidos (o worker re-confirma no S10)
  if (body.type === 'text' || body.type === 'media' || body.type === 'ig_private_reply') {
    if (composerState.window === 'closed' || composerState.window === 'template_only') {
      throw new WindowClosedError(composerState.provider, composerState.window);
    }
  }

  // 3. Idempotência — retorna cacheado se já processou esta key
  const cached = await checkIdempotency(db, idempotencyKey);
  if (cached !== null) {
    log.debug(
      { organizationId: actor.organizationId, conversationId, idempotencyKey },
      'send.service: idempotent replay',
    );
    return cached;
  }

  // 4. Persiste mensagem outbound com status 'pending'
  // persistOutboundMessage já emite evento no outbox (whatsapp.message_sent)
  const messageType = toMessageType(body);

  const message = await persistOutboundMessage(db, {
    organizationId: actor.organizationId,
    channelId: conversation.channelId,
    conversationId,
    messageType,
    // LGPD: campos PII passados com tipo explícito (não logados)
    content: body.type === 'text' || body.type === 'ig_private_reply' ? body.content : undefined,
    mediaUrl: body.type === 'media' ? body.publicMediaUrl : undefined,
    mediaMime: body.type === 'media' ? body.mime : undefined,
    interactivePayload:
      body.type === 'interactive' ? (body.payload as Record<string, unknown>) : undefined,
    replyToExternalId:
      body.type === 'text' || body.type === 'media' || body.type === 'interactive'
        ? body.replyToExternalId
        : undefined,
  });

  // 5. Monta OutboundJob tipado para a fila
  const outboundJob = buildOutboundJob(
    body,
    actor.organizationId,
    conversation.channelId,
    conversationId,
    message.id,
    conversation.contactRemoteId,
  );

  // Publica na fila outbound.request (não transacional com DB — best-effort;
  // o worker S10 é idempotente por messageId)
  await publish(
    QUEUES.outboundRequest,
    makeEnvelope(QUEUES.outboundRequest, actor.organizationId, outboundJob),
  );

  const response: SendMessageResponse = {
    messageId: message.id,
    status: 'queued',
  };

  // 6. Idempotência + audit log em transação única
  await db.transaction(async (tx) => {
    // Persiste idempotência — LGPD: sem content/PII no response_body
    await persistIdempotency(tx as unknown as Database, idempotencyKey, response);

    // Audit log LGPD-safe (doc 17 §8.5):
    // - sem content (PII)
    // - apenas IDs opacos + type
    await auditLog(tx as unknown as AuditTx, {
      organizationId: actor.organizationId,
      // Sistema/bot: userId null => actor null (auditLog aceita AuditActor=null => actorUserId nullable no DB).
      // Humano: userId real (UUID) => actor com dados completos.
      actor:
        actor.userId !== null
          ? {
              userId: actor.userId,
              role: actor.role,
              ip: actor.ip ?? null,
              userAgent: actor.userAgent ?? null,
            }
          : null,
      action: 'livechat.message_sent',
      resource: { type: 'message', id: message.id },
      // LGPD: after sem content/PII — apenas IDs e tipo
      after: {
        messageId: message.id,
        conversationId,
        channelId: conversation.channelId,
        messageType,
        // Sem content, sem mediaUrl, sem payload (todos PII ou potencialmente PII)
      },
    });
  });

  // 7. Socket relay — conversation:updated (sem PII)
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, actor.organizationId, {
      room: `workspace:${actor.organizationId}`,
      event: 'conversation:updated',
      data: {
        conversationId,
        lastMessageAt: new Date().toISOString(),
        organizationId: actor.organizationId,
      },
    }),
  );

  // 7b. Socket relay — message:new (F16-S51): sem isso, as mensagens OUTBOUND
  //     (inclusive as do agente de IA, enviadas pelo worker livechat-ai uma por
  //     mensagem do messages[]) não apareciam ao vivo no live chat — o front só
  //     refaz o fetch da conversa aberta no evento message:new (handleMessageNew),
  //     que o inbound já emite. Espelha o payload do inbound, direction='outbound',
  //     SEM content (LGPD — só IDs/tipo/timestamp; o front busca o conteúdo).
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, actor.organizationId, {
      room: `workspace:${actor.organizationId}`,
      event: 'message:new',
      data: {
        messageId: message.id,
        conversationId,
        channelId: conversation.channelId,
        organizationId: actor.organizationId,
        messageType,
        direction: 'outbound',
        hasMedia: false,
        createdAt: new Date().toISOString(),
      },
    }),
  );

  log.info(
    { organizationId: actor.organizationId, conversationId, messageId: message.id, messageType },
    'send.service: message queued',
  );

  return response;
}

// ---------------------------------------------------------------------------
// buildOutboundJob — monta OutboundJob por tipo de mensagem
// ---------------------------------------------------------------------------

/**
 * Monta o payload do OutboundJob para a fila outbound.request.
 * Inclui organizationId, channelId, conversationId, messageId, contactRemoteId.
 *
 * Nota LGPD: contactRemoteId pode ser telefone E.164 (PII indireta).
 * Está incluído porque o worker S10 PRECISA dele para enviar ao provider.
 * O payload da fila não é logado pelo relay.
 */
function buildOutboundJob(
  body: SendMessageBody,
  organizationId: string,
  channelId: string,
  conversationId: string,
  messageId: string,
  contactRemoteId: string,
): Record<string, unknown> {
  const base = {
    organizationId,
    channelId,
    conversationId,
    messageId,
    contactRemoteId,
  };

  switch (body.type) {
    case 'text':
      return {
        ...base,
        type: 'text',
        content: body.content,
        replyToExternalId: body.replyToExternalId,
      };

    case 'media':
      return {
        ...base,
        type: 'media',
        mediaKind: body.mediaKind,
        publicMediaUrl: body.publicMediaUrl,
        mime: body.mime,
        caption: body.caption,
        replyToExternalId: body.replyToExternalId,
      };

    case 'template':
      return {
        ...base,
        type: 'template',
        templateName: body.templateName,
        languageCode: body.languageCode,
        components: body.components,
      };

    case 'interactive':
      return {
        ...base,
        type: 'interactive',
        payload: body.payload,
        replyToExternalId: body.replyToExternalId,
      };

    case 'ig_private_reply':
      return {
        ...base,
        type: 'ig_private_reply',
        commentId: body.commentId,
        content: body.content,
      };
  }
}

// ---------------------------------------------------------------------------
// assignConversation
// ---------------------------------------------------------------------------

/**
 * Atribui (ou desatribui) um agente a uma conversa.
 * Publica socket relay conversation:updated após atualização.
 *
 * @param db           Instância do banco
 * @param actor        Contexto do ator autenticado
 * @param conversationId UUID da conversa
 * @param body         { agentId: string | null }
 */
export async function assignConversation(
  db: Database,
  actor: SendActorContext,
  conversationId: string,
  body: AssignBody,
): Promise<AssignResponse> {
  log.debug(
    { organizationId: actor.organizationId, conversationId, agentId: body.agentId },
    'send.service: assignConversation',
  );

  // Verifica que a conversa existe e pertence à org (com city scope)
  await getConversation(db, conversationId, actor.organizationId, {
    cityScopeIds: actor.cityScopeIds,
  });

  const updatedAt = new Date();

  // Atualiza assigned_user_id
  await db
    .update(conversations)
    .set({
      assignedUserId: body.agentId,
      updatedAt,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, actor.organizationId),
        isNull(conversations.deletedAt),
      ),
    );

  // Socket relay — conversation:updated (sem PII)
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, actor.organizationId, {
      room: `workspace:${actor.organizationId}`,
      event: 'conversation:updated',
      data: {
        conversationId,
        assignedUserId: body.agentId,
        organizationId: actor.organizationId,
      },
    }),
  );

  log.info(
    { organizationId: actor.organizationId, conversationId, agentId: body.agentId },
    'send.service: conversation assigned',
  );

  return {
    conversationId,
    assignedUserId: body.agentId,
    updatedAt: updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// resolveConversation
// ---------------------------------------------------------------------------

/**
 * Marca uma conversa como 'resolved'.
 * Publica socket relay conversation:resolved após atualização.
 *
 * @param db           Instância do banco
 * @param actor        Contexto do ator autenticado
 * @param conversationId UUID da conversa
 */
export async function resolveConversation(
  db: Database,
  actor: SendActorContext,
  conversationId: string,
): Promise<ResolveResponse> {
  log.debug(
    { organizationId: actor.organizationId, conversationId },
    'send.service: resolveConversation',
  );

  // Verifica que a conversa existe e pertence à org (com city scope)
  await getConversation(db, conversationId, actor.organizationId, {
    cityScopeIds: actor.cityScopeIds,
  });

  const updatedAt = new Date();

  await db
    .update(conversations)
    .set({
      status: 'resolved',
      updatedAt,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, actor.organizationId),
        isNull(conversations.deletedAt),
      ),
    );

  // Socket relay — conversation:resolved (sem PII)
  await publish(
    QUEUES.socketRelay,
    makeEnvelope(QUEUES.socketRelay, actor.organizationId, {
      room: `workspace:${actor.organizationId}`,
      event: 'conversation:resolved',
      data: {
        conversationId,
        status: 'resolved',
        organizationId: actor.organizationId,
        resolvedAt: updatedAt.toISOString(),
      },
    }),
  );

  log.info(
    { organizationId: actor.organizationId, conversationId },
    'send.service: conversation resolved',
  );

  return {
    conversationId,
    status: 'resolved',
    updatedAt: updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// generateUploadSignedUrl
// ---------------------------------------------------------------------------

/**
 * Gera uma URL pré-assinada para upload direto de mídia outbound.
 *
 * Key do objeto: `outbound/{organizationId}/{randomUUID}.{ext}`
 * Padrão garante:
 *   - Path contém orgId para particionamento de tenant.
 *   - Sem PII no caminho (UUID aleatório, não derivado do contato).
 *   - Extensão preservada para Content-Type correto.
 *
 * O driver ativo (R2 ou Supabase) é selecionado pela facade via STORAGE_PROVIDER.
 * O browser recebe uploadUrl e faz PUT diretamente no storage — sem passar pelo backend.
 *
 * LGPD: key não contém PII — apenas orgId (ID opaco) + UUID.
 *
 * @param actor          Contexto do ator autenticado
 * @param conversationId UUID da conversa (verificação de scope)
 * @param body           { fileName, mime, sizeBytes }
 */
export async function generateUploadSignedUrl(
  db: Database,
  actor: SendActorContext,
  conversationId: string,
  body: SignedUrlBody,
): Promise<SignedUrlResponse> {
  // Verifica que a conversa existe e pertence à org (com city scope)
  await getConversation(db, conversationId, actor.organizationId, {
    cityScopeIds: actor.cityScopeIds,
  });

  // Key LGPD-safe: sem PII no caminho
  const ext =
    path
      .extname(body.fileName)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '') || '.bin';
  const objectId = crypto.randomUUID();
  const key = `outbound/${actor.organizationId}/${objectId}${ext}`;

  // Delega ao driver ativo (R2 ou Supabase) via facade — guard de config é
  // responsabilidade do driver (lança Error com mensagem clara se não configurado).
  const { uploadUrl, publicUrl } = await storage.createSignedUploadUrl(key, body.mime);

  log.debug(
    { organizationId: actor.organizationId, conversationId, mime: body.mime },
    'send.service: signed upload URL generated',
    // LGPD: não logar key nem uploadUrl — uploadUrl contém token temporário
  );

  return { uploadUrl, publicMediaUrl: publicUrl, key };
}
