import { describe, it, expect } from 'vitest';

import {
  ChannelProviderSchema,
  MessageTypeSchema,
  InteractivePayloadSchema,
  InboundEventSchema,
  OutboundJobSchema,
  SendResultSchema,
  ViewStatusSchema,
  MEDIA_MAX_BYTES_ANY,
  WHATSAPP_MEDIA_MAX_BYTES,
  mediaKindFromMime,
  maxUploadBytesForMime,
  formatMaxBytes,
} from '../livechat.js';

// ---------------------------------------------------------------------------
// Fixtures reutilizaveis
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000000';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000001';
const CONVERSATION_ID = '00000000-0000-0000-0000-000000000002';
const MESSAGE_ID = '00000000-0000-0000-0000-000000000003';

// ---------------------------------------------------------------------------
// ChannelProviderSchema
// ---------------------------------------------------------------------------

describe('ChannelProviderSchema', () => {
  it('aceita providers validos', () => {
    expect(ChannelProviderSchema.parse('meta_whatsapp')).toBe('meta_whatsapp');
    expect(ChannelProviderSchema.parse('meta_instagram')).toBe('meta_instagram');
    expect(ChannelProviderSchema.parse('waha')).toBe('waha');
  });
  it('rejeita provider invalido', () => {
    expect(() => ChannelProviderSchema.parse('chatwoot')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MessageTypeSchema
// ---------------------------------------------------------------------------

describe('MessageTypeSchema', () => {
  it('aceita todos os 21 tipos', () => {
    const types = [
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
    ];
    for (const t of types) {
      expect(MessageTypeSchema.parse(t)).toBe(t);
    }
  });
  it('rejeita tipo desconhecido', () => {
    expect(() => MessageTypeSchema.parse('unknown_type')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// InteractivePayloadSchema
// ---------------------------------------------------------------------------

describe('InteractivePayloadSchema', () => {
  it('aceita botoes valido', () => {
    const r = InteractivePayloadSchema.parse({
      type: 'buttons',
      body: 'Escolha',
      buttons: [{ id: 'b1', text: 'A' }],
    });
    expect(r.type).toBe('buttons');
  });
  it('rejeita botoes com mais de 3', () => {
    expect(() =>
      InteractivePayloadSchema.parse({
        type: 'buttons',
        body: 'x',
        buttons: [
          { id: '1', text: 'A' },
          { id: '2', text: 'B' },
          { id: '3', text: 'C' },
          { id: '4', text: 'D' },
        ],
      }),
    ).toThrow();
  });
  it('rejeita botoes com lista vazia', () => {
    expect(() =>
      InteractivePayloadSchema.parse({
        type: 'buttons',
        body: 'x',
        buttons: [],
      }),
    ).toThrow();
  });
  it('aceita lista valida', () => {
    const r = InteractivePayloadSchema.parse({
      type: 'list',
      body: 'Selecione',
      button: 'Ver',
      sections: [{ title: 'S1', rows: [{ id: 'r1', title: 'Item' }] }],
    });
    expect(r.type).toBe('list');
  });
  it('rejeita lista com rows vazio', () => {
    expect(() =>
      InteractivePayloadSchema.parse({
        type: 'list',
        body: 'x',
        button: 'Ver',
        sections: [{ title: 'S1', rows: [] }],
      }),
    ).toThrow();
  });
  it('aceita template valido', () => {
    const r = InteractivePayloadSchema.parse({
      type: 'template',
      name: 'bv',
      languageCode: 'pt_BR',
      components: [],
    });
    expect(r.type).toBe('template');
  });
  it('rejeita tipo desconhecido', () => {
    expect(() => InteractivePayloadSchema.parse({ type: 'carousel', items: [] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// InboundEventSchema
// ---------------------------------------------------------------------------

describe('InboundEventSchema', () => {
  it('aceita evento de mensagem com organizationId e channelId', () => {
    const e = InboundEventSchema.parse({
      type: 'message',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_whatsapp',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.x',
      messageType: 'text',
      rawTimestamp: '2026-06-14T00:00:00Z',
    });
    expect(e.type).toBe('message');
    expect(e.organizationId).toBe(ORG_ID);
    expect(e.channelId).toBe(CHANNEL_ID);
  });
  it('aceita evento de mensagem com midia', () => {
    const e = InboundEventSchema.parse({
      type: 'message',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_whatsapp',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.y',
      messageType: 'image',
      mediaRef: { refOrUrl: 'https://example.com/img.jpg', mimeType: 'image/jpeg' },
      rawTimestamp: '2026-06-14T00:00:00Z',
    });
    expect(e.type).toBe('message');
    if (e.type === 'message') {
      expect(e.messageType).toBe('image');
    }
  });
  it('aceita evento de status', () => {
    const e = InboundEventSchema.parse({
      type: 'status',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_whatsapp',
      externalId: 'wamid.x',
      status: 'delivered',
      rawTimestamp: '2026-06-14T00:00:00Z',
    });
    expect(e.type).toBe('status');
    expect(e.organizationId).toBe(ORG_ID);
  });
  it('aceita comment IG', () => {
    const e = InboundEventSchema.parse({
      type: 'comment',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_instagram',
      mediaId: 'mid123',
      commentId: 'cid456',
      fromIgsId: 'uid789',
    });
    expect(e.type).toBe('comment');
  });
  it('aceita reacao', () => {
    const e = InboundEventSchema.parse({
      type: 'reaction',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_whatsapp',
      contactRemoteId: '+5511999990000',
      targetExternalId: 'wamid.t',
      emoji: 'like',
    });
    expect(e.type).toBe('reaction');
  });
  it('aceita story_mention IG', () => {
    const e = InboundEventSchema.parse({
      type: 'story_mention',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_instagram',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.sm',
      mediaRef: { refOrUrl: 'https://cdn.ig.com/story.mp4' },
      storyId: 'sid1',
    });
    expect(e.type).toBe('story_mention');
  });
  it('aceita story_reply IG', () => {
    const e = InboundEventSchema.parse({
      type: 'story_reply',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_instagram',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.sr',
      storyId: 'sid2',
      content: 'Adorei!',
    });
    expect(e.type).toBe('story_reply');
  });
  it('aceita postback IG', () => {
    const e = InboundEventSchema.parse({
      type: 'postback',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_instagram',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.pb',
      payload: 'MENU_PRINCIPAL',
    });
    expect(e.type).toBe('postback');
  });
  it('aceita referral IG', () => {
    const e = InboundEventSchema.parse({
      type: 'referral',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_instagram',
      contactRemoteId: '+5511999990000',
      source: 'https://instagram.com/p/abc',
      referralData: { ref: 'promo' },
    });
    expect(e.type).toBe('referral');
  });
  it('aceita share IG', () => {
    const e = InboundEventSchema.parse({
      type: 'share',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_instagram',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.sh',
      mediaRef: { refOrUrl: 'https://cdn.ig.com/share.mp4' },
    });
    expect(e.type).toBe('share');
  });
  it('rejeita tipo desconhecido', () => {
    expect(() =>
      InboundEventSchema.parse({
        type: 'unknown',
        organizationId: ORG_ID,
        channelId: CHANNEL_ID,
        provider: 'meta_whatsapp',
      }),
    ).toThrow();
  });
  it('rejeita mensagem sem externalId', () => {
    expect(() =>
      InboundEventSchema.parse({
        type: 'message',
        organizationId: ORG_ID,
        channelId: CHANNEL_ID,
        provider: 'meta_whatsapp',
        contactRemoteId: '+5511999990000',
        messageType: 'text',
        rawTimestamp: '2026-06-14T00:00:00Z',
      }),
    ).toThrow();
  });
  it('rejeita evento sem organizationId', () => {
    expect(() =>
      InboundEventSchema.parse({
        type: 'message',
        channelId: CHANNEL_ID,
        provider: 'meta_whatsapp',
        contactRemoteId: '+5511999990000',
        externalId: 'wamid.x',
        messageType: 'text',
        rawTimestamp: '2026-06-14T00:00:00Z',
      }),
    ).toThrow();
  });
  it('rejeita evento sem channelId', () => {
    expect(() =>
      InboundEventSchema.parse({
        type: 'message',
        organizationId: ORG_ID,
        provider: 'meta_whatsapp',
        contactRemoteId: '+5511999990000',
        externalId: 'wamid.x',
        messageType: 'text',
        rawTimestamp: '2026-06-14T00:00:00Z',
      }),
    ).toThrow();
  });
  it('rejeita organizationId com formato invalido (nao UUID)', () => {
    expect(() =>
      InboundEventSchema.parse({
        type: 'message',
        organizationId: 'nao-um-uuid',
        channelId: CHANNEL_ID,
        provider: 'meta_whatsapp',
        contactRemoteId: '+5511999990000',
        externalId: 'wamid.x',
        messageType: 'text',
        rawTimestamp: '2026-06-14T00:00:00Z',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// OutboundJobSchema
// ---------------------------------------------------------------------------

const BASE_OUTBOUND = {
  organizationId: ORG_ID,
  channelId: CHANNEL_ID,
  conversationId: CONVERSATION_ID,
  messageId: MESSAGE_ID,
};

describe('OutboundJobSchema', () => {
  it('aceita job de texto com organizationId', () => {
    const j = OutboundJobSchema.parse({
      ...BASE_OUTBOUND,
      type: 'text',
      contactRemoteId: '+5511999990000',
      content: 'Ola',
    });
    expect(j.type).toBe('text');
    expect(j.organizationId).toBe(ORG_ID);
  });
  it('aceita job de midia', () => {
    const j = OutboundJobSchema.parse({
      ...BASE_OUTBOUND,
      type: 'media',
      contactRemoteId: '+5511999990000',
      mediaKind: 'image',
      publicMediaUrl: 'https://r2.example.com/img.jpg',
      mime: 'image/jpeg',
    });
    expect(j.type).toBe('media');
  });
  it('aceita job de template', () => {
    const j = OutboundJobSchema.parse({
      ...BASE_OUTBOUND,
      type: 'template',
      contactRemoteId: '+5511999990000',
      templateName: 'boas_vindas',
      languageCode: 'pt_BR',
      components: [],
    });
    expect(j.type).toBe('template');
  });
  it('aceita job interativo', () => {
    const j = OutboundJobSchema.parse({
      ...BASE_OUTBOUND,
      type: 'interactive',
      contactRemoteId: '+5511999990000',
      payload: {
        type: 'buttons',
        body: 'Escolha',
        buttons: [{ id: 'b1', text: 'Opcao A' }],
      },
    });
    expect(j.type).toBe('interactive');
  });
  it('aceita typing_indicator', () => {
    const j = OutboundJobSchema.parse({
      ...BASE_OUTBOUND,
      type: 'typing_indicator',
      contactRemoteId: '+5511999990000',
      kind: 'typing',
    });
    expect(j.type).toBe('typing_indicator');
  });
  it('aceita ig_private_reply', () => {
    const j = OutboundJobSchema.parse({
      ...BASE_OUTBOUND,
      type: 'ig_private_reply',
      commentId: 'cid123',
      content: 'Obrigado!',
    });
    expect(j.type).toBe('ig_private_reply');
  });
  it('aceita ig_public_reply', () => {
    const j = OutboundJobSchema.parse({
      ...BASE_OUTBOUND,
      type: 'ig_public_reply',
      commentId: 'cid456',
      content: 'Respondendo publicamente.',
    });
    expect(j.type).toBe('ig_public_reply');
  });
  it('rejeita mediaUrl invalida', () => {
    expect(() =>
      OutboundJobSchema.parse({
        ...BASE_OUTBOUND,
        type: 'media',
        contactRemoteId: '+5511999990000',
        mediaKind: 'image',
        publicMediaUrl: 'nao-url',
        mime: 'image/jpeg',
      }),
    ).toThrow();
  });
  it('rejeita channelId invalido (nao UUID)', () => {
    expect(() =>
      OutboundJobSchema.parse({
        organizationId: ORG_ID,
        channelId: 'nao-uuid',
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        type: 'text',
        contactRemoteId: '+5511999990000',
        content: 'x',
      }),
    ).toThrow();
  });
  it('rejeita outbound sem organizationId', () => {
    expect(() =>
      OutboundJobSchema.parse({
        channelId: CHANNEL_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        type: 'text',
        contactRemoteId: '+5511999990000',
        content: 'x',
      }),
    ).toThrow();
  });
  it('rejeita organizationId com formato invalido (nao UUID)', () => {
    expect(() =>
      OutboundJobSchema.parse({
        organizationId: 'nao-uuid',
        channelId: CHANNEL_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        type: 'text',
        contactRemoteId: '+5511999990000',
        content: 'x',
      }),
    ).toThrow();
  });
  it('rejeita typing_indicator com kind invalido', () => {
    expect(() =>
      OutboundJobSchema.parse({
        ...BASE_OUTBOUND,
        type: 'typing_indicator',
        contactRemoteId: '+5511999990000',
        kind: 'idle',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SendResultSchema
// ---------------------------------------------------------------------------

describe('SendResultSchema', () => {
  it('aceita sucesso com externalId', () => {
    const r = SendResultSchema.parse({ ok: true, externalId: 'wamid.x' });
    expect(r.ok).toBe(true);
  });
  it('aceita sucesso com raw opcional', () => {
    const r = SendResultSchema.parse({ ok: true, externalId: 'wamid.y', raw: { meta: true } });
    expect(r.ok).toBe(true);
  });
  it('aceita falha com errorCode', () => {
    const r = SendResultSchema.parse({
      ok: false,
      errorCode: 'META_130429',
      errorMessage: 'Rate limit',
    });
    expect(r.ok).toBe(false);
  });
  it('rejeita sucesso sem externalId', () => {
    expect(() => SendResultSchema.parse({ ok: true })).toThrow();
  });
  it('rejeita falha sem errorCode', () => {
    expect(() => SendResultSchema.parse({ ok: false, errorMessage: 'x' })).toThrow();
  });
  it('rejeita falha sem errorMessage', () => {
    expect(() => SendResultSchema.parse({ ok: false, errorCode: 'ERR_X' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ViewStatusSchema
// ---------------------------------------------------------------------------

describe('ViewStatusSchema', () => {
  it('aceita todos os status validos', () => {
    for (const s of ['pending', 'sent', 'delivered', 'read', 'failed']) {
      expect(ViewStatusSchema.parse(s)).toBe(s);
    }
  });
  it('rejeita status invalido', () => {
    expect(() => ViewStatusSchema.parse('bounced')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Limites de tamanho de midia
// ---------------------------------------------------------------------------

describe('limites de midia (WhatsApp Cloud API)', () => {
  it('mediaKindFromMime deriva o tipo do MIME', () => {
    expect(mediaKindFromMime('image/jpeg')).toBe('image');
    expect(mediaKindFromMime('image/webp')).toBe('image');
    expect(mediaKindFromMime('video/mp4')).toBe('video');
    expect(mediaKindFromMime('audio/ogg; codecs=opus')).toBe('audio');
    expect(mediaKindFromMime('audio/mpeg')).toBe('audio');
    expect(mediaKindFromMime('application/pdf')).toBe('document');
    expect(mediaKindFromMime('application/octet-stream')).toBe('document');
  });

  it('limites por tipo conforme WhatsApp (com documento capado no teto do deploy)', () => {
    expect(WHATSAPP_MEDIA_MAX_BYTES.image).toBe(5 * 1024 * 1024);
    expect(WHATSAPP_MEDIA_MAX_BYTES.video).toBe(16 * 1024 * 1024);
    expect(WHATSAPP_MEDIA_MAX_BYTES.audio).toBe(16 * 1024 * 1024);
    expect(WHATSAPP_MEDIA_MAX_BYTES.document).toBe(MEDIA_MAX_BYTES_ANY);
  });

  it('teto absoluto = 50MB e nenhum tipo o excede', () => {
    expect(MEDIA_MAX_BYTES_ANY).toBe(50 * 1024 * 1024);
    for (const limit of Object.values(WHATSAPP_MEDIA_MAX_BYTES)) {
      expect(limit).toBeLessThanOrEqual(MEDIA_MAX_BYTES_ANY);
    }
  });

  it('maxUploadBytesForMime mapeia MIME -> limite por tipo', () => {
    expect(maxUploadBytesForMime('image/png')).toBe(5 * 1024 * 1024);
    expect(maxUploadBytesForMime('audio/ogg')).toBe(16 * 1024 * 1024);
    expect(maxUploadBytesForMime('application/pdf')).toBe(50 * 1024 * 1024);
  });

  it('formatMaxBytes formata em MB', () => {
    expect(formatMaxBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatMaxBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});
