// =============================================================================
// livechat.ts - Schemas Zod compartilhados do dominio live chat.
// Portado do tagix (packages/channels/src/types.ts + packages/shared/src/types/interactive.ts).
//
// Multi-tenant: organizationId obrigatorio em InboundEvent e OutboundJob para
// roteamento por tenant em fila/socket. channelId obrigatorio em InboundEvent
// para lookup do adapter correto sem round-trip ao DB no worker.
//
// LGPD doc 17: Message.content pode ter PII - redact e responsabilidade do consumidor.
// Sem any. Tipos inferidos via z.infer.
// =============================================================================
import { z } from 'zod';

export const ChannelProviderSchema = z.enum(['meta_whatsapp', 'meta_instagram', 'waha']);
export type ChannelProvider = z.infer<typeof ChannelProviderSchema>;

export const MessageTypeSchema = z.enum([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'document',
  'sticker',
  'location',
  'contact',
  'interactive',
  'template',
  'reaction',
  'system',
  'story_mention',
  'story_reply',
  'share',
  'comment',
  'comment_reply',
  'ig_postback',
  'referral',
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const ViewStatusSchema = z.enum(['pending', 'sent', 'delivered', 'read', 'failed']);
export type ViewStatus = z.infer<typeof ViewStatusSchema>;

// ---------------------------------------------------------------------------
// Interactive payload schemas
// ---------------------------------------------------------------------------

export const InteractiveButtonsSchema = z.object({
  type: z.literal('buttons'),
  header: z.string().optional(),
  body: z.string().min(1),
  footer: z.string().optional(),
  buttons: z
    .array(z.object({ id: z.string().min(1), text: z.string().min(1).max(20) }))
    .min(1)
    .max(3),
});

export const InteractiveListSchema = z.object({
  type: z.literal('list'),
  header: z.string().optional(),
  body: z.string().min(1),
  footer: z.string().optional(),
  button: z.string().min(1),
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        rows: z
          .array(
            z.object({
              id: z.string().min(1),
              title: z.string().min(1).max(24),
              description: z.string().max(72).optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export const InteractiveTemplateSchema = z.object({
  type: z.literal('template'),
  name: z.string().min(1),
  languageCode: z.string().min(2).max(8),
  // TODO(F16): components mantido como z.array(z.unknown()) intencionalmente.
  // A estrutura de components dos templates Meta (header/body/button) nao esta
  // estabilizada — cada tipo (TEXT, IMAGE, DOCUMENT, VIDEO, CAROUSEL) usa shapes
  // diferentes e a Meta muda sem pre-aviso.
  // Decisao: validar apenas que e um array; validacao semantica fica no adapter (S04/S05)
  // que conhece o tipo especifico de template.
  // Revisar quando F16-S04 estabilizar os shapes de template suportados.
  components: z.array(z.unknown()),
});

export const InteractivePayloadSchema = z.discriminatedUnion('type', [
  InteractiveButtonsSchema,
  InteractiveListSchema,
  InteractiveTemplateSchema,
]);
export type InteractivePayload = z.infer<typeof InteractivePayloadSchema>;

// ---------------------------------------------------------------------------
// Media ref (inbound)
// ---------------------------------------------------------------------------

const MediaRefSchema = z.object({
  refOrUrl: z.string().min(1),
  mimeType: z.string().optional(),
  sha256: z.string().optional(),
  fileName: z.string().optional(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

// ---------------------------------------------------------------------------
// InboundEvent — discriminated union com organizationId + channelId obrigatorios.
//
// organizationId: roteamento por tenant (fila/socket).
// channelId: UUID do channel no DB; permite ao worker recuperar o adapter correto
//   e validar assinatura HMAC por-canal sem round-trip adicional.
// ---------------------------------------------------------------------------

export const InboundEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: ChannelProviderSchema,
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    messageType: MessageTypeSchema,
    content: z.string().optional(),
    mediaRef: MediaRefSchema.optional(),
    rawTimestamp: z.string().min(1),
    metadata: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('status'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: ChannelProviderSchema,
    externalId: z.string().min(1),
    status: z.enum(['sent', 'delivered', 'read', 'failed']),
    rawTimestamp: z.string().min(1),
  }),
  z.object({
    type: z.literal('story_mention'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    mediaRef: MediaRefSchema,
    storyId: z.string().min(1),
  }),
  z.object({
    type: z.literal('story_reply'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    storyId: z.string().min(1),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('share'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    mediaRef: MediaRefSchema,
  }),
  z.object({
    type: z.literal('comment'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.literal('meta_instagram'),
    mediaId: z.string().min(1),
    mediaKind: z.enum(['post', 'reel', 'story']).optional(),
    commentId: z.string().min(1),
    parentCommentId: z.string().optional(),
    fromIgsId: z.string().min(1),
    fromUsername: z.string().optional(),
    text: z.string().optional(),
  }),
  z.object({
    type: z.literal('postback'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    payload: z.string().min(1),
    title: z.string().optional(),
  }),
  z.object({
    type: z.literal('reaction'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: ChannelProviderSchema,
    contactRemoteId: z.string().min(1),
    targetExternalId: z.string().min(1),
    emoji: z.string().min(1),
  }),
  z.object({
    type: z.literal('referral'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    source: z.string().min(1),
    referralData: z.record(z.unknown()),
  }),
]);
export type InboundEvent = z.infer<typeof InboundEventSchema>;

// ---------------------------------------------------------------------------
// OutboundJob — discriminated union com organizationId obrigatorio.
//
// organizationId: roteamento por tenant e auditoria.
// channelId + conversationId + messageId: lookup no DB e idempotencia.
// ---------------------------------------------------------------------------

export const OutboundJobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    content: z.string().min(1),
    replyToExternalId: z.string().optional(),
  }),
  z.object({
    type: z.literal('media'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    mediaKind: z.enum(['image', 'video', 'audio', 'voice', 'document', 'sticker']),
    publicMediaUrl: z.string().url(),
    mime: z.string().min(1),
    caption: z.string().optional(),
    replyToExternalId: z.string().optional(),
  }),
  z.object({
    type: z.literal('template'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    templateName: z.string().min(1),
    languageCode: z.string().min(2).max(8),
    // TODO(F16): components mantido como z.array(z.unknown()) — ver comentario em InteractiveTemplateSchema.
    components: z.array(z.unknown()),
  }),
  z.object({
    type: z.literal('interactive'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    payload: InteractivePayloadSchema,
    replyToExternalId: z.string().optional(),
  }),
  z.object({
    type: z.literal('ig_private_reply'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    commentId: z.string().min(1),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('ig_public_reply'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    commentId: z.string().min(1),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('typing_indicator'),
    organizationId: z.string().uuid(),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    kind: z.enum(['typing', 'recording']),
  }),
]);
export type OutboundJob = z.infer<typeof OutboundJobSchema>;

// ---------------------------------------------------------------------------
// SendResult — resultado do envio pelo adapter
// ---------------------------------------------------------------------------

export const SendResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), externalId: z.string().min(1), raw: z.unknown().optional() }),
  z.object({
    ok: z.literal(false),
    errorCode: z.string().min(1),
    errorMessage: z.string().min(1),
    raw: z.unknown().optional(),
  }),
]);
export type SendResult = z.infer<typeof SendResultSchema>;
