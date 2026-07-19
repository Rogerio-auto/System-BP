// =============================================================================
// __tests__/whatsapp-adapter.test.ts — Testes do MetaWhatsAppAdapter (F16-S05).
//
// Cobre:
//   webhook.parser.ts:
//     1.  parseMetaWebhookEnvelope: mensagem de texto
//     2.  parseMetaWebhookEnvelope: imagem com caption
//     3.  parseMetaWebhookEnvelope: vídeo
//     4.  parseMetaWebhookEnvelope: áudio regular
//     5.  parseMetaWebhookEnvelope: áudio PTT (voice=true) → messageType='voice'
//     6.  parseMetaWebhookEnvelope: documento
//     7.  parseMetaWebhookEnvelope: sticker
//     8.  parseMetaWebhookEnvelope: localização
//     9.  parseMetaWebhookEnvelope: contato
//    10.  parseMetaWebhookEnvelope: interactive button_reply
//    11.  parseMetaWebhookEnvelope: interactive list_reply
//    12.  parseMetaWebhookEnvelope: interactive nfm_reply (flow)
//    13.  parseMetaWebhookEnvelope: reaction
//    14.  parseMetaWebhookEnvelope: status sent
//    15.  parseMetaWebhookEnvelope: status delivered
//    16.  parseMetaWebhookEnvelope: status read
//    17.  parseMetaWebhookEnvelope: status failed
//    18.  parseMetaWebhookEnvelope: payload inválido (não-objeto) → ZodError
//    19.  parseMetaWebhookEnvelope: entry vazia → array vazio
//    20.  parseMetaWebhookEnvelope: tipo 'system' → omitido (array vazio)
//    21.  parseMetaWebhookEnvelope: tipo desconhecido → messageType='text' com metadata
//    22.  parseMetaWebhookEnvelope: texto com reply context → metadata.replyToExternalId
//
//   serializer.ts:
//    23.  serializeOutboundJob: text
//    24.  serializeOutboundJob: text com replyToExternalId
//    25.  serializeOutboundJob: media image com link
//    26.  serializeOutboundJob: media document com caption
//    27.  serializeOutboundJob: media voice → type='audio'
//    28.  serializeOutboundJob: template
//    29.  serializeOutboundJob: interactive buttons
//    30.  serializeOutboundJob: interactive list
//    31.  serializeOutboundJob: typing_indicator → ChannelError (422)
//    32.  serializeOutboundJob: ig_private_reply → ChannelError
//
//   errors.ts:
//    33.  lookupWaError: código conhecido retorna entry
//    34.  lookupWaError: código desconhecido retorna undefined
//    35.  isWaErrorRetryable: código retentável → true
//    36.  isWaErrorRetryable: código terminal → false
//    37.  isWaErrorRetryable: código desconhecido, HTTP 429 → true (fallback)
//    38.  isWaErrorRetryable: código desconhecido, HTTP 400 → false (fallback)
//
//   adapter.ts (MetaWhatsAppAdapter):
//    39.  capabilities: propriedades corretas
//    40.  provider: 'meta_whatsapp'
//    41.  verifySignature: delega para verifyMetaSignatureOrThrow (válida → true)
//    42.  verifySignature: assinatura inválida → SignatureError propagado
//    43.  buildGraphClient: WAHA credentials → ChannelError
//    44.  parseInbound via interface genérica (mock envelope)
//
//  registry auto-registration:
//    45.  importar adapter.ts registra 'meta_whatsapp' no registry
// =============================================================================

import { createHmac } from 'node:crypto';

import type { InboundEvent } from '@elemento/shared-schemas';
import { afterEach, describe, expect, it } from 'vitest';

import { MetaWhatsAppAdapter } from '../meta/whatsapp/adapter.js';
import { isWaErrorRetryable, lookupWaError } from '../meta/whatsapp/errors.js';
import { serializeOutboundJob } from '../meta/whatsapp/serializer.js';
import {
  type ParseInboundOptions,
  parseMetaWebhookEnvelope,
} from '../meta/whatsapp/webhook.parser.js';
import {
  clearAdapterRegistry,
  getAdapter,
  getRegisteredProviders,
  registerAdapter,
} from '../registry.js';
import { ChannelError, SignatureError } from '../shared/errors.js';

// ---------------------------------------------------------------------------
// Fixtures helpers
// ---------------------------------------------------------------------------

const TEST_OPTS: ParseInboundOptions = {
  organizationId: '11111111-1111-1111-1111-111111111111',
  channelId: '22222222-2222-2222-2222-222222222222',
  provider: 'meta_whatsapp',
};

/** Constrói um envelope Meta mínimo com uma mensagem. Retorna unknown para passar ao parser Zod. */
function makeEnvelope(
  message: Record<string, unknown>,
  contacts: ReadonlyArray<Record<string, unknown>> = [],
): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID_123',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '+556900000000', phone_number_id: 'PHONE_NUM_ID' },
              contacts,
              messages: [message],
              statuses: [],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

/** Constrói um envelope com status update. Retorna unknown para passar ao parser Zod. */
function makeStatusEnvelope(status: Record<string, unknown>): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID_123',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '+556900000000', phone_number_id: 'PHONE_NUM_ID' },
              contacts: [],
              messages: [],
              statuses: [status],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

/** Número de remetente anonimizado (fixture — sem número real). */
const SENDER_PHONE = '+55690000XXXX';
const MSG_ID = 'wamid.test123456789';
const TIMESTAMP = '1718000000';

// ===========================================================================
// Seção 1: webhook.parser.ts
// ===========================================================================

describe('parseMetaWebhookEnvelope', () => {
  // 1. Texto simples
  it('1. mensagem de texto → InboundEvent{type:message, messageType:text}', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'text',
      text: { body: 'Olá, preciso de informação' },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.type).toBe('message');
    expect(event.messageType).toBe('text');
    expect(event.content).toBe('Olá, preciso de informação');
    expect(event.contactRemoteId).toBe(SENDER_PHONE);
    expect(event.externalId).toBe(MSG_ID);
    expect(event.organizationId).toBe(TEST_OPTS.organizationId);
    expect(event.channelId).toBe(TEST_OPTS.channelId);
    expect(event.provider).toBe('meta_whatsapp');
  });

  // 2. Imagem com caption
  it('2. imagem com caption → messageType:image, mediaRef com refOrUrl', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'image',
      image: {
        id: 'MEDIA_ID_ABC',
        mime_type: 'image/jpeg',
        sha256: 'abc123',
        caption: 'Minha imagem',
      },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('image');
    expect(event.content).toBe('Minha imagem');
    expect(event.mediaRef).toBeDefined();
    expect(event.mediaRef?.refOrUrl).toBe('MEDIA_ID_ABC');
    expect(event.mediaRef?.mimeType).toBe('image/jpeg');
    expect(event.mediaRef?.sha256).toBe('abc123');
  });

  // 3. Vídeo
  it('3. vídeo → messageType:video, mediaRef presente', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'video',
      video: { id: 'VIDEO_ID_001', mime_type: 'video/mp4' },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('video');
    expect(event.mediaRef?.refOrUrl).toBe('VIDEO_ID_001');
  });

  // 4. Áudio regular
  it('4. áudio (voice=false) → messageType:audio', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'audio',
      audio: { id: 'AUDIO_ID_001', mime_type: 'audio/ogg; codecs=opus', voice: false },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('audio');
  });

  // 5. Áudio PTT (voice=true)
  it('5. áudio PTT (voice=true) → messageType:voice', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'audio',
      audio: { id: 'AUDIO_PTT_001', mime_type: 'audio/ogg; codecs=opus', voice: true },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('voice');
  });

  // 6. Documento
  it('6. documento → messageType:document, fileName preservado', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'document',
      document: {
        id: 'DOC_ID_001',
        mime_type: 'application/pdf',
        filename: 'contrato.pdf',
        caption: 'Meu contrato',
      },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('document');
    expect(event.mediaRef?.fileName).toBe('contrato.pdf');
    expect(event.content).toBe('Meu contrato');
  });

  // 7. Sticker
  it('7. sticker → messageType:sticker, sem content', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'sticker',
      sticker: { id: 'STICKER_ID_001', mime_type: 'image/webp' },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('sticker');
    expect(event.content).toBeUndefined();
    expect(event.mediaRef?.refOrUrl).toBe('STICKER_ID_001');
  });

  // 8. Localização
  it('8. localização → messageType:location, metadata com lat/lng', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'location',
      location: { latitude: -8.7608, longitude: -63.9004, name: 'Porto Velho', address: 'RO' },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('location');
    expect(event.metadata).toMatchObject({
      latitude: -8.7608,
      longitude: -63.9004,
      name: 'Porto Velho',
    });
  });

  // 9. Contato
  it('9. contato → messageType:contact, sem telefone em metadata (LGPD)', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'contacts',
      contacts: [{ name: { formatted_name: 'João Silva' }, phones: [{ phone: '+5569XXXXXXXX' }] }],
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('contact');
    // Nomes podem estar no metadata, mas telefones NÃO (LGPD)
    const meta = event.metadata as Record<string, unknown> | undefined;
    expect(meta?.['names']).toContain('João Silva');
    // Verificar que não há telefone no metadata
    const metaStr = JSON.stringify(meta);
    expect(metaStr).not.toContain('phone');
    expect(metaStr).not.toContain('5569');
  });

  // 10. Interactive button_reply
  it('10. interactive button_reply → messageType:interactive, metadata com buttonId', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'btn_sim', title: 'Sim' },
      },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('interactive');
    const meta = event.metadata as Record<string, unknown> | undefined;
    expect(meta?.['interactiveType']).toBe('button_reply');
    expect(meta?.['buttonId']).toBe('btn_sim');
    expect(meta?.['buttonTitle']).toBe('Sim');
  });

  // 11. Interactive list_reply
  it('11. interactive list_reply → messageType:interactive, metadata com rowId', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: 'row_001', title: 'Opção 1', description: 'Primeira opção' },
      },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('interactive');
    const meta = event.metadata as Record<string, unknown> | undefined;
    expect(meta?.['interactiveType']).toBe('list_reply');
    expect(meta?.['rowId']).toBe('row_001');
    expect(meta?.['rowTitle']).toBe('Opção 1');
    expect(meta?.['rowDescription']).toBe('Primeira opção');
  });

  // 12. Interactive nfm_reply (WhatsApp Flow)
  it('12. interactive nfm_reply (flow) → metadata com flowName e responseJson', () => {
    const flowResponse = { step: 'confirm', answer: 'yes' };
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'interactive',
      interactive: {
        type: 'nfm_reply',
        nfm_reply: {
          name: 'flow_confirma_dados',
          response_json: JSON.stringify(flowResponse),
        },
      },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('interactive');
    const meta = event.metadata as Record<string, unknown> | undefined;
    expect(meta?.['interactiveType']).toBe('nfm_reply');
    expect(meta?.['flowName']).toBe('flow_confirma_dados');
    expect(meta?.['responseJson']).toEqual(flowResponse);
  });

  // 13. Reaction
  it('13. reaction → type:reaction, targetExternalId e emoji', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'reaction',
      reaction: { message_id: 'wamid.target999', emoji: '👍' },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<InboundEvent, { type: 'reaction' }>;
    expect(event.type).toBe('reaction');
    expect(event.emoji).toBe('👍');
    expect(event.targetExternalId).toBe('wamid.target999');
    expect(event.provider).toBe('meta_whatsapp');
  });

  // 14. Status sent
  it('14. status sent → type:status, status:sent', () => {
    const envelope = makeStatusEnvelope({
      id: 'wamid.outbound123',
      recipient_id: SENDER_PHONE,
      status: 'sent',
      timestamp: TIMESTAMP,
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<InboundEvent, { type: 'status' }>;
    expect(event.type).toBe('status');
    expect(event.status).toBe('sent');
    expect(event.externalId).toBe('wamid.outbound123');
  });

  // 15. Status delivered
  it('15. status delivered → type:status, status:delivered', () => {
    const envelope = makeStatusEnvelope({
      id: 'wamid.outbound456',
      recipient_id: SENDER_PHONE,
      status: 'delivered',
      timestamp: TIMESTAMP,
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'status' }>;
    expect(event.status).toBe('delivered');
  });

  // 16. Status read
  it('16. status read → type:status, status:read', () => {
    const envelope = makeStatusEnvelope({
      id: 'wamid.outbound789',
      recipient_id: SENDER_PHONE,
      status: 'read',
      timestamp: TIMESTAMP,
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'status' }>;
    expect(event.status).toBe('read');
  });

  // 17. Status failed
  it('17. status failed → type:status, status:failed', () => {
    const envelope = makeStatusEnvelope({
      id: 'wamid.outbound999',
      recipient_id: SENDER_PHONE,
      status: 'failed',
      timestamp: TIMESTAMP,
      errors: [{ code: 131047, title: 'Re-engagement message' }],
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'status' }>;
    expect(event.status).toBe('failed');
  });

  // 18. Payload inválido → ZodError
  it('18. payload inválido (número) → lança ZodError', () => {
    expect(() => parseMetaWebhookEnvelope(42, TEST_OPTS)).toThrow();
    expect(() => parseMetaWebhookEnvelope(null, TEST_OPTS)).toThrow();
    expect(() => parseMetaWebhookEnvelope({ sem_entry: true }, TEST_OPTS)).toThrow();
  });

  // 19. Entry vazia → array vazio
  it('19. entry vazia (sem messages nem statuses) → array vazio', () => {
    const envelope: unknown = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_123',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'PHONE_NUM_ID' },
                contacts: [],
                messages: [],
                statuses: [],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);
    expect(events).toHaveLength(0);
  });

  // 20. Tipo 'system' → omitido
  it('20. mensagem tipo system → omitida (não retorna evento)', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'system',
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);
    expect(events).toHaveLength(0);
  });

  // 21. Tipo desconhecido → messageType='text' com metadata
  it('21. tipo desconhecido → messageType:text com metadata.originalType', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'future_type_xyz',
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    expect(event.messageType).toBe('text');
    const meta = event.metadata as Record<string, unknown> | undefined;
    expect(meta?.['originalType']).toBe('future_type_xyz');
  });

  // 22. Texto com reply context
  it('22. texto com context.id → metadata.replyToExternalId', () => {
    const envelope = makeEnvelope({
      id: MSG_ID,
      from: SENDER_PHONE,
      timestamp: TIMESTAMP,
      type: 'text',
      text: { body: 'Sim, concordo.' },
      context: { id: 'wamid.original999', from: '+55690001XXXX' },
    });

    const events = parseMetaWebhookEnvelope(envelope, TEST_OPTS);

    const event = events[0] as Extract<InboundEvent, { type: 'message' }>;
    const meta = event.metadata as Record<string, unknown> | undefined;
    expect(meta?.['replyToExternalId']).toBe('wamid.original999');
  });
});

// ===========================================================================
// Seção 2: serializer.ts
// ===========================================================================

describe('serializeOutboundJob', () => {
  const baseJob = {
    organizationId: '11111111-1111-1111-1111-111111111111',
    channelId: '22222222-2222-2222-2222-222222222222',
    conversationId: '33333333-3333-3333-3333-333333333333',
    messageId: '44444444-4444-4444-4444-444444444444',
    contactRemoteId: '+55690000XXXX',
  };

  // 23. Texto
  it('23. text → payload correto com messaging_product e type=text', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'text',
      content: 'Olá! Como posso ajudar?',
    });

    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.recipient_type).toBe('individual');
    expect(payload.to).toBe('+55690000XXXX');
    expect(payload.type).toBe('text');
    const text = payload['text'] as Record<string, unknown> | undefined;
    expect(text?.['body']).toBe('Olá! Como posso ajudar?');
  });

  // 24. Texto com reply
  it('24. text com replyToExternalId → context.message_id presente', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'text',
      content: 'Entendido.',
      replyToExternalId: 'wamid.original001',
    });

    const context = payload['context'] as Record<string, unknown> | undefined;
    expect(context?.['message_id']).toBe('wamid.original001');
  });

  // 25. Mídia imagem com link
  it('25. media image com publicMediaUrl → type=image, image.link', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'media',
      mediaKind: 'image',
      publicMediaUrl: 'https://example.com/img.jpg',
      mime: 'image/jpeg',
    });

    expect(payload.type).toBe('image');
    const image = payload['image'] as Record<string, unknown> | undefined;
    expect(image?.['link']).toBe('https://example.com/img.jpg');
  });

  // 26. Documento com caption
  it('26. media document com caption → caption no payload', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'media',
      mediaKind: 'document',
      publicMediaUrl: 'https://example.com/contrato.pdf',
      mime: 'application/pdf',
      caption: 'Seu contrato',
    });

    expect(payload.type).toBe('document');
    const doc = payload['document'] as Record<string, unknown> | undefined;
    expect(doc?.['caption']).toBe('Seu contrato');
  });

  // 27. Mídia voice → type=audio
  it('27. media voice → type=audio (Meta não tem tipo voice no send)', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'media',
      mediaKind: 'voice',
      publicMediaUrl: 'https://example.com/audio.ogg',
      mime: 'audio/ogg',
    });

    expect(payload.type).toBe('audio');
  });

  // 28. Template
  it('28. template → payload com template.name e language.code', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'template',
      templateName: 'boas_vindas_v2',
      languageCode: 'pt_BR',
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'João' }] }],
    });

    expect(payload.type).toBe('template');
    const template = payload['template'] as Record<string, unknown> | undefined;
    expect(template?.['name']).toBe('boas_vindas_v2');
    const lang = template?.['language'] as Record<string, unknown> | undefined;
    expect(lang?.['code']).toBe('pt_BR');
    expect(Array.isArray(template?.['components'])).toBe(true);
  });

  // 29. Interactive buttons
  it('29. interactive buttons → type=interactive, interactive.type=button', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'interactive',
      payload: {
        type: 'buttons',
        body: 'Escolha uma opção:',
        buttons: [
          { id: 'sim', text: 'Sim' },
          { id: 'nao', text: 'Não' },
        ],
      },
    });

    expect(payload.type).toBe('interactive');
    const interactive = payload['interactive'] as Record<string, unknown> | undefined;
    expect(interactive?.['type']).toBe('button');
    const action = interactive?.['action'] as Record<string, unknown> | undefined;
    const buttons = action?.['buttons'] as ReadonlyArray<Record<string, unknown>> | undefined;
    expect(buttons).toHaveLength(2);
    expect(buttons?.[0]?.['type']).toBe('reply');
    const reply = buttons?.[0]?.['reply'] as Record<string, unknown> | undefined;
    expect(reply?.['id']).toBe('sim');
  });

  // 30. Interactive list
  it('30. interactive list → type=interactive, interactive.type=list', () => {
    const payload = serializeOutboundJob({
      ...baseJob,
      type: 'interactive',
      payload: {
        type: 'list',
        body: 'Selecione um serviço:',
        button: 'Ver opções',
        sections: [
          {
            title: 'Crédito',
            rows: [{ id: 'credito_pessoal', title: 'Pessoal', description: 'Para pessoa física' }],
          },
        ],
      },
    });

    const interactive = payload['interactive'] as Record<string, unknown> | undefined;
    expect(interactive?.['type']).toBe('list');
    const action = interactive?.['action'] as Record<string, unknown> | undefined;
    expect(action?.['button']).toBe('Ver opções');
    const sections = action?.['sections'] as ReadonlyArray<Record<string, unknown>> | undefined;
    expect(sections).toHaveLength(1);
    const rows = sections?.[0]?.['rows'] as ReadonlyArray<Record<string, unknown>> | undefined;
    expect(rows?.[0]?.['id']).toBe('credito_pessoal');
  });

  // 31. typing_indicator → ChannelError
  it('31. typing_indicator → lança ChannelError (422)', () => {
    expect(() =>
      serializeOutboundJob({
        ...baseJob,
        type: 'typing_indicator',
        kind: 'typing',
      }),
    ).toThrow(ChannelError);

    try {
      serializeOutboundJob({ ...baseJob, type: 'typing_indicator', kind: 'typing' });
    } catch (e) {
      expect(e instanceof ChannelError).toBe(true);
      if (e instanceof ChannelError) {
        expect(e.statusCode).toBe(422);
      }
    }
  });

  // 32. ig_private_reply → ChannelError
  it('32. ig_private_reply → lança ChannelError (tipo não suportado no WA)', () => {
    expect(() =>
      serializeOutboundJob({
        ...baseJob,
        type: 'ig_private_reply',
        commentId: 'comment_123',
        content: 'Olá!',
      }),
    ).toThrow(ChannelError);
  });
});

// ===========================================================================
// Seção 3: errors.ts
// ===========================================================================

describe('WA Error Catalog', () => {
  // 33. lookupWaError: código conhecido
  it('33. lookupWaError: 131047 (UNDELIVERABLE) → entry presente', () => {
    const entry = lookupWaError(131047);
    expect(entry).toBeDefined();
    expect(entry?.code).toBe(131047);
    expect(entry?.retryable).toBe(false);
    expect(entry?.category).toBe('routing');
  });

  // 34. lookupWaError: código desconhecido
  it('34. lookupWaError: código inexistente → undefined', () => {
    expect(lookupWaError(999999)).toBeUndefined();
  });

  // 35. isWaErrorRetryable: código retentável
  it('35. isWaErrorRetryable: 130429 (rate limit) → true', () => {
    expect(isWaErrorRetryable(130429, 429)).toBe(true);
  });

  // 36. isWaErrorRetryable: código terminal
  it('36. isWaErrorRetryable: 131049 (janela expirada) → false', () => {
    expect(isWaErrorRetryable(131049, 400)).toBe(false);
  });

  // 37. Fallback HTTP 429
  it('37. isWaErrorRetryable: código desconhecido + HTTP 429 → true (fallback)', () => {
    expect(isWaErrorRetryable(999999, 429)).toBe(true);
  });

  // 38. Fallback HTTP 400
  it('38. isWaErrorRetryable: código desconhecido + HTTP 400 → false (fallback)', () => {
    expect(isWaErrorRetryable(999999, 400)).toBe(false);
  });
});

// ===========================================================================
// Seção 4: MetaWhatsAppAdapter via interface
// ===========================================================================

describe('MetaWhatsAppAdapter', () => {
  afterEach(() => {
    clearAdapterRegistry();
  });

  // 39. Capabilities corretas
  it('39. capabilities: sendTemplate, sendInteractive, has24hWindow = true', () => {
    const adapter = new MetaWhatsAppAdapter();

    expect(adapter.capabilities.sendTemplate).toBe(true);
    expect(adapter.capabilities.sendInteractive).toBe(true);
    expect(adapter.capabilities.downloadMedia).toBe(true);
    expect(adapter.capabilities.markAsRead).toBe(true);
    expect(adapter.capabilities.sendTypingIndicator).toBe(true);
    expect(adapter.capabilities.sendAudioPtt).toBe(true);
    expect(adapter.capabilities.sendSticker).toBe(true);
    expect(adapter.capabilities.has24hWindow).toBe(true);
    expect(adapter.capabilities.sendReaction).toBe(true);
  });

  // 40. Provider correto
  it('40. provider é meta_whatsapp', async () => {
    const adapter = new MetaWhatsAppAdapter();
    expect(adapter.provider).toBe('meta_whatsapp');
  });

  // 41. verifySignature válida → true
  it('41. verifySignature: assinatura correta → true', async () => {
    const adapter = new MetaWhatsAppAdapter();

    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const secret = 'test-app-secret-for-f16-s05-test';
    const hmac = createHmac('sha256', secret).update(rawBody).digest('hex');
    const signatureHeader = `sha256=${hmac}`;

    const result = await adapter.verifySignature(rawBody, signatureHeader, async () => secret);
    expect(result).toBe(true);
  });

  // 42. verifySignature inválida → SignatureError
  it('42. verifySignature: HMAC errado → lança SignatureError', async () => {
    const adapter = new MetaWhatsAppAdapter();

    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const wrongHeader = 'sha256=' + 'a'.repeat(64);

    await expect(
      adapter.verifySignature(rawBody, wrongHeader, async () => 'my-secret-app-secret-16chars'),
    ).rejects.toBeInstanceOf(SignatureError);
  });

  // 43. buildGraphClient com WAHA credentials → ChannelError
  it('43. buildGraphClient com WAHA credentials → ChannelError', async () => {
    const adapter = new MetaWhatsAppAdapter();

    expect(() =>
      adapter.buildGraphClient({
        provider: 'waha',
        baseUrl: 'http://waha.internal:3000',
        apiKey: 'test-key',
        sessionId: 'session-1',
      }),
    ).toThrow(ChannelError);
  });

  // 44. parseInbound via interface genérica
  it('44. parseInbound via interface: retorna array vazio (stub do contrato IChannelAdapter)', async () => {
    const adapter = new MetaWhatsAppAdapter();

    // parseInbound() satisfaz o contrato IChannelAdapter<unknown, ...>.
    // Para produção, usar parseWebhookEnvelope(raw, opts) que retorna shared-schemas.InboundEvent[].
    const events = adapter.parseInbound({ object: 'whatsapp_business_account', entry: [] });
    expect(Array.isArray(events)).toBe(true);
  });

  // 44b. parseWebhookEnvelope com opts → retorna eventos normalizados
  it('44b. parseWebhookEnvelope: envelope WA com opts → eventos normalizados', async () => {
    const adapter = new MetaWhatsAppAdapter();

    const envelope: unknown = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'PHONE_NUM_ID' },
                contacts: [],
                messages: [
                  {
                    id: 'wamid.test',
                    from: '+55690000XXXX',
                    timestamp: '1718000000',
                    type: 'text',
                    text: { body: 'Teste de interface' },
                  },
                ],
                statuses: [],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const events = adapter.parseWebhookEnvelope(envelope, {
      organizationId: TEST_OPTS.organizationId,
      channelId: TEST_OPTS.channelId,
      provider: TEST_OPTS.provider,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('message');
  });
});

// ===========================================================================
// Seção 5: Auto-registro no registry
//
// O módulo adapter.ts chama registerAdapter() na importação.
// Como Node.js cacheia módulos ESM, o auto-registro ocorre UMA VEZ.
// Os testes acima usam afterEach → clearAdapterRegistry(), portanto
// testamos aqui o comportamento de re-registro explícito.
// ===========================================================================

describe('MetaWhatsAppAdapter auto-registration', () => {
  afterEach(() => {
    clearAdapterRegistry();
  });

  it('45. MetaWhatsAppAdapter pode ser registrado manualmente via registerAdapter', () => {
    const adapter = new MetaWhatsAppAdapter();
    // Registro manual — simula o que o bootstrap faz ao importar o módulo
    registerAdapter(adapter);

    const providers = getRegisteredProviders();
    expect(providers).toContain('meta_whatsapp');
  });

  it('45b. getAdapter("meta_whatsapp") retorna adapter com capabilities corretas após registro', () => {
    const adapter = new MetaWhatsAppAdapter();
    registerAdapter(adapter);

    const retrieved = getAdapter('meta_whatsapp');
    expect(retrieved.provider).toBe('meta_whatsapp');
    expect(retrieved.capabilities.sendTemplate).toBe(true);
    expect(retrieved.capabilities.has24hWindow).toBe(true);
  });
});
