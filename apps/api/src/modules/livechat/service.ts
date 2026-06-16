// =============================================================================
// livechat/service.ts — Orquestração do domínio live chat (F16-S07).
//
// Responsabilidades:
//   - ensureContactConversation: garante contato/conversa no DB.
//   - persistInboundMessage: idempotente por (channel_id, external_id).
//   - persistOutboundMessage: cria mensagem outbound com status pending.
//   - updateViewStatus: atualiza status de entrega de mensagem outbound.
//   - getConversation / listConversations: leitura com escopo de cidade.
//   - getMessages: paginação por cursor.
//   - getComposerState: janela 24h por provider (WA/IG/WAHA).
//
// Multi-tenant:
//   - Todos os métodos recebem organizationId explicitamente (F17 injetará).
//
// LGPD (doc 17 §8.1, §8.5):
//   - contact_phone_enc: bytea cifrado — decifrado APENAS quando necessário
//     para envio outbound (nunca na listagem/leitura de conversas).
//   - Logs sem content (texto da mensagem) e sem contactName em texto plano.
//   - Outbox events sem PII bruta (apenas IDs opacos).
//   - Bridge interactions: content estruturado sem PII (§8.5).
//
// Outbox (regra inviolável nº7):
//   - Eventos emitidos na mesma transação da mutação de domínio.
//   - NÃO emitir eventos em chamadas de leitura.
// =============================================================================

import { eq } from 'drizzle-orm';
import pino from 'pino';

import type { Database } from '../../db/client.js';
import type { Channel } from '../../db/schema/channels.js';
import { conversations } from '../../db/schema/conversations.js';
import type { Conversation } from '../../db/schema/conversations.js';
import type { Message } from '../../db/schema/messages.js';
import { emit } from '../../events/emit.js';
import type { DrizzleTx } from '../../events/emit.js';
import { NotFoundError } from '../../shared/errors.js';
import type { UserScopeCtx } from '../../shared/scope.js';

import {
  findChannelById,
  findConversationById,
  findOrCreateConversation,
  insertInboundMessage,
  insertInteractionBridge,
  insertOutboundMessage,
  listConversations as repoListConversations,
  listMessages as repoListMessages,
  updateConversationOnInbound,
  updateConversationOnOutbound,
  updateMessageViewStatus,
} from './repo.js';
import type {
  ComposerState,
  EnsureContactConversationInput,
  GetMessagesFilter,
  ListConversationsFilter,
  PersistInboundMessageInput,
  PersistOutboundMessageInput,
} from './schemas.js';
import { ChannelProviderSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Logger — redact de PII (doc 17 §8.3)
//
// Campos redactados: content (corpo das mensagens), contactName, contactRemoteId.
// IDs opacos (conversationId, messageId, channelId) são SEGUROS para logar.
// ---------------------------------------------------------------------------

const log = pino({
  name: 'livechat.service',
  redact: {
    paths: ['content', 'contactName', 'contactRemoteId', 'contact_name', 'contact_remote_id'],
    censor: '[redacted]',
  },
});

// ---------------------------------------------------------------------------
// Constantes de janela 24h por provider (planejamento §3.3)
// ---------------------------------------------------------------------------

const WINDOW_24H_MS = 24 * 60 * 60 * 1_000; // 24 horas em ms
const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1_000; // 7 dias em ms

// ---------------------------------------------------------------------------
// ensureContactConversation
// ---------------------------------------------------------------------------

/**
 * Garante que existe uma conversa ativa para o par (channel, contactRemoteId).
 * Cria o registro se não existir (idempotente).
 *
 * LGPD: contactPhoneEnc deve ser Buffer cifrado (encryptPii) — nunca plaintext.
 * O caller (inbound worker) é responsável por cifrar antes de passar aqui.
 *
 * @returns A conversa (existente ou recém-criada) + flag `created`.
 */
export async function ensureContactConversation(
  db: Database,
  input: EnsureContactConversationInput,
): Promise<{ conversation: Conversation; created: boolean }> {
  const { organizationId, channelId, contactRemoteId, contactName, contactPhoneEnc, cityId } =
    input;

  // LGPD: não logar contactRemoteId (pode ser telefone E.164) nem contactName
  log.debug({ organizationId, channelId }, 'livechat.service: ensureContactConversation');

  const result = await findOrCreateConversation(db, {
    organizationId,
    channelId,
    contactRemoteId,
    // LGPD: PII — passado ao repo que armazena cifrado/como bytea
    contactName,
    contactPhoneEnc,
    cityId,
  });

  if (result.created) {
    log.info(
      { organizationId, channelId, conversationId: result.conversation.id },
      'livechat.service: conversation created',
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// persistInboundMessage
// ---------------------------------------------------------------------------

/**
 * Persiste uma mensagem inbound de forma idempotente.
 *
 * Idempotência: (channel_id, external_id) UNIQUE no DB (partial index WHERE external_id IS NOT NULL).
 * Se a mensagem já existir, o DB lança UNIQUE constraint — o caller deve capturar
 * e ignorar (tratado abaixo como retorno null para duplicata).
 *
 * Fluxo:
 *   1. Insere mensagem em `messages`.
 *   2. Atualiza conversation: unread_count+1, last_inbound_at, last_message_at.
 *   3. Emite evento livechat.message_received no outbox (sem PII bruta).
 *   4. Se conversa tem lead_id: insere bridge em interactions (sem PII).
 *
 * Tudo em uma única transação db.transaction().
 *
 * @returns A mensagem inserida, ou null se já existia (duplicata idempotente).
 */
export async function persistInboundMessage(
  db: Database,
  input: PersistInboundMessageInput,
): Promise<Message | null> {
  const {
    organizationId,
    channelId,
    conversationId,
    externalId,
    messageType,
    content,
    mediaRef,
    replyToExternalId,
    metadata,
    rawTimestamp,
  } = input;

  // LGPD: não logar content (corpo da mensagem = PII)
  log.debug(
    { organizationId, channelId, conversationId, externalId, messageType },
    'livechat.service: persistInboundMessage',
  );

  const inboundAt = new Date(rawTimestamp);

  try {
    return await db.transaction(async (tx) => {
      // 1. Insere mensagem (idempotente por UNIQUE constraint no DB)
      const message = await insertInboundMessage(tx as unknown as Database, {
        conversationId,
        channelId,
        externalId,
        messageType,
        // Campos opcionais passados explicitamente com undefined para compatibilidade
        // com exactOptionalPropertyTypes: true
        content: content ?? undefined,
        mediaUrl: mediaRef?.refOrUrl ?? undefined,
        mediaMime: mediaRef?.mimeType ?? undefined,
        mediaSizeBytes: undefined,
        mediaSha256: mediaRef?.sha256 ?? undefined,
        replyToExternalId: replyToExternalId ?? undefined,
        metadata: metadata ?? undefined,
      });

      // 2. Atualiza contadores da conversa
      await updateConversationOnInbound(
        tx as unknown as Database,
        conversationId,
        organizationId,
        inboundAt,
      );

      // 3. Emite evento no outbox — SEM PII bruta (doc 17 §8.5)
      // Usa evento 'whatsapp.message_received' existente enquanto eventos livechat.*
      // não estão registrados em events/types.ts (serão adicionados em F16-S12).
      // Payload: apenas IDs opacos. Sem content, sem contactRemoteId nem telefone.
      await emit(tx as unknown as DrizzleTx, {
        eventName: 'whatsapp.message_received',
        aggregateType: 'livechat_message',
        aggregateId: message.id,
        organizationId,
        actor: { kind: 'system', id: null, ip: null },
        idempotencyKey: `livechat.message_received:${message.id}`,
        // WhatsappMessageReceivedData: whatsapp_message_id + nulls (sem PII bruta)
        data: {
          whatsapp_message_id: message.id, // ID interno opaco (não é wamid)
          chatwoot_conversation_id: null,
          lead_id: null, // lead_id hidratado pelo consumer via /internal/
        },
      });

      // 4. Bridge interactions (apenas se a conversa tem lead_id vinculado)
      // Busca lead_id da conversa para decidir se emite bridge para o CRM.
      // Não usa o `conversations` já buscado pelo caller para evitar acoplamento.
      const [conv] = await (tx as unknown as Database)
        .select({ leadId: conversations.leadId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1);

      if (conv?.leadId !== undefined && conv.leadId !== null) {
        // TODO(F16-S12): mapear channel por provider (whatsapp/instagram) do canal
        await insertInteractionBridge(tx as unknown as Database, {
          organizationId,
          leadId: conv.leadId,
          channel: 'whatsapp',
          direction: 'inbound',
          messageId: message.id,
          messageType,
          externalRef: externalId,
        });
      }

      log.info(
        { organizationId, channelId, conversationId, messageId: message.id, messageType },
        'livechat.service: inbound message persisted',
      );

      return message;
    });
  } catch (err: unknown) {
    // UNIQUE violation: mensagem já existe — retorna null (idempotente)
    if (err instanceof Error && err.message.includes('messages_channel_external_id_key')) {
      log.debug(
        { organizationId, channelId, externalId },
        'livechat.service: duplicate inbound message ignored (idempotent)',
      );
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// persistOutboundMessage
// ---------------------------------------------------------------------------

/**
 * Cria uma mensagem outbound com status 'pending'.
 *
 * O outbound worker preenche externalId e atualiza view_status para 'sent'
 * após envio bem-sucedido ao provider.
 *
 * Tudo em uma única transação.
 *
 * @returns A mensagem criada (com id para usar como messageId no OutboundJob).
 */
export async function persistOutboundMessage(
  db: Database,
  input: PersistOutboundMessageInput,
): Promise<Message> {
  const {
    organizationId,
    channelId,
    conversationId,
    messageType,
    content,
    mediaUrl,
    mediaMime,
    interactivePayload,
    replyToExternalId,
    metadata,
  } = input;

  // LGPD: não logar content
  log.debug(
    { organizationId, channelId, conversationId, messageType },
    'livechat.service: persistOutboundMessage',
  );

  return await db.transaction(async (tx) => {
    const sentAt = new Date();

    const message = await insertOutboundMessage(tx as unknown as Database, {
      conversationId,
      channelId,
      messageType,
      // Campos opcionais passados explicitamente com undefined para compatibilidade
      // com exactOptionalPropertyTypes: true
      content: content ?? undefined,
      mediaUrl: mediaUrl ?? undefined,
      mediaMime: mediaMime ?? undefined,
      interactivePayload: interactivePayload ?? undefined,
      replyToExternalId: replyToExternalId ?? undefined,
      metadata: metadata ?? undefined,
    });

    await updateConversationOnOutbound(
      tx as unknown as Database,
      conversationId,
      organizationId,
      sentAt,
    );

    // Emite evento no outbox — SEM PII bruta (doc 17 §8.5)
    // Usa evento 'whatsapp.message_sent' existente até eventos livechat.* serem
    // adicionados em events/types.ts (F16-S12). Payload só IDs opacos.
    await emit(tx as unknown as DrizzleTx, {
      eventName: 'whatsapp.message_sent',
      aggregateType: 'livechat_message',
      aggregateId: message.id,
      organizationId,
      actor: { kind: 'system', id: null, ip: null },
      idempotencyKey: `livechat.message_sent:${message.id}`,
      // WhatsappMessageSentData: whatsapp_message_id + lead_id null (sem PII bruta)
      data: {
        whatsapp_message_id: message.id, // ID interno opaco
        lead_id: null, // hidratado pelo consumer via /internal/
      },
    });

    log.info(
      { organizationId, channelId, conversationId, messageId: message.id, messageType },
      'livechat.service: outbound message persisted (pending)',
    );

    return message;
  });
}

// ---------------------------------------------------------------------------
// updateViewStatus
// ---------------------------------------------------------------------------

/**
 * Atualiza o view_status de uma mensagem outbound.
 * Chamado pelo inbound worker ao receber status callback do provider.
 */
export async function updateViewStatus(
  db: Database,
  messageId: string,
  viewStatus: 'sent' | 'delivered' | 'read' | 'failed',
  externalId?: string,
): Promise<void> {
  log.debug({ messageId, viewStatus }, 'livechat.service: updateViewStatus');

  await updateMessageViewStatus(db, messageId, viewStatus, externalId);
}

// ---------------------------------------------------------------------------
// getConversation
// ---------------------------------------------------------------------------

/**
 * Busca uma conversa pelo ID com escopo de organização e cidade.
 *
 * @throws NotFoundError se não encontrar ou fora do escopo.
 */
export async function getConversation(
  db: Database,
  conversationId: string,
  organizationId: string,
  userCtx: UserScopeCtx,
): Promise<Conversation> {
  return findConversationById(db, conversationId, organizationId, userCtx);
}

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

/**
 * Lista conversas com filtros e escopo de cidade.
 * LGPD: contact_phone_enc nunca retornado nesta chamada.
 */
export async function listConversations(
  db: Database,
  filter: ListConversationsFilter,
): Promise<Conversation[]> {
  return repoListConversations(db, filter);
}

// ---------------------------------------------------------------------------
// getMessages
// ---------------------------------------------------------------------------

/**
 * Lista mensagens de uma conversa com paginação por cursor.
 * LGPD: content é PII — o caller é responsável por redact antes de logar/enviar ao LLM.
 */
export async function getMessages(db: Database, filter: GetMessagesFilter): Promise<Message[]> {
  return repoListMessages(db, filter);
}

// ---------------------------------------------------------------------------
// getComposerState
// ---------------------------------------------------------------------------

/**
 * Retorna o estado da janela de composição para um provider específico.
 *
 * Matriz de janela (planejamento §3.3):
 *   meta_whatsapp: livre <24h → template_only além de 24h
 *   meta_instagram: livre <24h → human_agent_tag entre 24h–7d → closed >7d
 *   waha: sempre aberto (sem janela de 24h)
 *
 * @param conversation - Conversa (com lastInboundAt para calcular janela).
 * @param channel - Canal (com provider para identificar matriz de janela).
 * @returns ComposerState com window, remainingMs e lastInboundAt.
 */
export function getComposerState(
  conversation: Pick<Conversation, 'id' | 'lastInboundAt'>,
  channel: Pick<Channel, 'provider'>,
): ComposerState {
  // Valida e narrowa `provider` de `string` (Drizzle) para `ChannelProvider` (Zod enum).
  // O CHECK do DB garante que apenas valores válidos existem — parse nunca falha em prod.
  // Se falhar (DB corrompido), o erro de Zod é propagado ao caller.
  const providerParsed = ChannelProviderSchema.parse(channel.provider);
  const lastInboundAt = conversation.lastInboundAt;
  const now = Date.now();

  // WAHA: sempre livre (sem limitação de janela)
  if (providerParsed === 'waha') {
    return {
      conversationId: conversation.id,
      provider: providerParsed,
      window: 'open',
      lastInboundAt,
      remainingMs: null, // sem janela — livre indefinidamente
    };
  }

  // Sem mensagem inbound ainda: janela fechada (não há cliente para responder)
  if (lastInboundAt === null) {
    return {
      conversationId: conversation.id,
      provider: providerParsed,
      window: 'closed',
      lastInboundAt: null,
      remainingMs: 0,
    };
  }

  const elapsedMs = now - lastInboundAt.getTime();

  if (providerParsed === 'meta_whatsapp') {
    // WhatsApp: livre <24h → template_only além de 24h
    if (elapsedMs < WINDOW_24H_MS) {
      return {
        conversationId: conversation.id,
        provider: providerParsed,
        window: 'open',
        lastInboundAt,
        remainingMs: WINDOW_24H_MS - elapsedMs,
      };
    }

    return {
      conversationId: conversation.id,
      provider: providerParsed,
      window: 'template_only',
      lastInboundAt,
      remainingMs: 0,
    };
  }

  // meta_instagram: livre <24h → human_agent_tag entre 24h–7d → closed >7d
  // TypeScript sabe aqui que providerParsed === 'meta_instagram' (enum exhausto).
  if (elapsedMs < WINDOW_24H_MS) {
    return {
      conversationId: conversation.id,
      provider: providerParsed,
      window: 'open',
      lastInboundAt,
      remainingMs: WINDOW_24H_MS - elapsedMs,
    };
  }

  if (elapsedMs < WINDOW_7D_MS) {
    return {
      conversationId: conversation.id,
      provider: providerParsed,
      window: 'human_agent_tag',
      lastInboundAt,
      remainingMs: WINDOW_7D_MS - elapsedMs,
    };
  }

  return {
    conversationId: conversation.id,
    provider: providerParsed,
    window: 'closed',
    lastInboundAt,
    remainingMs: 0,
  };
}

// ---------------------------------------------------------------------------
// findChannel (helper público para workers/rotas)
// ---------------------------------------------------------------------------

/**
 * Busca um canal ativo pelo ID dentro da organização.
 *
 * @throws NotFoundError se não encontrar.
 */
export async function findChannel(
  db: Database,
  channelId: string,
  organizationId: string,
): Promise<Channel> {
  return findChannelById(db, channelId, organizationId);
}

// Re-exporta NotFoundError para conveniência dos consumers
export { NotFoundError };
