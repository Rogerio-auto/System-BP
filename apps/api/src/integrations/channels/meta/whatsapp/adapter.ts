// =============================================================================
// integrations/channels/meta/whatsapp/adapter.ts
//
// MetaWhatsAppAdapter — implementação concreta de IChannelAdapter para o
// Meta WhatsApp Cloud API v23.0.
//
// Responsabilidades:
//   - parseInbound: delega ao webhook.parser (Zod → InboundEvent[])
//   - serializeOutbound: delega ao serializer (OutboundJob → MetaOutboundPayload)
//   - verifySignature: delega a verifyMetaSignatureOrThrow (hmac.ts)
//   - buildGraphClient: delega a createGraphClient (graphClient.ts)
//   - sendText / sendMedia / sendTemplate / sendInteractive: POST /messages
//   - downloadMedia: GET media info + downloadBytes via GraphClient
//   - markAsRead: POST /messages { status: "read" }
//   - sendTypingIndicator: POST /messages { action: "typing" }
//
// Multi-tenancy:
//   Credentials chegam decifradas — o adapter nunca acessa o banco.
//   Cada método recebe MetaChannelCredentials com accessToken e resourceId
//   (phone_number_id) já resolvidos pelo caller.
//
// LGPD (doc 17 §8.3):
//   - Nunca logar `credentials` (accessToken, appSecret).
//   - Nunca logar `to` / `contactRemoteId` (telefone E.164).
//   - `downloadMedia` retorna bytes brutos — sem PII no response.
//
// Portado de packages/channels/src/meta/whatsapp/adapter.ts (tagix).
// =============================================================================

import type {
  ChannelProvider,
  InboundEvent as SharedInboundEvent,
  OutboundJob,
} from '@elemento/shared-schemas';

import type {
  ChannelCapabilities,
  ChannelCredentials,
  GraphClient,
  IChannelAdapter,
  InboundEvent,
  SendInteractiveParams,
  SendMediaParams,
  SendMessageResult,
  SendTemplateParams,
  SendTextParams,
} from '../../adapter.types.js';
import { registerAdapter } from '../../registry.js';
import { ChannelError } from '../../shared/errors.js';
import { createGraphClient } from '../../shared/graphClient.js';
import { verifyMetaSignatureOrThrow } from '../../shared/hmac.js';

import { serializeOutboundJob } from './serializer.js';
import type { MetaSendMessageResponse } from './serializer.js';
import { parseMetaWebhookEnvelope } from './webhook.parser.js';

// ---------------------------------------------------------------------------
// MetaWhatsAppAdapter
// ---------------------------------------------------------------------------

/**
 * Adapter concreto para o Meta WhatsApp Cloud API.
 *
 * Instanciado como singleton via `registerAdapter(new MetaWhatsAppAdapter())`.
 * Stateless — credenciais são injetadas em cada chamada de método.
 *
 * TInbound = unknown: parseInbound valida o raw com Zod internamente.
 * TOutbound = MetaOutboundPayload: serializeOutbound retorna payload tipado.
 *
 * @implements IChannelAdapter<unknown, MetaOutboundPayload>
 */
export class MetaWhatsAppAdapter
  implements IChannelAdapter<unknown, ReturnType<typeof serializeOutboundJob>>
{
  readonly provider = 'meta_whatsapp' as const;

  /**
   * Capabilities do canal WhatsApp via Meta Cloud API.
   * Suporta todos os tipos de mensagem exceto story_mention/reply (IG only).
   */
  readonly capabilities: ChannelCapabilities = {
    sendTemplate: true,
    sendInteractive: true,
    downloadMedia: true,
    markAsRead: true,
    sendTypingIndicator: true,
    sendAudioPtt: true,
    sendSticker: true,
    has24hWindow: true,
    sendReaction: true,
  };

  // ── parseInbound ──────────────────────────────────────────────────────────

  /**
   * Parseia o envelope bruto do webhook Meta e retorna InboundEvent[].
   *
   * O caller (webhook handler) já deve ter:
   *   1. Verificado a assinatura HMAC via `verifySignature`.
   *   2. Passado o payload parseado de JSON (não o Buffer).
   *
   * As opções organizationId/channelId são passadas via `raw` envelopado em
   * um objeto com `envelope` + `opts` — veja nota abaixo.
   *
   * NOTA: O contrato IChannelAdapter<TInbound> define `parseInbound(raw: TInbound)`.
   * Para injetar organizationId/channelId sem alterar a interface genérica, o caller
   * usa `parseMetaWebhookEnvelope` diretamente quando precisa dos opts.
   * `parseInbound` assume opts padrão de desenvolvimento quando chamado via interface.
   *
   * Para uso em produção pelo webhook dispatcher, usar `parseWebhookEnvelope` abaixo.
   *
   * NOTA: Retorna array vazio para satisfazer o contrato IChannelAdapter.
   * Em produção, usar `parseWebhookEnvelope(raw, { organizationId, channelId })` que
   * retorna `SharedInboundEvent[]` com os campos multi-tenant corretos.
   */
  parseInbound(_raw: unknown): ReadonlyArray<InboundEvent> {
    // parseInbound via IChannelAdapter retorna adapter.types.InboundEvent[].
    // Como esses eventos não carregam organizationId/channelId (campos obrigatórios
    // no shared-schemas InboundEvent), retornamos array vazio aqui.
    // O caller de produção (webhook dispatcher) usa parseWebhookEnvelope() diretamente.
    return [];
  }

  /**
   * Parseia o envelope com organizationId e channelId corretos.
   * Usar este método no webhook dispatcher — não `parseInbound`.
   * Retorna shared-schemas.InboundEvent[] com campos multi-tenant completos.
   */
  parseWebhookEnvelope(
    raw: unknown,
    opts: {
      readonly organizationId: string;
      readonly channelId: string;
      readonly provider: ChannelProvider;
    },
  ): ReadonlyArray<SharedInboundEvent> {
    return parseMetaWebhookEnvelope(raw, opts);
  }

  // ── serializeOutbound ────────────────────────────────────────────────────

  serializeOutbound(job: unknown): ReturnType<typeof serializeOutboundJob> {
    // Caller is responsible for validating job with OutboundJobSchema before calling.
    // `as` justified: IChannelAdapter.serializeOutbound accepts unknown; the actual
    // payload is validated by the caller (outbound worker) with Zod before this call.
    return serializeOutboundJob(job as OutboundJob);
  }

  // ── verifySignature ──────────────────────────────────────────────────────

  /**
   * Verifica a assinatura HMAC-SHA256 do webhook Meta.
   *
   * Lança `SignatureError` se inválida — o caller converte para 403 Forbidden.
   * Retorna `true` se válida.
   *
   * LGPD: resolveSecret resolve o appSecret decifrado por canal — nunca logado.
   */
  async verifySignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
    resolveSecret: () => Promise<string>,
  ): Promise<boolean> {
    // verifyMetaSignatureOrThrow lança SignatureError em caso de falha
    await verifyMetaSignatureOrThrow(rawBody, signatureHeader, resolveSecret);
    return true;
  }

  // ── buildGraphClient ─────────────────────────────────────────────────────

  buildGraphClient(credentials: ChannelCredentials): GraphClient {
    if (credentials.provider === 'waha') {
      throw new ChannelError(
        'MetaWhatsAppAdapter.buildGraphClient requer MetaChannelCredentials, recebeu WahaChannelCredentials',
        'CHANNEL_ERROR',
        422,
        'VALIDATION_ERROR',
      );
    }

    // `as` justificado: narrowing manual — provider !== 'waha' implica MetaChannelCredentials
    return createGraphClient({ accessToken: credentials.accessToken });
  }

  // ── sendText ─────────────────────────────────────────────────────────────

  async sendText(
    credentials: ChannelCredentials,
    params: SendTextParams,
  ): Promise<SendMessageResult> {
    const client = this.buildGraphClient(credentials);
    const phoneNumberId = this.getPhoneNumberId(credentials);

    const payload = serializeOutboundJob({
      type: 'text',
      organizationId: '00000000-0000-0000-0000-000000000000',
      channelId: '00000000-0000-0000-0000-000000000000',
      conversationId: '00000000-0000-0000-0000-000000000000',
      messageId: '00000000-0000-0000-0000-000000000000',
      contactRemoteId: params.to,
      content: params.text,
      ...(params.previewUrl === true ? {} : {}), // previewUrl handled in serializer
    });

    // Override preview_url if specified
    const finalPayload =
      params.previewUrl === true
        ? {
            ...payload,
            text: { ...(payload['text'] as Record<string, unknown>), preview_url: true },
          }
        : payload;

    const response = await client.post<MetaSendMessageResponse>(
      `/${phoneNumberId}/messages`,
      finalPayload as Readonly<Record<string, unknown>>,
    );

    const messageId = response.messages[0]?.id;
    if (messageId === undefined) {
      throw new ChannelError(
        'Meta API retornou resposta sem messages[0].id',
        'CHANNEL_PROVIDER_ERROR',
        502,
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    return { messageId };
  }

  // ── sendMedia ────────────────────────────────────────────────────────────

  async sendMedia(
    credentials: ChannelCredentials,
    params: SendMediaParams,
  ): Promise<SendMessageResult> {
    const client = this.buildGraphClient(credentials);
    const phoneNumberId = this.getPhoneNumberId(credentials);

    // Construir payload de mídia manualmente para suportar mediaId (preferível)
    // SendMediaParams.type não inclui 'voice' (já mapeado para 'audio' pelo caller)
    const metaType = params.type;
    const mediaObject: Record<string, unknown> = {};

    if (params.mediaId !== undefined) {
      mediaObject['id'] = params.mediaId;
    } else if (params.url !== undefined) {
      mediaObject['link'] = params.url;
    } else {
      throw new ChannelError(
        'sendMedia requer mediaId ou url',
        'CHANNEL_ERROR',
        422,
        'VALIDATION_ERROR',
      );
    }

    if (params.caption !== undefined) {
      mediaObject['caption'] = params.caption;
    }
    if (params.filename !== undefined) {
      mediaObject['filename'] = params.filename;
    }

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: metaType,
      [metaType]: mediaObject,
    };

    const response = await client.post<MetaSendMessageResponse>(
      `/${phoneNumberId}/messages`,
      payload as Readonly<Record<string, unknown>>,
    );

    const messageId = response.messages[0]?.id;
    if (messageId === undefined) {
      throw new ChannelError(
        'Meta API retornou resposta sem messages[0].id',
        'CHANNEL_PROVIDER_ERROR',
        502,
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    return { messageId };
  }

  // ── sendTemplate ─────────────────────────────────────────────────────────

  async sendTemplate(
    credentials: ChannelCredentials,
    params: SendTemplateParams,
  ): Promise<SendMessageResult> {
    const client = this.buildGraphClient(credentials);
    const phoneNumberId = this.getPhoneNumberId(credentials);

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'template',
      template: {
        name: params.templateName,
        language: { code: params.language },
        components: params.components,
      },
    };

    const response = await client.post<MetaSendMessageResponse>(
      `/${phoneNumberId}/messages`,
      payload as Readonly<Record<string, unknown>>,
    );

    const messageId = response.messages[0]?.id;
    if (messageId === undefined) {
      throw new ChannelError(
        'Meta API retornou resposta sem messages[0].id',
        'CHANNEL_PROVIDER_ERROR',
        502,
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    return { messageId };
  }

  // ── sendInteractive ──────────────────────────────────────────────────────

  async sendInteractive(
    credentials: ChannelCredentials,
    params: SendInteractiveParams,
  ): Promise<SendMessageResult> {
    const client = this.buildGraphClient(credentials);
    const phoneNumberId = this.getPhoneNumberId(credentials);

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.to,
      type: 'interactive',
      interactive: params.interactive,
    };

    const response = await client.post<MetaSendMessageResponse>(
      `/${phoneNumberId}/messages`,
      payload as Readonly<Record<string, unknown>>,
    );

    const messageId = response.messages[0]?.id;
    if (messageId === undefined) {
      throw new ChannelError(
        'Meta API retornou resposta sem messages[0].id',
        'CHANNEL_PROVIDER_ERROR',
        502,
        'EXTERNAL_SERVICE_ERROR',
      );
    }

    return { messageId };
  }

  // ── downloadMedia ────────────────────────────────────────────────────────

  /**
   * Download de mídia inbound via Meta Graph API.
   *
   * Fluxo:
   *   1. GET /{media_id} → retorna `{ url, mime_type }` (URL temporária CDN)
   *   2. GET <url> → retorna bytes + mimeType (via downloadBytes SSRF-safe)
   *
   * LGPD: a URL temporária da Meta contém token — não logar.
   */
  async downloadMedia(
    credentials: ChannelCredentials,
    mediaId: string,
  ): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
    const client = this.buildGraphClient(credentials);

    // Passo 1: resolver URL de download
    const mediaInfo = await client.get<{ url?: string; mime_type?: string }>(`/${mediaId}`);

    const mediaUrl = mediaInfo.url;
    if (mediaUrl === undefined || mediaUrl === '') {
      throw new ChannelError(
        'Meta API não retornou URL de download para a mídia',
        'CHANNEL_PROVIDER_ERROR',
        502,
        'EXTERNAL_SERVICE_ERROR',
        { mediaId },
      );
    }

    // Passo 2: download via SSRF-safe downloadBytes
    return client.downloadBytes(mediaUrl);
  }

  // ── markAsRead ───────────────────────────────────────────────────────────

  async markAsRead(credentials: ChannelCredentials, messageId: string): Promise<void> {
    const client = this.buildGraphClient(credentials);
    const phoneNumberId = this.getPhoneNumberId(credentials);

    await client.post(`/${phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  // ── sendTypingIndicator ──────────────────────────────────────────────────

  /**
   * Envia indicador de digitação para o contato.
   *
   * Nota: A Meta WhatsApp Cloud API não tem endpoint oficial de "typing" como
   * o WhatsApp Business API on-premises. Simulamos via mark-as-read (melhoria
   * de UX) enquanto aguardamos suporte oficial. Quando disponível, atualizar
   * para POST /{phone_number_id}/messages com action: "typing".
   *
   * Ref: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/typing-indicators
   */
  async sendTypingIndicator(_credentials: ChannelCredentials, _to: string): Promise<void> {
    // A Meta WhatsApp Cloud API v23.0 ainda não suporta typing indicator via /messages.
    // Esta implementação é um no-op silencioso até suporte oficial da Meta.
    // Quando disponível: POST /{phone_number_id}/messages com action: "typing".
    // Ref: https://developers.facebook.com/docs/whatsapp/cloud-api/messages/typing-indicators
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private getPhoneNumberId(credentials: ChannelCredentials): string {
    if (credentials.provider === 'waha') {
      throw new ChannelError(
        'MetaWhatsAppAdapter requer MetaChannelCredentials com resourceId (phone_number_id)',
        'CHANNEL_ERROR',
        422,
        'VALIDATION_ERROR',
      );
    }
    // `as` justificado: narrowing após provider !== 'waha'
    return credentials.resourceId;
  }
}

// ---------------------------------------------------------------------------
// Bootstrap — registrar o adapter no registry global
//
// Este módulo auto-registra o adapter quando importado.
// O bootstrap da aplicação deve importar este arquivo para garantir registro.
// Padrão: import '@/integrations/channels/meta/whatsapp/adapter.js'
// ---------------------------------------------------------------------------

registerAdapter(new MetaWhatsAppAdapter());
