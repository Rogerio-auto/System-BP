// =============================================================================
// livechat.ts - Schemas Zod compartilhados do dominio live chat.
// Portado do tagix (packages/channels/src/types.ts + packages/shared/src/types/interactive.ts).
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
  components: z.array(z.unknown()),
});

export const InteractivePayloadSchema = z.discriminatedUnion('type', [
  InteractiveButtonsSchema,
  InteractiveListSchema,
  InteractiveTemplateSchema,
]);
export type InteractivePayload = z.infer<typeof InteractivePayloadSchema>;

const MediaRefSchema = z.object({
  refOrUrl: z.string().min(1),
  mimeType: z.string().optional(),
  sha256: z.string().optional(),
  fileName: z.string().optional(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const InboundEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('message'),
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
    provider: ChannelProviderSchema,
    externalId: z.string().min(1),
    status: z.enum(['sent', 'delivered', 'read', 'failed']),
    rawTimestamp: z.string().min(1),
  }),
  z.object({
    type: z.literal('story_mention'),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    mediaRef: MediaRefSchema,
    storyId: z.string().min(1),
  }),
  z.object({
    type: z.literal('story_reply'),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    storyId: z.string().min(1),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('share'),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    mediaRef: MediaRefSchema,
  }),
  z.object({
    type: z.literal('comment'),
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
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    externalId: z.string().min(1),
    payload: z.string().min(1),
    title: z.string().optional(),
  }),
  z.object({
    type: z.literal('reaction'),
    provider: ChannelProviderSchema,
    contactRemoteId: z.string().min(1),
    targetExternalId: z.string().min(1),
    emoji: z.string().min(1),
  }),
  z.object({
    type: z.literal('referral'),
    provider: z.literal('meta_instagram'),
    contactRemoteId: z.string().min(1),
    source: z.string().min(1),
    referralData: z.record(z.unknown()),
  }),
]);
export type InboundEvent = z.infer<typeof InboundEventSchema>;

export const OutboundJobSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    content: z.string().min(1),
    replyToExternalId: z.string().optional(),
  }),
  z.object({
    type: z.literal('media'),
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
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    templateName: z.string().min(1),
    languageCode: z.string().min(2).max(8),
    components: z.array(z.unknown()),
  }),
  z.object({
    type: z.literal('interactive'),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    payload: InteractivePayloadSchema,
    replyToExternalId: z.string().optional(),
  }),
  z.object({
    type: z.literal('ig_private_reply'),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    commentId: z.string().min(1),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('ig_public_reply'),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    messageId: z.string().uuid(),
    commentId: z.string().min(1),
    content: z.string().min(1),
  }),
  z.object({
    type: z.literal('typing_indicator'),
    channelId: z.string().uuid(),
    conversationId: z.string().uuid(),
    contactRemoteId: z.string().min(1),
    kind: z.enum(['typing', 'recording']),
  }),
]);
export type OutboundJob = z.infer<typeof OutboundJobSchema>;

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
