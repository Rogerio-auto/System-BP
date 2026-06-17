// =============================================================================
// features/conversations/types.ts — Tipos do domínio de conversas (F16-S15).
//
// Tipos derivados dos contratos reais da API (S12) e de @elemento/shared-types.
// Espelham ConversationDto / MessageDto de packages/shared-types/src/livechat.ts
// (que atualmente não está re-exportado pelo barrel de shared-types).
//
// NUNCA inventar shape — copiado literalmente do shared-types/src/livechat.ts
// para evitar drift de contrato (ver feedback 2026-05-18).
//
// LGPD (doc 17 §8.1):
//   - Conversation (lista): sem contactPhone.
//   - ConversationDetail (detalhe): com contactPhone decifrado (PII).
//     Usar apenas em rotas que verificam crm:contact:phone:read.
//   - Message.content é PII — não logar, não exibir em devtools.
// =============================================================================

// ---------------------------------------------------------------------------
// Enums — espelham o backend (apps/api/src/modules/conversations/schemas.ts)
// ---------------------------------------------------------------------------

export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'snoozed';
export type ConversationKind = 'dm' | 'group' | 'comment_thread';
export type ChannelProvider = 'meta_whatsapp' | 'meta_instagram' | 'waha';
export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'interactive'
  | 'template'
  | 'reaction'
  | 'system'
  | 'story_mention'
  | 'story_reply'
  | 'share'
  | 'comment'
  | 'comment_reply'
  | 'ig_postback'
  | 'referral';
export type ViewStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

// ---------------------------------------------------------------------------
// DTOs principais — espelham shared-types/src/livechat.ts
// ---------------------------------------------------------------------------

/**
 * Conversa resumida para o inbox (SEM contactPhone).
 *
 * LGPD M1: listagem de conversas nunca retorna PII de telefone.
 * Espelha ConversationDto de @elemento/shared-types.
 */
export interface Conversation {
  readonly id: string;
  readonly organizationId: string;
  readonly cityId: string | null;
  readonly channelId: string;
  readonly contactRemoteId: string;
  readonly contactName: string | null;
  readonly leadId: string | null;
  readonly customerId: string | null;
  readonly status: ConversationStatus;
  readonly assignedUserId: string | null;
  readonly lastInboundAt: string | null;
  readonly lastMessageAt: string | null;
  readonly kind: ConversationKind;
  readonly provider: ChannelProvider;
  readonly unreadCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Detalhe de conversa (COM contactPhone decifrado).
 *
 * LGPD M1: retornado APENAS pelo endpoint de detalhe quando o usuário
 * tem crm:contact:phone:read. Não usar em listagens.
 * Espelha ConversationDetailDto de @elemento/shared-types.
 */
export interface ConversationDetail extends Conversation {
  /**
   * Telefone decifrado do contato.
   * LGPD: PII — não logar sem redact. Permissão: crm:contact:phone:read.
   */
  readonly contactPhone: string | null;
}

/** Mensagem individual — espelha MessageDto de @elemento/shared-types. */
export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly direction: 'in' | 'out';
  readonly externalId: string | null;
  readonly type: MessageType;
  /**
   * Conteúdo textual da mensagem.
   * LGPD: PII — não logar em produção.
   */
  readonly content: string | null;
  readonly mediaUrl: string | null;
  readonly mediaMime: string | null;
  readonly mediaSizeBytes: number | null;
  readonly mediaSha256: string | null;
  readonly interactivePayload: Record<string, unknown> | null;
  readonly viewStatus: ViewStatus | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Estado da janela de composição (endpoint GET /api/conversations/:id/window)
// ---------------------------------------------------------------------------

/**
 * Estado que controla o que o atendente pode enviar.
 * Espelha WindowState de apps/api/src/modules/conversations/schemas.ts.
 */
export type ComposerWindowKind = 'open' | 'human_agent_tag' | 'template_only' | 'closed';

export interface ComposerWindowState {
  readonly conversationId: string;
  readonly provider: ChannelProvider;
  readonly window: ComposerWindowKind;
  readonly lastInboundAt: string | null;
  /** Milissegundos restantes na janela (null = sem janela / waha). */
  readonly remainingMs: number | null;
}

// ---------------------------------------------------------------------------
// Envelopes de resposta da API — espelham schemas.ts do backend (S12)
// ---------------------------------------------------------------------------

/** Resposta de GET /api/conversations */
export interface ConversationListResponse {
  readonly data: Conversation[];
  /** Cursor para a próxima página (null = última página). */
  readonly nextCursor: string | null;
}

/** Resposta de GET /api/conversations/:id */
export interface ConversationDetailResponse {
  readonly data: ConversationDetail;
  readonly composerState: ComposerWindowState;
}

/** Resposta de GET /api/conversations/:id/messages */
export interface MessageListResponse {
  readonly data: Message[];
  /** Cursor para mensagens mais antigas (null = início da conversa). */
  readonly nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Payloads de eventos Socket.io (ServerToClient — relay worker F16-S08/S10)
// ---------------------------------------------------------------------------

/**
 * Payload do evento `message:new`.
 *
 * LGPD §8.3: sem content — apenas IDs + tipo + flags.
 * O frontend usa messageId para buscar a mensagem completa via invalidação do cache.
 */
export interface MessageNewPayload {
  readonly messageId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly organizationId: string;
  readonly messageType: string;
  readonly direction: 'inbound' | 'outbound';
  readonly hasMedia: boolean;
  readonly createdAt: string;
}

/**
 * Payload do evento `conversation:updated`.
 *
 * Emitido em mudança de view_status (delivered/read/failed) de mensagem outbound
 * e em mudanças de status da conversa (resolve, assign, etc.).
 */
export interface ConversationUpdatedPayload {
  readonly messageId?: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly organizationId: string;
  readonly viewStatus?: string;
  readonly status?: string;
}

// ---------------------------------------------------------------------------
// Parâmetros de query para os hooks
// ---------------------------------------------------------------------------

export interface ConversationsQueryParams {
  readonly status?: ConversationStatus;
  readonly channelId?: string;
  readonly assignedUserId?: string;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface MessagesQueryParams {
  readonly before?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Link Lead — espelha LinkLeadBodySchema / LinkLeadResponseSchema de F16-S23
// (apps/api/src/modules/conversations/schemas.ts)
// ---------------------------------------------------------------------------

/**
 * Body do PATCH /api/conversations/:id/lead.
 *
 * - leadId presente: vincula lead existente.
 * - leadId ausente: cria novo lead via dados do contato + cityId do canal.
 *
 * LGPD (doc 17 §8.1): leadId é UUID opaco — sem PII.
 */
export interface LinkLeadBody {
  /** UUID do lead a vincular. Omitir para criar novo lead. */
  readonly leadId?: string;
}

/**
 * Resposta do PATCH /api/conversations/:id/lead.
 *
 * LGPD: apenas IDs opacos — sem PII.
 */
export interface LinkLeadResponse {
  readonly conversationId: string;
  readonly leadId: string;
  /** true = lead criado agora; false = lead existente vinculado. */
  readonly created: boolean;
}
