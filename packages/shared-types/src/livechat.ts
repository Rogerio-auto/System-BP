// =============================================================================
// livechat.ts - Tipos puros (nao Zod) do dominio live chat.
// DTOs publicos sem campos de segredo (channel_secrets nunca exportados aqui).
// Espelha colunas seguras das tabelas channels/conversations/messages.
// =============================================================================

/** Provider de canal suportado. */
export type ChannelProvider = 'meta_whatsapp' | 'meta_instagram' | 'waha';

/** Tipo de mensagem (espelha messages.type no DB). */
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

/** Status de visualizacao da mensagem. */
export type ViewStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Status da conversa. */
export type ConversationStatus = 'open' | 'pending' | 'resolved' | 'snoozed';

/** Tipo de conversa. */
export type ConversationKind = 'dm' | 'group' | 'comment_thread';

// ---------------------------------------------------------------------------
// DTOs publicos (sem segredos)
// ---------------------------------------------------------------------------

/** Canal de comunicacao (sem access_token, sem app_secret). */
export interface ChannelDto {
  readonly id: string;
  readonly organizationId: string;
  readonly cityId: string | null;
  readonly provider: ChannelProvider;
  readonly name: string;
  readonly displayHandle: string | null;
  // WhatsApp
  readonly phoneNumber: string | null;
  readonly phoneNumberId: string | null;
  readonly wabaId: string | null;
  // Instagram
  readonly igUserId: string | null;
  readonly igUsername: string | null;
  // Comum
  readonly isActive: boolean;
  readonly isDefault: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Conversa (inbox). */
export interface ConversationDto {
  readonly id: string;
  readonly organizationId: string;
  readonly cityId: string | null;
  readonly channelId: string;
  readonly contactRemoteId: string;
  readonly contactName: string | null;
  /** Telefone do contato - PII cifrado no DB; retornado decifrado apenas com permissao. */
  readonly contactPhone: string | null;
  readonly leadId: string | null;
  readonly customerId: string | null;
  readonly status: ConversationStatus;
  readonly assignedUserId: string | null;
  readonly lastInboundAt: string | null;
  readonly lastMessageAt: string | null;
  readonly kind: ConversationKind;
  readonly unreadCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Payload interativo (jsonb do DB). */
export type InteractivePayloadDto =
  | {
      type: 'buttons';
      header?: string;
      body: string;
      footer?: string;
      buttons: Array<{ id: string; text: string }>;
    }
  | {
      type: 'list';
      header?: string;
      body: string;
      footer?: string;
      button: string;
      sections: Array<{
        title: string;
        rows: Array<{ id: string; title: string; description?: string }>;
      }>;
    }
  | { type: 'template'; name: string; languageCode: string; components: unknown[] };

/** Mensagem individual. */
export interface MessageDto {
  readonly id: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly direction: 'in' | 'out';
  readonly externalId: string | null;
  readonly type: MessageType;
  /** Conteudo da mensagem - PII; nao logar em producao. */
  readonly content: string | null;
  readonly mediaUrl: string | null;
  readonly mediaMime: string | null;
  readonly mediaSizeBytes: number | null;
  readonly mediaSha256: string | null;
  readonly interactivePayload: InteractivePayloadDto | null;
  readonly viewStatus: ViewStatus;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}
