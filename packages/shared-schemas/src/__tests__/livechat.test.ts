import { describe, it, expect } from 'vitest';

import {
  ChannelProviderSchema,
  MessageTypeSchema,
  InteractivePayloadSchema,
  InboundEventSchema,
  OutboundJobSchema,
  SendResultSchema,
  ViewStatusSchema,
} from '../livechat.js';

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
  it('aceita lista valida', () => {
    const r = InteractivePayloadSchema.parse({
      type: 'list',
      body: 'Selecione',
      button: 'Ver',
      sections: [{ title: 'S1', rows: [{ id: 'r1', title: 'Item' }] }],
    });
    expect(r.type).toBe('list');
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

describe('InboundEventSchema', () => {
  it('aceita evento de mensagem', () => {
    const e = InboundEventSchema.parse({
      type: 'message',
      provider: 'meta_whatsapp',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.x',
      messageType: 'text',
      rawTimestamp: '2026-06-14T00:00:00Z',
    });
    expect(e.type).toBe('message');
  });
  it('aceita evento de status', () => {
    const e = InboundEventSchema.parse({
      type: 'status',
      provider: 'meta_whatsapp',
      externalId: 'wamid.x',
      status: 'delivered',
      rawTimestamp: '2026-06-14T00:00:00Z',
    });
    expect(e.type).toBe('status');
  });
  it('aceita comment IG', () => {
    const e = InboundEventSchema.parse({
      type: 'comment',
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
      provider: 'meta_instagram',
      contactRemoteId: '+5511999990000',
      externalId: 'wamid.sm',
      mediaRef: { refOrUrl: 'https://cdn.ig.com/story.mp4' },
      storyId: 'sid1',
    });
    expect(e.type).toBe('story_mention');
  });
  it('rejeita tipo desconhecido', () => {
    expect(() =>
      InboundEventSchema.parse({ type: 'unknown', provider: 'meta_whatsapp' }),
    ).toThrow();
  });
  it('rejeita mensagem sem externalId', () => {
    expect(() =>
      InboundEventSchema.parse({
        type: 'message',
        provider: 'meta_whatsapp',
        contactRemoteId: '+5511999990000',
        messageType: 'text',
        rawTimestamp: '2026-06-14T00:00:00Z',
      }),
    ).toThrow();
  });
});

const BASE = {
  channelId: '00000000-0000-0000-0000-000000000001',
  conversationId: '00000000-0000-0000-0000-000000000002',
  messageId: '00000000-0000-0000-0000-000000000003',
};

describe('OutboundJobSchema', () => {
  it('aceita job de texto', () => {
    const j = OutboundJobSchema.parse({
      ...BASE,
      type: 'text',
      contactRemoteId: '+5511999990000',
      content: 'Ola',
    });
    expect(j.type).toBe('text');
  });
  it('aceita job de midia', () => {
    const j = OutboundJobSchema.parse({
      ...BASE,
      type: 'media',
      contactRemoteId: '+5511999990000',
      mediaKind: 'image',
      publicMediaUrl: 'https://r2.example.com/img.jpg',
      mime: 'image/jpeg',
    });
    expect(j.type).toBe('media');
  });
  it('aceita typing_indicator', () => {
    const j = OutboundJobSchema.parse({
      ...BASE,
      type: 'typing_indicator',
      contactRemoteId: '+5511999990000',
      kind: 'typing',
    });
    expect(j.type).toBe('typing_indicator');
  });
  it('aceita ig_private_reply', () => {
    const j = OutboundJobSchema.parse({
      ...BASE,
      type: 'ig_private_reply',
      commentId: 'cid123',
      content: 'Obrigado!',
    });
    expect(j.type).toBe('ig_private_reply');
  });
  it('rejeita mediaUrl invalida', () => {
    expect(() =>
      OutboundJobSchema.parse({
        ...BASE,
        type: 'media',
        contactRemoteId: '+5511999990000',
        mediaKind: 'image',
        publicMediaUrl: 'nao-url',
        mime: 'image/jpeg',
      }),
    ).toThrow();
  });
  it('rejeita channelId invalido', () => {
    expect(() =>
      OutboundJobSchema.parse({
        type: 'text',
        channelId: 'nao-uuid',
        conversationId: BASE.conversationId,
        messageId: BASE.messageId,
        contactRemoteId: '+5511999990000',
        content: 'x',
      }),
    ).toThrow();
  });
});

describe('SendResultSchema', () => {
  it('aceita sucesso com externalId', () => {
    const r = SendResultSchema.parse({ ok: true, externalId: 'wamid.x' });
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
});

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
