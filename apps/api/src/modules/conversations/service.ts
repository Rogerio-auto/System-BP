// =============================================================================
// conversations/service.ts — Orquestração das rotas de leitura de conversas (F16-S12).
//
// Responsabilidades:
//   - listConversations: aplica filtros, escopo de cidade, paginação por cursor.
//   - getConversationDetail: busca conversa + decifra contactPhone (se autorizado)
//     + monta composerState via getComposerState (S07).
//   - getMessages: lista mensagens por cursor e marca como lidas.
//
// Regras LGPD (doc 17 §8.1):
//   - contactPhoneEnc: só decifrado se o caller possui crm:contact:phone:read.
//   - Logs com redact de PII (contactName, contactRemoteId, content).
//   - Respostas sem PII bruta: contact_remote_id retornado como campo opaco,
//     contactPhone apenas no detalhe autorizado.
//
// Multi-tenant:
//   - Todos os métodos recebem organizationId explícito (preparado para F17).
//   - applyCityScope aplicado via UserScopeCtx passado do request.user.
//
// Leitura: NÃO emite eventos de outbox (leituras são idempotentes e sem side-effects).
// =============================================================================

import { and, asc, eq, isNull } from 'drizzle-orm';
import pino from 'pino';

import type { Database } from '../../db/client.js';
import { conversations } from '../../db/schema/conversations.js';
import type { Conversation } from '../../db/schema/conversations.js';
import type { Message } from '../../db/schema/messages.js';
import { messages } from '../../db/schema/messages.js';
import { whatsappTemplates } from '../../db/schema/whatsappTemplates.js';
import { decryptPii } from '../../lib/crypto/pii.js';
import type { UserScopeCtx } from '../../shared/scope.js';
import { NotFoundError } from '../../shared/errors.js';
import type { ComposerState } from '../livechat/schemas.js';
import {
  findChannel,
  getComposerState,
  getConversation,
  getMessages as repoGetMessages,
  listConversations as repoListConversations,
} from '../livechat/service.js';

import type {
  ConversationDetail,
  ConversationListResponse,
  ConversationListQuery,
  MessageListResponse,
  MessageListQuery,
  WindowState,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Logger com redact de PII (doc 17 §8.3)
// ---------------------------------------------------------------------------

const log = pino({
  name: 'conversations.service',
  redact: {
    paths: ['contactName', 'contactRemoteId', 'contactPhone', 'content'],
    censor: '[redacted]',
  },
});

// ---------------------------------------------------------------------------
// Helpers de mapeamento Drizzle → DTO
// ---------------------------------------------------------------------------

/**
 * Converte uma Conversation (Drizzle) para o DTO público de listagem.
 * SEM contactPhone (LGPD M1).
 */
function toConversationDto(conv: Conversation): Omit<ConversationDetail, 'contactPhone'> {
  return {
    id: conv.id,
    organizationId: conv.organizationId,
    cityId: conv.cityId,
    channelId: conv.channelId,
    contactRemoteId: conv.contactRemoteId,
    contactName: conv.contactName,
    leadId: conv.leadId,
    customerId: conv.customerId ?? null,
    status: conv.status as ConversationDetail['status'],
    assignedUserId: conv.assignedUserId,
    lastInboundAt: conv.lastInboundAt?.toISOString() ?? null,
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    kind: conv.kind as ConversationDetail['kind'],
    unreadCount: conv.unreadCount,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
  };
}

/**
 * Converte uma Message (Drizzle) para MessageDto público.
 * LGPD: content é PII — não logar.
 */
function toMessageDto(msg: Message): MessageListResponse['data'][number] {
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    channelId: msg.channelId,
    direction: msg.direction as 'in' | 'out',
    externalId: msg.externalId,
    type: msg.type as MessageListResponse['data'][number]['type'],
    content: msg.content,
    mediaUrl: msg.mediaUrl,
    mediaMime: msg.mediaMime,
    mediaSizeBytes: msg.mediaSizeBytes,
    mediaSha256: msg.mediaSha256,
    // `as` justificado: interactivePayload é jsonb (Record<string,unknown> | null) no Drizzle
    // schema mas pode vir como objeto genérico — o tipo Zod aceita Record<string,unknown> | null.
    interactivePayload: msg.interactivePayload as Record<string, unknown> | null,
    viewStatus: msg.viewStatus as MessageListResponse['data'][number]['viewStatus'],
    metadata: (msg.metadata ?? {}) as Record<string, unknown>,
    createdAt: msg.createdAt.toISOString(),
    updatedAt: msg.updatedAt.toISOString(),
  };
}

/**
 * Converte ComposerState do S07 (lastInboundAt: Date | null) para WindowState (ISO string).
 */
function toWindowStateDto(state: ComposerState): WindowState {
  return {
    conversationId: state.conversationId,
    provider: state.provider,
    window: state.window,
    lastInboundAt: state.lastInboundAt !== null ? state.lastInboundAt.toISOString() : null,
    remainingMs: state.remainingMs,
  };
}

// ---------------------------------------------------------------------------
// ActorContext — subconjunto de request.user necessário para as operações
// ---------------------------------------------------------------------------

export interface ActorContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly cityScopeIds: string[] | null;
  readonly permissions: string[];
}

// ---------------------------------------------------------------------------
// listConversationsService
// ---------------------------------------------------------------------------

/**
 * Lista conversas com filtros, escopo de cidade e paginação por cursor.
 *
 * Ordenação: last_message_at DESC (mais recentes primeiro).
 * Paginação: cursor por `id` da última conversa da página anterior.
 *
 * LGPD: resposta sem contactPhone (listagem não exige PII de telefone).
 *
 * @returns Lista de conversas + nextCursor para a próxima página.
 */
export async function listConversationsService(
  db: Database,
  actor: ActorContext,
  query: ConversationListQuery,
): Promise<ConversationListResponse> {
  const { organizationId, cityScopeIds } = actor;
  const { status, channelId, assignedUserId, cursor, limit } = query;

  log.debug(
    { organizationId, status, channelId, limit },
    'conversations.service: listConversations',
  );

  const rows = await repoListConversations(db, {
    organizationId,
    cityScopeIds,
    // Default status = 'open' quando não especificado
    status: status ?? 'open',
    channelId,
    assignedUserId,
    cursor,
    limit,
  });

  // nextCursor: se retornou `limit` itens, pode haver mais
  const lastRow = rows[rows.length - 1];
  const nextCursor = rows.length === limit && lastRow !== undefined ? lastRow.id : null;

  return {
    data: rows.map(toConversationDto),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// getConversationDetailService
// ---------------------------------------------------------------------------

/**
 * Busca o detalhe de uma conversa com estado da janela de composição.
 *
 * LGPD: contactPhone decifrado apenas se `hasPhonePermission = true`.
 *
 * @param hasPhonePermission - true se o usuário possui crm:contact:phone:read.
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getConversationDetailService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
  hasPhonePermission: boolean,
): Promise<{ data: ConversationDetail; composerState: WindowState }> {
  const { organizationId, cityScopeIds } = actor;

  log.debug({ organizationId, conversationId }, 'conversations.service: getConversationDetail');

  // 1. Busca conversa com escopo de cidade (lança NotFoundError se fora do escopo)
  const userCtx: UserScopeCtx = { cityScopeIds };
  const conv = await getConversation(db, conversationId, organizationId, userCtx);

  // 2. Busca canal para calcular composer state
  const channel = await findChannel(db, conv.channelId, organizationId);

  // 3. Calcula estado da janela
  const composerStateRaw = getComposerState(conv, channel);
  const composerState = toWindowStateDto(composerStateRaw);

  // 4. Decifra contactPhone apenas se autorizado (LGPD M1)
  let contactPhone: string | null = null;

  if (hasPhonePermission && conv.contactPhoneEnc !== null && conv.contactPhoneEnc !== undefined) {
    // decryptPii retorna string utf-8 (número E.164)
    // LGPD: não logar o valor decifrado
    contactPhone = await decryptPii(conv.contactPhoneEnc);
  }

  const data: ConversationDetail = {
    ...toConversationDto(conv),
    contactPhone,
  };

  return { data, composerState };
}

// ---------------------------------------------------------------------------
// getMessagesService
// ---------------------------------------------------------------------------

/**
 * Lista mensagens de uma conversa com paginação por cursor.
 *
 * Ao acessar as mensagens, zera o `unread_count` da conversa e marca
 * as mensagens inbound pendentes como 'read'.
 *
 * LGPD: content é PII — não logado.
 *
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getMessagesService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
  query: MessageListQuery,
): Promise<MessageListResponse> {
  const { organizationId, cityScopeIds } = actor;
  const { before, limit } = query;

  log.debug({ organizationId, conversationId, limit }, 'conversations.service: getMessages');

  // 1. Verifica que a conversa existe e pertence ao escopo (oracle protection)
  const userCtx: UserScopeCtx = { cityScopeIds };
  await getConversation(db, conversationId, organizationId, userCtx);

  // 2. Busca mensagens paginadas
  const msgs = await repoGetMessages(db, {
    conversationId,
    before,
    limit,
  });

  // 3. Marca mensagens inbound não lidas como 'read' + zera unread_count
  // Fire-and-forget: não bloqueia a resposta. Em caso de falha, o unread_count
  // ficará inconsistente até próximo acesso — aceitável para leitura.
  markConversationRead(db, conversationId, organizationId).catch((err: unknown) => {
    log.warn(
      { organizationId, conversationId, err },
      'conversations.service: falha ao marcar como lido (non-blocking)',
    );
  });

  // nextCursor: se retornou `limit` itens, pode haver mensagens mais antigas
  const firstRow = msgs[0];
  const nextCursor = msgs.length === limit && firstRow !== undefined ? firstRow.id : null;

  return {
    data: msgs.map(toMessageDto),
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// markConversationRead (helper interno)
// ---------------------------------------------------------------------------

/**
 * Zera unread_count da conversa e marca mensagens inbound pendentes como 'read'.
 *
 * Operação não-crítica: falha silenciosa (caller usa .catch()).
 * Sem emissão de eventos de outbox (leitura não tem side-effect de domínio).
 */
async function markConversationRead(
  db: Database,
  conversationId: string,
  organizationId: string,
): Promise<void> {
  // Zera unread_count da conversa (seguro por AND organizationId)
  await db
    .update(conversations)
    .set({ unreadCount: 0, updatedAt: new Date() })
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    );

  // Marca mensagens inbound com viewStatus null (pending inbound) como 'read'
  // view_status em mensagens inbound: null indica não processado
  await db
    .update(messages)
    .set({ viewStatus: 'read', updatedAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'in'),
        isNull(messages.viewStatus),
      ),
    );
}

// ---------------------------------------------------------------------------
// getConversationTemplatesService
// ---------------------------------------------------------------------------

/**
 * DTO público de um template aprovado, retornado pelo seletor de template.
 * `body_text` alias de `body` para clareza no contrato frontend.
 */
export interface TemplateDto {
  readonly id: string;
  readonly name: string;
  readonly category: 'utility' | 'marketing' | 'authentication';
  readonly variables: string[];
  /** Corpo do template com placeholders {{1}}, {{2}} etc. */
  readonly body_text: string;
}

export interface ConversationTemplatesResponse {
  readonly data: TemplateDto[];
}

/**
 * Lista templates aprovados da organização da conversa.
 *
 * Valida que a conversa pertence ao org/escopo do actor antes de retornar templates.
 * Filtra apenas `status = 'approved'` — os únicos enviáveis fora da janela 24h.
 *
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getConversationTemplatesService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
): Promise<ConversationTemplatesResponse> {
  const { organizationId, cityScopeIds } = actor;

  log.debug({ organizationId, conversationId }, 'conversations.service: getConversationTemplates');

  // 1. Valida que a conversa pertence ao escopo do actor (oracle protection)
  const userCtx: UserScopeCtx = { cityScopeIds };
  const conv = await getConversation(db, conversationId, organizationId, userCtx);

  // 2. Lista templates aprovados da org da conversa (ordenados por nome)
  const rows = await db
    .select({
      id: whatsappTemplates.id,
      name: whatsappTemplates.name,
      category: whatsappTemplates.category,
      variables: whatsappTemplates.variables,
      body: whatsappTemplates.body,
    })
    .from(whatsappTemplates)
    .where(
      and(
        eq(whatsappTemplates.organizationId, conv.organizationId),
        eq(whatsappTemplates.status, 'approved'),
      ),
    )
    .orderBy(asc(whatsappTemplates.name));

  const data: TemplateDto[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    // `as` justificado: Drizzle infere text enum como string genérica; o check DB garante o enum.
    category: row.category as TemplateDto['category'],
    variables: row.variables,
    body_text: row.body,
  }));

  return { data };
}

// ---------------------------------------------------------------------------
// getWindowService
// ---------------------------------------------------------------------------

/**
 * Retorna apenas o estado da janela de composição de uma conversa.
 *
 * Endpoint separado (/window) para o front consultar sem re-buscar
 * todas as mensagens (usado pelo ChatComposer em realtime — S14).
 *
 * @throws NotFoundError se conversa não pertencer à org/escopo do usuário.
 */
export async function getWindowService(
  db: Database,
  actor: ActorContext,
  conversationId: string,
): Promise<WindowState> {
  const { organizationId, cityScopeIds } = actor;

  log.debug({ organizationId, conversationId }, 'conversations.service: getWindow');

  const userCtx: UserScopeCtx = { cityScopeIds };
  const conv = await getConversation(db, conversationId, organizationId, userCtx);
  const channel = await findChannel(db, conv.channelId, organizationId);

  const composerStateRaw = getComposerState(conv, channel);
  return toWindowStateDto(composerStateRaw);
}
