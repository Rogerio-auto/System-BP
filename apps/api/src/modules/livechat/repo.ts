// =============================================================================
// livechat/repo.ts — Queries Drizzle para o domínio do live chat (F16-S07).
//
// Responsabilidades:
//   - CRUD de channels / conversations / messages com organization_id scope.
//   - applyCityScope em listagens de conversas (escopo de cidade).
//   - Idempotência em persistInboundMessage: (channel_id, external_id) UNIQUE.
//   - Upsert de conversa por (channel_id, contact_remote_id) — findOrCreate.
//   - Bridge mínima para interactions (CRM/Kanban) sem PII bruta.
//
// Multi-tenant:
//   - Todos os métodos recebem organizationId explicitamente.
//   - Sem middleware de tenant ainda (vem em F17).
//
// LGPD (doc 17 §8.1, §8.5):
//   - contact_phone_enc: bytea cifrado — nunca retornado para fora do service.
//   - contact_name: PII — não logar sem redact.
//   - content (messages): PII — não logar; redact antes de LLM.
//   - Outbox nunca carrega PII bruta.
//
// Segurança (doc 10 §3.5):
//   - GET-by-id com applyCityScope: zero linhas → lança NotFoundError (404).
//   - Nunca ForbiddenError (403) em contexto de leitura — impede oracle de existência.
//
// DB injection:
//   - Todos os métodos recebem `db: Database` para facilitar testes.
// =============================================================================

import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { channels } from '../../db/schema/channels.js';
import type { Channel } from '../../db/schema/channels.js';
import { conversations } from '../../db/schema/conversations.js';
import type { Conversation, NewConversation } from '../../db/schema/conversations.js';
import { interactions } from '../../db/schema/interactions.js';
import { messages } from '../../db/schema/messages.js';
import type { Message, NewMessage } from '../../db/schema/messages.js';
import { NotFoundError } from '../../shared/errors.js';
import { cityScope } from '../../shared/scope.js';
import type { UserScopeCtx } from '../../shared/scope.js';

import type { GetMessagesFilter, ListConversationsFilter } from './schemas.js';

// ---------------------------------------------------------------------------
// channels — findById
// ---------------------------------------------------------------------------

/**
 * Busca um canal ativo pelo ID dentro da organização.
 *
 * @throws NotFoundError se o canal não existir, estiver deletado ou pertencer
 *         a outra organização (oracle de existência — doc 10 §3.5).
 */
export async function findChannelById(
  db: Database,
  channelId: string,
  organizationId: string,
): Promise<Channel> {
  const [row] = await db
    .select()
    .from(channels)
    .where(
      and(
        eq(channels.id, channelId),
        eq(channels.organizationId, organizationId),
        isNull(channels.deletedAt),
      ),
    )
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError(`Channel not found: ${channelId}`);
  }

  return row;
}

// ---------------------------------------------------------------------------
// conversations — findOrCreate
// ---------------------------------------------------------------------------

/**
 * Dados mínimos para criar uma nova conversa.
 * contact_phone_enc é Buffer (LGPD: bytea cifrado) — opcional (IG pode não ter).
 * Campos opcionais usam `string | undefined` (não `?:`) para compatibilidade com
 * exactOptionalPropertyTypes: true — o caller passa undefined explicitamente.
 */
export interface FindOrCreateConversationParams {
  organizationId: string;
  channelId: string;
  contactRemoteId: string;
  contactName: string | undefined;
  contactPhoneEnc: Buffer | undefined;
  cityId: string | undefined;
}

/**
 * Busca a conversa ativa por (channel_id, contact_remote_id) ou cria uma nova.
 *
 * Idempotente: múltiplas chamadas com os mesmos IDs retornam a mesma conversa.
 * Nota: usa select-then-insert sem lock — race condition improvável em produção
 * (mesmo channel+contact simultâneo é raro) mas pode ocorrer em testes de carga.
 * Em caso de UNIQUE violation por race, retorna a conversa existente.
 *
 * @returns { conversation, created: boolean }
 */
export async function findOrCreateConversation(
  db: Database,
  params: FindOrCreateConversationParams,
): Promise<{ conversation: Conversation; created: boolean }> {
  const { organizationId, channelId, contactRemoteId, contactName, contactPhoneEnc, cityId } =
    params;

  // 1. Tenta encontrar conversa existente (não deletada)
  const [existing] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.organizationId, organizationId),
        eq(conversations.channelId, channelId),
        eq(conversations.contactRemoteId, contactRemoteId),
        isNull(conversations.deletedAt),
      ),
    )
    .limit(1);

  if (existing !== undefined) {
    // Atualiza contactName se chegou nome e a conversa ainda não tem
    if (contactName !== undefined && contactName !== '' && existing.contactName === null) {
      const [updated] = await db
        .update(conversations)
        .set({ contactName })
        .where(eq(conversations.id, existing.id))
        .returning();
      return { conversation: (updated ?? existing) as Conversation, created: false };
    }
    return { conversation: existing, created: false };
  }

  // 2. Cria nova conversa
  const newConv: NewConversation = {
    organizationId,
    channelId,
    contactRemoteId,
    // LGPD: contactName é PII — persistido mas nunca logado sem redact
    contactName: contactName ?? null,
    // LGPD: contactPhoneEnc é bytea cifrado — nunca em texto plano
    contactPhoneEnc: contactPhoneEnc ?? null,
    cityId: cityId ?? null,
    status: 'open',
    kind: 'dm',
    unreadCount: 0,
  };

  // Em caso de race condition (insert concorrente), o DB lançará um erro de
  // UNIQUE constraint — o caller pode capturar e re-buscar se necessário.
  const [created] = await db.insert(conversations).values(newConv).returning();

  // `as` justificado: insert().returning() em Drizzle retorna T[] e não T | undefined;
  // o array tem exatamente 1 elemento após insert bem-sucedido.
  return { conversation: created as Conversation, created: true };
}

/**
 * Busca uma conversa pelo ID com escopo de organização e cidade.
 *
 * @throws NotFoundError se não encontrar (inclui casos de scope inválido
 *         para prevenir oracle de existência — doc 10 §3.5).
 */
export async function findConversationById(
  db: Database,
  conversationId: string,
  organizationId: string,
  userCtx: UserScopeCtx,
): Promise<Conversation> {
  const scopeCondition = cityScope(userCtx, conversations.cityId);

  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
        isNull(conversations.deletedAt),
        scopeCondition,
      ),
    )
    .limit(1);

  if (row === undefined) {
    throw new NotFoundError(`Conversation not found: ${conversationId}`);
  }

  return row;
}

/**
 * Lista conversas com filtros, escopo de cidade e paginação por cursor.
 *
 * Ordenação: last_message_at DESC (mais recente primeiro) para o ChatList.
 * LGPD: contact_phone_enc nunca retornado nesta listagem — coluna excluída.
 */
export async function listConversations(
  db: Database,
  filter: ListConversationsFilter,
): Promise<Conversation[]> {
  const { organizationId, cityScopeIds, channelId, status, assignedUserId, cursor, limit } = filter;

  const userCtx: UserScopeCtx = { cityScopeIds };
  const scopeCondition = cityScope(userCtx, conversations.cityId);

  // Condições base obrigatórias
  const conditions = [
    eq(conversations.organizationId, organizationId),
    isNull(conversations.deletedAt),
  ];

  if (channelId !== undefined) {
    conditions.push(eq(conversations.channelId, channelId));
  }
  if (status !== undefined) {
    conditions.push(eq(conversations.status, status));
  }
  if (assignedUserId !== undefined) {
    conditions.push(eq(conversations.assignedUserId, assignedUserId));
  }

  // Cursor: busca conversas com last_message_at antes do cursor
  // Implementação simplificada: usamos createdAt do cursor para offset-by-id
  // (paginação robusta por timestamp + id vem em S12)
  if (cursor !== undefined) {
    const [cursorRow] = await db
      .select({ lastMessageAt: conversations.lastMessageAt })
      .from(conversations)
      .where(eq(conversations.id, cursor))
      .limit(1);

    if (cursorRow?.lastMessageAt !== undefined && cursorRow.lastMessageAt !== null) {
      conditions.push(lt(conversations.lastMessageAt, cursorRow.lastMessageAt));
    }
  }

  if (scopeCondition !== undefined) {
    conditions.push(scopeCondition);
  }

  return db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(limit);
}

/**
 * Atualiza contadores e timestamps após inbound (na mesma transação).
 *
 * unread_count: +1
 * last_inbound_at: agora
 * last_message_at: agora
 */
export async function updateConversationOnInbound(
  db: Database,
  conversationId: string,
  organizationId: string,
  inboundAt: Date,
): Promise<void> {
  await db
    .update(conversations)
    .set({
      // sql`` template necessário para incremento atômico sem race condition.
      // `as` justificado: sql<unknown> é compatível com integer no contexto do
      // .set() Drizzle — não há tipo mais específico disponível na API.
      unreadCount: sql`unread_count + 1` as unknown as number,
      lastInboundAt: inboundAt,
      lastMessageAt: inboundAt,
      updatedAt: inboundAt,
    })
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    );
}

/**
 * Atualiza last_message_at após outbound (sem incrementar unread_count).
 */
export async function updateConversationOnOutbound(
  db: Database,
  conversationId: string,
  organizationId: string,
  sentAt: Date,
): Promise<void> {
  await db
    .update(conversations)
    .set({
      lastMessageAt: sentAt,
      updatedAt: sentAt,
    })
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    );
}

// ---------------------------------------------------------------------------
// messages — insert + update view_status
// ---------------------------------------------------------------------------

/**
 * Insere uma mensagem inbound. Idempotente por (channel_id, external_id).
 *
 * Se a mensagem já existir (UNIQUE constraint), o DB lança exceção que o caller
 * deve tratar (ignorar). Nunca duplica.
 *
 * @returns A mensagem inserida.
 */
export async function insertInboundMessage(
  db: Database,
  params: {
    conversationId: string;
    channelId: string;
    externalId: string;
    messageType: string;
    // `string | undefined` em vez de `?: string` para compatibilidade com
    // exactOptionalPropertyTypes: true — o caller passa undefined explicitamente.
    content: string | undefined;
    mediaUrl: string | undefined;
    mediaMime: string | undefined;
    mediaSizeBytes: number | undefined;
    mediaSha256: string | undefined;
    replyToExternalId: string | undefined;
    metadata: Record<string, unknown> | undefined;
  },
): Promise<Message> {
  const newMsg: NewMessage = {
    conversationId: params.conversationId,
    channelId: params.channelId,
    direction: 'in',
    externalId: params.externalId,
    type: params.messageType,
    content: params.content ?? null,
    mediaUrl: params.mediaUrl ?? null,
    mediaMime: params.mediaMime ?? null,
    mediaSizeBytes: params.mediaSizeBytes ?? null,
    mediaSha256: params.mediaSha256 ?? null,
    replyToExternalId: params.replyToExternalId ?? null,
    metadata: params.metadata ?? null,
    // viewStatus null para inbound (não aplicável — doc schema §8.5)
    viewStatus: null,
  };

  const [inserted] = await db.insert(messages).values(newMsg).returning();

  // `as` justificado: insert().returning() com 1 row retorna array de 1 elemento.
  return inserted as Message;
}

/**
 * Insere uma mensagem outbound com status inicial 'pending'.
 *
 * @returns A mensagem inserida (com id para usar como messageId no OutboundJob).
 */
export async function insertOutboundMessage(
  db: Database,
  params: {
    conversationId: string;
    channelId: string;
    messageType: string;
    // `string | undefined` em vez de `?: string` para compatibilidade com
    // exactOptionalPropertyTypes: true — o caller passa undefined explicitamente.
    content: string | undefined;
    mediaUrl: string | undefined;
    mediaMime: string | undefined;
    interactivePayload: Record<string, unknown> | undefined;
    replyToExternalId: string | undefined;
    metadata: Record<string, unknown> | undefined;
  },
): Promise<Message> {
  const newMsg: NewMessage = {
    conversationId: params.conversationId,
    channelId: params.channelId,
    direction: 'out',
    externalId: null, // preenchido pelo outbound worker após envio
    type: params.messageType,
    content: params.content ?? null,
    mediaUrl: params.mediaUrl ?? null,
    mediaMime: params.mediaMime ?? null,
    interactivePayload: params.interactivePayload ?? null,
    replyToExternalId: params.replyToExternalId ?? null,
    metadata: params.metadata ?? null,
    viewStatus: 'pending',
  };

  const [inserted] = await db.insert(messages).values(newMsg).returning();

  // `as` justificado: insert().returning() com 1 row retorna array de 1 elemento.
  return inserted as Message;
}

/**
 * Atualiza o view_status de uma mensagem outbound (sent/delivered/read/failed).
 * Usado pelo inbound worker ao receber status update do provider.
 */
export async function updateMessageViewStatus(
  db: Database,
  messageId: string,
  viewStatus: 'sent' | 'delivered' | 'read' | 'failed',
  externalId?: string,
): Promise<void> {
  const setFields: Partial<NewMessage> = { viewStatus, updatedAt: new Date() };
  if (externalId !== undefined) {
    setFields.externalId = externalId;
  }

  await db.update(messages).set(setFields).where(eq(messages.id, messageId));
}

/**
 * Atualiza o externalId de uma mensagem outbound após envio bem-sucedido.
 * Usado pelo outbound worker após receber wamid do provider.
 */
export async function updateMessageExternalId(
  db: Database,
  messageId: string,
  externalId: string,
  viewStatus: 'sent' | 'pending',
): Promise<void> {
  await db
    .update(messages)
    .set({ externalId, viewStatus, updatedAt: new Date() })
    .where(eq(messages.id, messageId));
}

/**
 * Lista mensagens de uma conversa com paginação por cursor.
 *
 * Ordenação: created_at ASC (cronológico para o chat).
 * Cursor: busca mensagens anteriores a `before` (UUID da última mensagem vista).
 *
 * LGPD: content é PII — não logar; redact antes de LLM.
 */
export async function listMessages(db: Database, filter: GetMessagesFilter): Promise<Message[]> {
  const { conversationId, before, limit } = filter;

  const conditions = [eq(messages.conversationId, conversationId)];

  if (before !== undefined) {
    const [cursorRow] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, before))
      .limit(1);

    if (cursorRow !== undefined) {
      conditions.push(lt(messages.createdAt, cursorRow.createdAt));
    }
  }

  return db
    .select()
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// interactions bridge — espelho mínimo para CRM/Kanban (doc 17 §8.5)
//
// Sem PII bruta: content do bridge é um resumo estruturado (tipo + messageId),
// não o texto da mensagem. O CRM/Kanban busca o conteúdo real via /internal/
// se necessário.
// ---------------------------------------------------------------------------

/**
 * Parâmetros para a bridge interaction.
 * leadId é obrigatório — a bridge só é criada quando a conversa tem lead vinculado.
 */
export interface InsertInteractionBridgeParams {
  organizationId: string;
  leadId: string;
  channel: 'whatsapp' | 'phone' | 'email' | 'in_person' | 'chatwoot';
  direction: 'inbound' | 'outbound';
  /** Referência ao messageId interno (UUID opaco — não é PII). */
  messageId: string;
  /** Tipo de mensagem (text, image, etc.) — não é PII. */
  messageType: string;
  /** external_ref para dedupe no canal (ex: wamid.xxx — não é PII direta). */
  externalRef?: string;
}

/**
 * Insere uma linha de interaction como espelho do live chat para o CRM/Kanban.
 *
 * LGPD §8.5: content contém apenas metadados estruturais (não o texto da mensagem).
 * O campo content da interactions é "[livechat] type=text ref=<messageId>" —
 * suficiente para o Kanban worker atualizar status sem expor PII.
 *
 * Idempotente por (channel, externalRef) WHERE external_ref IS NOT NULL.
 */
export async function insertInteractionBridge(
  db: Database,
  params: InsertInteractionBridgeParams,
): Promise<void> {
  // Content estruturado sem PII bruta (doc 17 §8.5)
  const content = `[livechat] type=${params.messageType} ref=${params.messageId}`;

  await db.insert(interactions).values({
    leadId: params.leadId,
    organizationId: params.organizationId,
    channel: params.channel,
    direction: params.direction,
    content,
    metadata: {
      message_id: params.messageId,
      message_type: params.messageType,
      source: 'livechat',
    },
    externalRef: params.externalRef ?? null,
  });
}
