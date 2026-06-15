// =============================================================================
// livechat.ts - Tipos puros (nao Zod) do dominio live chat.
// DTOs publicos sem campos de segredo (channel_secrets nunca exportados aqui).
// Espelha colunas seguras das tabelas channels/conversations/messages.
//
// LGPD (doc 17 §8.1):
//   - ChannelDto NAO inclui phoneNumber (PII cifrada no DB em phone_number_enc).
//     Use ConversationDetailDto (permissao crm:contact:phone:read) para obter
//     o numero decifrado de uma conversa especifica.
//   - ConversationDto (lista): sem contactPhone — listagem nao exige permissao de PII.
//   - ConversationDetailDto (detalhe): com contactPhone decifrado, requer permissao.
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

/**
 * Canal de comunicacao (sem access_token, sem app_secret, sem phoneNumber).
 *
 * LGPD L3: phoneNumber removido deste DTO publico.
 * Motivo: phone_number_enc no DB e PII cifrada (numero do canal/atendente).
 * Expor o numero decifrado aqui exigiria permissao crm:contact:phone:read
 * e endpoint protegido dedicado.
 * O phoneNumberId (ID tecnico da Meta) continua disponivel — nao e PII.
 * Se o front precisar exibir o numero, criar endpoint dedicado com permissao explicita.
 */
export interface ChannelDto {
  readonly id: string;
  readonly organizationId: string;
  readonly cityId: string | null;
  readonly provider: ChannelProvider;
  readonly name: string;
  readonly displayHandle: string | null;
  // WhatsApp — phoneNumberId e ID tecnico (Meta), nao PII
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

/**
 * Conversa (lista do inbox).
 *
 * LGPD M1: NAO inclui contactPhone.
 * Listagem de conversas nao requer permissao de PII de telefone.
 * Para obter o numero decifrado, use ConversationDetailDto (endpoint dedicado
 * com permissao crm:contact:phone:read verificada no servidor).
 */
export interface ConversationDto {
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
  readonly unreadCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Detalhe de conversa — inclui PII decifrada de telefone.
 *
 * LGPD M1: Retornado APENAS pelo endpoint de detalhe que verifica a permissao
 * crm:contact:phone:read antes de decifrar e incluir o numero.
 * NAO usar em listagens. NAO logar sem redact.
 */
export interface ConversationDetailDto extends ConversationDto {
  /**
   * Telefone do contato decifrado (doc 17 §8.1).
   * null se o provider nao enviar telefone (ex: Instagram DM)
   * ou se o campo ainda nao foi preenchido.
   * LGPD: PII — nao logar sem redact. Permissao: crm:contact:phone:read.
   */
  readonly contactPhone: string | null;
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
