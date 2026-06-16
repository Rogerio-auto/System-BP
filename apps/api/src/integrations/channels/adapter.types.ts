// =============================================================================
// integrations/channels/adapter.types.ts — Contrato público do IChannelAdapter.
//
// IChannelAdapter é a interface única que todos os adapters de canal (WhatsApp,
// Instagram, WAHA) devem implementar. Isso permite que o pipeline de mensagens
// (inbound worker, outbound worker, webhook dispatcher) seja completamente agnóstico
// de provider — apenas importa IChannelAdapter e chama os métodos definidos aqui.
//
// Decisão D2 (planejamento §3): `packages/channels` é a joia da coroa; interfaces
// definidas aqui vão ser usadas em S05 (WhatsApp adapter) e fases futuras (IG, WAHA).
//
// Decisão D3 (app-por-cliente): o adapter recebe credenciais já decifradas
// do `channel_secrets`. O adapter NUNCA acessa o banco diretamente para buscar
// segredos — o caller (registry ou factory) resolve e injeta.
//
// LGPD (doc 17): credenciais são tratadas como PII altamente sensível.
// Nunca logar `credentials`. Nunca retornar em DTOs.
// =============================================================================

// ---------------------------------------------------------------------------
// Provider enum — domínio dos providers suportados
// ---------------------------------------------------------------------------

/**
 * Providers de canal suportados.
 * Alinhado com o CHECK de domínio `channels.provider` no DB (F16-S02).
 */
export type ChannelProvider = 'meta_whatsapp' | 'meta_instagram' | 'waha';

// ---------------------------------------------------------------------------
// Credenciais — injetadas pelo caller após decifragem de channel_secrets
// ---------------------------------------------------------------------------

/**
 * Credenciais decifradas para um canal Meta (WhatsApp ou Instagram).
 * Vêm de `channel_secrets.access_token_enc` e `channel_secrets.app_secret_enc`
 * após `decryptPii()`. NUNCA armazenar em log ou retornar em DTO.
 */
export interface MetaChannelCredentials {
  readonly provider: 'meta_whatsapp' | 'meta_instagram';
  /** Access token decifrado (System User Token para WA; Page token para IG). */
  readonly accessToken: string;
  /** App secret decifrado (usado para verificação HMAC de webhook). */
  readonly appSecret: string;
  /** Phone number ID (meta_whatsapp) ou IG User ID (meta_instagram). */
  readonly resourceId: string;
  /** WABA ID (meta_whatsapp) ou FB Page ID (meta_instagram). */
  readonly accountId: string;
  /** Meta App ID — um por cliente no modo app-por-cliente (§5.2). */
  readonly metaAppId: string;
}

/**
 * Credenciais decifradas para um canal WAHA (API não-oficial).
 */
export interface WahaChannelCredentials {
  readonly provider: 'waha';
  /** URL base do servidor WAHA (ex: http://waha.internal:3000). */
  readonly baseUrl: string;
  /** API key decifrada do servidor WAHA. */
  readonly apiKey: string;
  /** Session ID da sessão WAHA. */
  readonly sessionId: string;
}

/** Union discriminada de credenciais por provider. */
export type ChannelCredentials = MetaChannelCredentials | WahaChannelCredentials;

// ---------------------------------------------------------------------------
// Tipos de mensagem de entrada (inbound)
// ---------------------------------------------------------------------------

/** Tipos de mensagem suportados no inbound. */
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
  | 'story_mention'
  | 'story_reply'
  | 'share'
  | 'comment'
  | 'postback'
  | 'referral'
  | 'unsupported';

/** Localização geográfica enviada pelo contato. */
export interface LocationPayload {
  readonly latitude: number;
  readonly longitude: number;
  readonly name?: string | undefined;
  readonly address?: string | undefined;
}

/** Arquivo de mídia recebido/enviado (image, video, audio, document, sticker). */
export interface MediaPayload {
  /** ID opaco do provider (ex: `id` na Graph API). Preferir ao link. */
  readonly mediaId?: string | undefined;
  /** URL direta (evitar — usar apenas quando mediaId não disponível). */
  readonly url?: string | undefined;
  /** MIME type do arquivo. */
  readonly mimeType?: string | undefined;
  /** Nome do arquivo original (document). */
  readonly filename?: string | undefined;
  /** SHA-256 do arquivo (quando disponível do provider). */
  readonly sha256?: string | undefined;
  /** Tamanho em bytes (quando disponível). */
  readonly fileSize?: number | undefined;
  /** Caption/legenda da mídia. */
  readonly caption?: string | undefined;
}

/** Reação a uma mensagem (emoji). */
export interface ReactionPayload {
  /** WAMID da mensagem que recebeu a reação. */
  readonly messageId: string;
  /** Emoji da reação (string Unicode, ex: "👍"). Vazio = remoção de reação. */
  readonly emoji: string;
}

/** Mensagem inbound normalizada pelo adapter. */
export interface InboundMessage {
  /** ID único da mensagem no provider (ex: wamid_xxx para WhatsApp). */
  readonly messageId: string;
  /** Número/ID do remetente (phone E.164 para WA; ig_user_id para IG). */
  readonly from: string;
  /** Timestamp Unix em segundos da mensagem. */
  readonly timestamp: number;
  /** Tipo da mensagem. */
  readonly type: MessageType;
  /** Conteúdo texto (para type=text ou captions de mídia). */
  readonly text?: string | undefined;
  /** Payload de mídia (image, video, audio, document, sticker, voice). */
  readonly media?: MediaPayload | undefined;
  /** Payload de localização. */
  readonly location?: LocationPayload | undefined;
  /** Payload de reação. */
  readonly reaction?: ReactionPayload | undefined;
  /** Contexto de reply (messageId da mensagem original). */
  readonly replyTo?: string | undefined;
  /** Payload bruto do provider (para diagnóstico — não expor em DTO). */
  readonly raw: unknown;
}

/** Evento de status de mensagem (entregue, lida, falhou). */
export interface MessageStatusEvent {
  readonly messageId: string;
  readonly recipientId: string;
  readonly status: 'sent' | 'delivered' | 'read' | 'failed';
  readonly timestamp: number;
  readonly error?: { readonly code: number; readonly title: string } | undefined;
}

/** Evento inbound normalizado: mensagem ou status. */
export type InboundEvent =
  | { readonly kind: 'message'; readonly payload: InboundMessage }
  | { readonly kind: 'status'; readonly payload: MessageStatusEvent };

// ---------------------------------------------------------------------------
// Tipos de mensagem de saída (outbound)
// ---------------------------------------------------------------------------

/** Parâmetro de componente de template (HSM). */
export interface TemplateTextParameter {
  readonly type: 'text';
  readonly text: string;
}

export interface TemplateImageParameter {
  readonly type: 'image';
  readonly image: { readonly id: string } | { readonly link: string };
}

export interface TemplateDocumentParameter {
  readonly type: 'document';
  readonly document:
    | { readonly id: string; readonly filename?: string | undefined }
    | { readonly link: string; readonly filename?: string | undefined };
}

export type TemplateParameter =
  | TemplateTextParameter
  | TemplateImageParameter
  | TemplateDocumentParameter;

/** Componente de template (header, body, button). */
export interface TemplateComponent {
  readonly type: 'header' | 'body' | 'button';
  readonly sub_type?: 'quick_reply' | 'url' | undefined;
  readonly index?: number | undefined;
  readonly parameters: ReadonlyArray<TemplateParameter>;
}

/** Botão de resposta rápida para mensagens interativas. */
export interface QuickReplyButton {
  readonly type: 'reply';
  readonly reply: { readonly id: string; readonly title: string };
}

/** Botão de URL para mensagens interativas. */
export interface UrlButton {
  readonly type: 'url';
  readonly title: string;
  readonly url: string;
}

/** Item de lista para mensagens interativas. */
export interface ListSection {
  readonly title?: string | undefined;
  readonly rows: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly description?: string | undefined;
  }>;
}

/** Payload de mensagem interativa (botões ou lista). */
export type InteractivePayload =
  | {
      readonly type: 'button';
      readonly body: { readonly text: string };
      readonly action: { readonly buttons: ReadonlyArray<QuickReplyButton | UrlButton> };
      readonly header?: { readonly type: 'text'; readonly text: string } | undefined;
      readonly footer?: { readonly text: string } | undefined;
    }
  | {
      readonly type: 'list';
      readonly body: { readonly text: string };
      readonly action: {
        readonly button: string;
        readonly sections: ReadonlyArray<ListSection>;
      };
      readonly header?: { readonly type: 'text'; readonly text: string } | undefined;
      readonly footer?: { readonly text: string } | undefined;
    };

/** Parâmetros para envio de texto simples. */
export interface SendTextParams {
  /** Destinatário (phone E.164 para WA; ig_user_id para IG). */
  readonly to: string;
  readonly text: string;
  /** Habilitar preview de URL no app. */
  readonly previewUrl?: boolean | undefined;
}

/** Parâmetros para envio de mídia (image, video, audio, document, sticker). */
export interface SendMediaParams {
  readonly to: string;
  readonly type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  /** Usar mediaId (preferível — sem URL pública com PII). */
  readonly mediaId?: string | undefined;
  /** URL direta (fallback quando mediaId não disponível). */
  readonly url?: string | undefined;
  readonly mimeType?: string | undefined;
  readonly filename?: string | undefined;
  readonly caption?: string | undefined;
}

/** Parâmetros para envio de template aprovado (HSM). */
export interface SendTemplateParams {
  readonly to: string;
  readonly templateName: string;
  readonly language: string;
  readonly components: ReadonlyArray<TemplateComponent>;
}

/** Parâmetros para mensagem interativa. */
export interface SendInteractiveParams {
  readonly to: string;
  readonly interactive: InteractivePayload;
}

/** Resultado de envio de mensagem. */
export interface SendMessageResult {
  /** ID da mensagem no provider (wamid para WA). */
  readonly messageId: string;
}

// ---------------------------------------------------------------------------
// Capabilities — o adapter declara o que suporta
// ---------------------------------------------------------------------------

/**
 * Declaração de capacidades do canal.
 * Permite que o pipeline verifique suporte a features antes de tentar enviá-las.
 * Ex: WAHA não suporta templates HSM; IG não suporta audio PTT.
 */
export interface ChannelCapabilities {
  /** Suporta envio de templates HSM aprovados pela Meta. */
  readonly sendTemplate: boolean;
  /** Suporta mensagens interativas (botões/lista). */
  readonly sendInteractive: boolean;
  /** Suporta download de mídia inbound. */
  readonly downloadMedia: boolean;
  /** Suporta marcar mensagem como lida. */
  readonly markAsRead: boolean;
  /** Suporta indicador de digitação. */
  readonly sendTypingIndicator: boolean;
  /** Suporta envio de áudio PTT (voice note). */
  readonly sendAudioPtt: boolean;
  /** Suporta envio de sticker. */
  readonly sendSticker: boolean;
  /** Tem janela de 24h (Meta free-form window). */
  readonly has24hWindow: boolean;
  /** Suporta reações a mensagens. */
  readonly sendReaction: boolean;
}

// ---------------------------------------------------------------------------
// IChannelAdapter — contrato principal
// ---------------------------------------------------------------------------

/**
 * Interface que todos os adapters de canal devem implementar.
 *
 * Cada método recebe credenciais já decifradas (do `channel_secrets`) — nunca
 * cifradas. O adapter é instanciado por requisição/canal via `getAdapter()`.
 *
 * Decisão D3 (planejamento §5.3): credenciais são por canal/app.
 * O caller (webhook dispatcher, outbound worker) é responsável por resolver
 * e injetar as credenciais corretas antes de chamar o adapter.
 *
 * @typeParam TInbound  Tipo do payload bruto de entrada do provider.
 * @typeParam TOutbound Tipo do payload bruto de saída antes da serialização.
 */
export interface IChannelAdapter<TInbound = unknown, TOutbound = unknown> {
  /** Provider que este adapter implementa. */
  readonly provider: ChannelProvider;

  /** Declaração estática de capacidades do canal. */
  readonly capabilities: ChannelCapabilities;

  /**
   * Analisa o payload bruto do webhook e retorna eventos normalizados.
   * Cada entrada no array é um evento independente (uma mensagem, um status update).
   *
   * @param raw  Payload bruto do webhook do provider (já parseado de JSON).
   * @returns    Array de eventos normalizados (vazio se payload não tiver eventos relevantes).
   * @throws     `UnsupportedMessageTypeError` se o tipo não for suportado e deve ser ignorado.
   */
  parseInbound(raw: TInbound): ReadonlyArray<InboundEvent>;

  /**
   * Serializa um job de saída para o formato nativo do provider.
   * Usado pelo outbound worker antes de chamar `sendText`/`sendMedia`/etc.
   *
   * @param job  Job de mensagem normalizado.
   * @returns    Payload no formato do provider.
   */
  serializeOutbound(job: unknown): TOutbound;

  /**
   * Verifica a assinatura HMAC do webhook com o `app_secret` do canal.
   * Cada canal tem seu próprio `app_secret` (modelo app-por-cliente, §5.3).
   *
   * @param rawBody         Buffer com o corpo bruto da requisição.
   * @param signatureHeader Valor do header `X-Hub-Signature-256` (ex: "sha256=abc123…").
   * @param resolveSecret   Callback assíncrono que busca o `app_secret` para o canal.
   * @returns               `true` se válida; `false` se inválida.
   */
  verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    resolveSecret: () => Promise<string>,
  ): Promise<boolean>;

  /**
   * Constrói uma instância do GraphClient configurada para este canal.
   * O cliente é configurado com o `accessToken` decifrado das credenciais.
   *
   * @param credentials  Credenciais decifradas do `channel_secrets`.
   * @returns            Instância de `GraphClient` configurada para o canal.
   */
  buildGraphClient(credentials: ChannelCredentials): GraphClient;

  /** Envia mensagem de texto simples. */
  sendText(credentials: ChannelCredentials, params: SendTextParams): Promise<SendMessageResult>;

  /** Envia mídia (imagem, vídeo, áudio, documento, sticker). */
  sendMedia(credentials: ChannelCredentials, params: SendMediaParams): Promise<SendMessageResult>;

  /**
   * Envia template aprovado (HSM). Verificar `capabilities.sendTemplate` antes.
   * @throws `UnsupportedMessageTypeError` se o adapter não suporta templates.
   */
  sendTemplate(
    credentials: ChannelCredentials,
    params: SendTemplateParams,
  ): Promise<SendMessageResult>;

  /**
   * Envia mensagem interativa (botões/lista). Verificar `capabilities.sendInteractive` antes.
   * @throws `UnsupportedMessageTypeError` se o adapter não suporta interativos.
   */
  sendInteractive(
    credentials: ChannelCredentials,
    params: SendInteractiveParams,
  ): Promise<SendMessageResult>;

  /**
   * Faz download de mídia inbound via URL/ID do provider.
   * Verificar `capabilities.downloadMedia` antes.
   *
   * @returns Buffer com os bytes da mídia.
   * @throws `UnsupportedMessageTypeError` se o adapter não suporta download.
   */
  downloadMedia(
    credentials: ChannelCredentials,
    mediaId: string,
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }>;

  /**
   * Marca uma mensagem inbound como lida no provider.
   * Verificar `capabilities.markAsRead` antes.
   *
   * @param messageId  ID da mensagem no provider.
   */
  markAsRead(credentials: ChannelCredentials, messageId: string): Promise<void>;

  /**
   * Envia indicador de digitação ("typing...") para o contato.
   * Verificar `capabilities.sendTypingIndicator` antes.
   */
  sendTypingIndicator(credentials: ChannelCredentials, to: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// GraphClient — interface do cliente HTTP da Meta Graph API
// ---------------------------------------------------------------------------

/**
 * Opções de uma requisição ao GraphClient.
 */
export interface GraphRequestOptions {
  /** Parâmetros de query string. */
  readonly params?: Readonly<Record<string, string>> | undefined;
  /** Timeout da requisição em ms (default: 30s). */
  readonly timeoutMs?: number | undefined;
}

/**
 * Cliente HTTP tipado para a Meta Graph API (graph.facebook.com v23.0).
 *
 * Responsabilidades:
 *   - Auth via Bearer token (injetado no construtor).
 *   - Retry com backoff exponencial em 429/5xx.
 *   - Timeout configurável por requisição.
 *   - Allowlist de host (apenas graph.facebook.com — proteção SSRF).
 *   - LGPD: access token nunca exposto em logs/erros.
 */
export interface GraphClient {
  /**
   * Requisição GET tipada.
   * @param path    Path relativo à versão (ex: "/me/messages").
   * @param options Parâmetros opcionais.
   * @returns       Resposta parseada como TResponse.
   */
  get<TResponse>(path: string, options?: GraphRequestOptions): Promise<TResponse>;

  /**
   * Requisição POST com body JSON.
   * @param path    Path relativo à versão (ex: "/{phone_number_id}/messages").
   * @param body    Body a ser serializado como JSON.
   * @param options Parâmetros opcionais.
   */
  post<TResponse>(
    path: string,
    body: Readonly<Record<string, unknown>>,
    options?: GraphRequestOptions,
  ): Promise<TResponse>;

  /**
   * Requisição POST com FormData (upload de mídia).
   * @param path    Path relativo à versão (ex: "/{phone_number_id}/media").
   * @param form    FormData com o arquivo e metadados.
   * @param options Parâmetros opcionais.
   */
  postForm<TResponse>(
    path: string,
    form: FormData,
    options?: GraphRequestOptions,
  ): Promise<TResponse>;

  /**
   * Download de bytes (para mídia inbound).
   * Valida que a URL pertence ao allowlist de hosts antes de fazer o fetch.
   *
   * @param url     URL completa do arquivo (deve estar no allowlist).
   * @param options Parâmetros opcionais.
   * @returns       Buffer com os bytes e mimeType do Content-Type header.
   */
  downloadBytes(
    url: string,
    options?: GraphRequestOptions,
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }>;
}
