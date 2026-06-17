// =============================================================================
// livechat-inbound.test.ts — Testes do worker F16-S08.
//
// Estratégia: mock de RabbitMQ client, livechat service e db singleton.
//   processMessage() é a função pura testada — sem consumer real.
//
// Cenários cobertos:
//   1. Mensagem nova (type=message) → ack + relay publicado
//   2. Mensagem duplicata (persistInboundMessage retorna null) → ack sem relay
//   3. Payload com mídia → ack + relay + inbound.media publicado
//   4. Payload inválido (JSON malformado) → nack sem requeue
//   5. Envelope inválido (sem organizationId) → nack sem requeue
//   6. InboundEvent inválido (tipo desconhecido) → nack sem requeue
//   7. Status update (type=status) mensagem encontrada → ack + conversation:updated no relay
//   8. Status update mensagem não encontrada → ack silencioso
//   9. Exceção no service → nack
//  10. Evento não suportado (story_mention) → ack silencioso
//  11. [F16-S22] conversa nova (leadId null) → chama linkOrCreateLeadForConversation
//  12. [F16-S22] conversa existente com lead (leadId set) → pula auto-link
//  13. [F16-S28] gate IA passa → publica em hm.q.livechat.ai
//  14. [F16-S28] gate IA nao passa (falha) → nao publica, ack normal
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock env (DEVE ser o primeiro mock — antes de qualquer import do módulo)
// ---------------------------------------------------------------------------
vi.mock('../../config/env.js', () => ({
  env: {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    API_HOST: '0.0.0.0',
    API_PORT: 3333,
    API_PUBLIC_URL: 'http://localhost:3333',
    CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
    LANGGRAPH_INTERNAL_TOKEN: 'a'.repeat(33),
    LANGGRAPH_SERVICE_URL: 'http://localhost:8000',
    WHATSAPP_APP_SECRET: 'test-whatsapp-secret-at-least-16ch',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    FX_BRL_PER_USD: 5.75,
    LGPD_DEDUPE_PEPPER: 'a'.repeat(44),
    RABBITMQ_URL: 'amqp://localhost:5672',
  },
}));

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---------------------------------------------------------------------------
// Mock drizzle-orm
// ---------------------------------------------------------------------------
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ __eq: val })),
  and: vi.fn((...args: unknown[]) => ({ __and: args })),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
  asc: vi.fn().mockReturnValue({}),
  desc: vi.fn().mockReturnValue({}),
  count: vi.fn().mockReturnValue({}),
  inArray: vi.fn().mockReturnValue({}),
  isNotNull: vi.fn().mockReturnValue({}),
  isNull: vi.fn().mockReturnValue({}),
  lte: vi.fn((_col: unknown, val: unknown) => ({ __lte: val })),
  or: vi.fn((...args: unknown[]) => ({ __or: args })),
  not: vi.fn((arg: unknown) => ({ __not: arg })),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock db/client (singleton)
// vi.hoisted necessário: vi.mock é içado (hoisted) antes das declarações de variáveis,
// então referências a `const` de escopo superior dentro da factory falham em runtime.
// ---------------------------------------------------------------------------
const { mockDbSelect, mockDb } = vi.hoisted(() => {
  const mockDbSelect = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockDb = {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: vi.fn(),
    transaction: vi.fn(),
  };
  return { mockDbSelect, mockDb };
});

vi.mock('../../db/client.js', () => ({
  db: mockDb,
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock db/schema/messages (apenas o objeto de referência de tabela)
// ---------------------------------------------------------------------------
vi.mock('../../db/schema/messages.js', () => ({
  messages: {
    id: 'messages.id',
    externalId: 'messages.external_id',
    conversationId: 'messages.conversation_id',
  },
}));

// ---------------------------------------------------------------------------
// Mock lib/queue (RabbitMQ client)
// ---------------------------------------------------------------------------
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockMakeEnvelope = vi
  .fn()
  .mockImplementation((_type: string, orgId: string, payload: unknown) => ({
    id: 'envelope-uuid',
    type: _type,
    organizationId: orgId,
    payload,
    ts: Date.now(),
  }));

vi.mock('../../lib/queue/index.js', () => ({
  connectRabbitMQ: vi.fn().mockResolvedValue(undefined),
  closeRabbitMQ: vi.fn().mockResolvedValue(undefined),
  getRabbitChannel: vi.fn(),
  publish: (...args: unknown[]) => mockPublish(...args),
  makeEnvelope: (...args: unknown[]) => mockMakeEnvelope(...args),
  QUEUES: {
    inboundMessage: 'hm.q.inbound.message',
    inboundMedia: 'hm.q.inbound.media',
    outboundRequest: 'hm.q.outbound.request',
    socketRelay: 'hm.q.socket.relay',
    livechatAi: 'hm.q.livechat.ai',
  },
}));

// ---------------------------------------------------------------------------
// Mock lib/queue/envelope
// ---------------------------------------------------------------------------
vi.mock('../../lib/queue/envelope.js', () => ({
  envelopeSchema: {
    safeParse: vi.fn(),
  },
  makeEnvelope: (...args: unknown[]) => mockMakeEnvelope(...args),
}));

// ---------------------------------------------------------------------------
// Mock lib/logger
// ---------------------------------------------------------------------------
vi.mock('../../lib/logger.js', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock livechat service
// ---------------------------------------------------------------------------
const mockFindChannel = vi.fn();
const mockEnsureContactConversation = vi.fn();
const mockPersistInboundMessage = vi.fn();
const mockUpdateViewStatus = vi.fn();
const mockLinkOrCreateLeadForConversation = vi.fn().mockResolvedValue(null);

vi.mock('../../modules/livechat/service.js', () => ({
  findChannel: (...args: unknown[]) => mockFindChannel(...args),
  ensureContactConversation: (...args: unknown[]) => mockEnsureContactConversation(...args),
  linkOrCreateLeadForConversation: (...args: unknown[]) =>
    mockLinkOrCreateLeadForConversation(...args),
  persistInboundMessage: (...args: unknown[]) => mockPersistInboundMessage(...args),
  updateViewStatus: (...args: unknown[]) => mockUpdateViewStatus(...args),
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

// ---------------------------------------------------------------------------
// Mock ai-gate (F16-S28)
// ---------------------------------------------------------------------------
const mockShouldAiRespond = vi.fn().mockResolvedValue(false);

vi.mock('../../modules/livechat/ai-gate.js', () => ({
  shouldAiRespond: (...args: unknown[]) => mockShouldAiRespond(...args),
}));

// ---------------------------------------------------------------------------
// Import do módulo sob teste (APÓS todos os mocks)
// ---------------------------------------------------------------------------
import { envelopeSchema } from '../../lib/queue/envelope.js';
import { processMessage } from '../livechat-inbound.js';

// ---------------------------------------------------------------------------
// Fixtures e helpers
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000002';
const CONVERSATION_ID = '00000000-0000-0000-0000-000000000003';
const MESSAGE_ID = '00000000-0000-0000-0000-000000000004';
const EXTERNAL_ID = 'wamid.HBgLNTUxMTk5OTk5OTkV';

/** Cria um InboundEvent de mensagem de texto. */
function makeMessageEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'message',
    organizationId: ORG_ID,
    channelId: CHANNEL_ID,
    provider: 'meta_whatsapp',
    contactRemoteId: '5511999999999',
    externalId: EXTERNAL_ID,
    messageType: 'text',
    content: 'Olá, preciso de ajuda',
    rawTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Cria um InboundEvent de status. */
function makeStatusEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'status',
    organizationId: ORG_ID,
    channelId: CHANNEL_ID,
    provider: 'meta_whatsapp',
    externalId: EXTERNAL_ID,
    status: 'delivered',
    rawTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** Monta um Buffer com envelope válido. */
function makeEnvelopeBuffer(payload: unknown): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: 'env-uuid',
      type: 'hm.q.inbound.message',
      organizationId: ORG_ID,
      payload,
      ts: Date.now(),
    }),
  );
}

/** Configura o mock do envelopeSchema.safeParse para retornar sucesso. */
function mockEnvelopeSuccess(payload: unknown): void {
  (envelopeSchema.safeParse as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    success: true,
    data: {
      id: 'env-uuid',
      type: 'hm.q.inbound.message',
      organizationId: ORG_ID,
      payload,
      ts: Date.now(),
    },
  });
}

/** Configura o mock do envelopeSchema.safeParse para retornar falha. */
function mockEnvelopeFailure(): void {
  (envelopeSchema.safeParse as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    success: false,
    error: { issues: [{ message: 'invalid' }] },
  });
}

// ---------------------------------------------------------------------------
// Setup padrão dos mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Canal padrão
  mockFindChannel.mockResolvedValue({
    id: CHANNEL_ID,
    organizationId: ORG_ID,
    provider: 'meta_whatsapp',
    cityId: null,
  });

  // Conversa padrão (leadId null = sem vínculo de lead)
  mockEnsureContactConversation.mockResolvedValue({
    conversation: { id: CONVERSATION_ID, leadId: null },
    created: false,
  });

  // Mensagem padrão (nova)
  mockPersistInboundMessage.mockResolvedValue({
    id: MESSAGE_ID,
    type: 'text',
    conversationId: CONVERSATION_ID,
    createdAt: new Date(),
  });

  // updateViewStatus padrão
  mockUpdateViewStatus.mockResolvedValue(undefined);

  // DB select padrão (para status lookup)
  mockDbSelect.mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('processMessage', () => {
  // -------------------------------------------------------------------------
  // Cenário 1: Mensagem nova processada com sucesso → ack + relay
  // -------------------------------------------------------------------------
  it('1. mensagem nova → ack + publica socket relay', async () => {
    const event = makeMessageEvent();
    const buf = makeEnvelopeBuffer(event);
    mockEnvelopeSuccess(event);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    // Deve ter publicado no socket relay
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({ payload: expect.objectContaining({ event: 'message:new' }) }),
    );
    // Deve ter chamado o service de persistência
    expect(mockPersistInboundMessage).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        organizationId: ORG_ID,
        channelId: CHANNEL_ID,
        conversationId: CONVERSATION_ID,
        externalId: EXTERNAL_ID,
        messageType: 'text',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 2: Duplicata → ack sem relay
  // -------------------------------------------------------------------------
  it('2. duplicata (persistInboundMessage retorna null) → ack sem relay', async () => {
    mockPersistInboundMessage.mockResolvedValueOnce(null);

    const event = makeMessageEvent();
    const buf = makeEnvelopeBuffer(event);
    mockEnvelopeSuccess(event);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    // NÃO deve ter publicado no socket relay
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 3: Mensagem com mídia → ack + relay + inbound.media
  // -------------------------------------------------------------------------
  it('3. mensagem com mídia → ack + relay + enfileira inbound.media', async () => {
    // MediaRef usa shape do shared-schemas InboundEventSchema: { refOrUrl, mimeType, sha256, fileName }
    const event = makeMessageEvent({
      messageType: 'image',
      content: undefined,
      mediaRef: {
        refOrUrl: 'https://cdn.meta.com/media/abc123',
        mimeType: 'image/jpeg',
        sha256: 'abc123deadbeef',
        fileName: 'foto.jpg',
      },
    });
    mockEnvelopeSuccess(event);
    const buf = makeEnvelopeBuffer(event);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    // Deve ter publicado no inbound.media
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.inbound.media',
      expect.objectContaining({
        payload: expect.objectContaining({
          messageId: MESSAGE_ID,
          conversationId: CONVERSATION_ID,
          mediaRef: expect.objectContaining({ refOrUrl: 'https://cdn.meta.com/media/abc123' }),
        }),
      }),
    );
    // Deve ter publicado no socket relay
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({ payload: expect.objectContaining({ event: 'message:new' }) }),
    );
    // Relay deve indicar hasMedia=true
    expect(mockMakeEnvelope).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      ORG_ID,
      expect.objectContaining({ data: expect.objectContaining({ hasMedia: true }) }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 4: JSON malformado → nack
  // -------------------------------------------------------------------------
  it('4. JSON malformado → nack sem publicar', async () => {
    const buf = Buffer.from('{ not valid json ');

    // envelopeSchema.safeParse não deve ser chamado — JSON.parse falha antes
    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('nack');
    expect(mockPublish).not.toHaveBeenCalled();
    expect(envelopeSchema.safeParse).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 5: Envelope inválido → nack
  // -------------------------------------------------------------------------
  it('5. envelope inválido (sem organizationId) → nack', async () => {
    mockEnvelopeFailure();
    const buf = Buffer.from(JSON.stringify({ id: 'x', type: 'y', payload: {} }));

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('nack');
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 6: InboundEvent inválido (payload com campo requerido ausente) → nack
  // -------------------------------------------------------------------------
  it('6. InboundEvent inválido (externalId ausente em type=message) → nack', async () => {
    // Payload com type='message' mas sem externalId (campo obrigatório)
    const invalidEvent = {
      type: 'message',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_whatsapp',
      contactRemoteId: '5511999999999',
      // externalId: AUSENTE
      messageType: 'text',
      rawTimestamp: new Date().toISOString(),
    };
    mockEnvelopeSuccess(invalidEvent);
    const buf = makeEnvelopeBuffer(invalidEvent);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('nack');
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockPersistInboundMessage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 7: Status update — mensagem encontrada → ack + conversation:updated
  // -------------------------------------------------------------------------
  it('7. type=status + mensagem encontrada → ack + conversation:updated no relay', async () => {
    const statusEvent = makeStatusEvent({ status: 'read' });
    mockEnvelopeSuccess(statusEvent);
    const buf = makeEnvelopeBuffer(statusEvent);

    // Mock DB select para encontrar a mensagem pelo externalId
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: MESSAGE_ID, conversationId: CONVERSATION_ID }]),
        }),
      }),
    });

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    expect(mockUpdateViewStatus).toHaveBeenCalledWith(mockDb, MESSAGE_ID, 'read');
    // Deve publicar conversation:updated no relay
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'conversation:updated',
          data: expect.objectContaining({
            messageId: MESSAGE_ID,
            viewStatus: 'read',
          }),
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 8: Status update — mensagem não encontrada → ack silencioso
  // -------------------------------------------------------------------------
  it('8. type=status + mensagem não encontrada → ack silencioso sem relay', async () => {
    const statusEvent = makeStatusEvent();
    mockEnvelopeSuccess(statusEvent);
    const buf = makeEnvelopeBuffer(statusEvent);

    // DB select retorna vazio (mensagem não existe)
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    expect(mockUpdateViewStatus).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 9: Exceção no service → nack
  // -------------------------------------------------------------------------
  it('9. exceção em persistInboundMessage → nack sem publicar relay', async () => {
    mockPersistInboundMessage.mockRejectedValueOnce(new Error('DB connection lost'));

    const event = makeMessageEvent();
    mockEnvelopeSuccess(event);
    const buf = makeEnvelopeBuffer(event);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('nack');
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 10: Evento não suportado (story_mention) → ack silencioso
  // -------------------------------------------------------------------------
  it('10. type=story_mention → ack silencioso (não suportado ainda)', async () => {
    const storyEvent = {
      type: 'story_mention',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      provider: 'meta_instagram',
      contactRemoteId: '12345678',
      externalId: 'story-ext-id',
      mediaRef: { url: 'https://example.com/story.jpg' },
      storyId: 'story-123',
    };
    mockEnvelopeSuccess(storyEvent);
    const buf = makeEnvelopeBuffer(storyEvent);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    expect(mockPersistInboundMessage).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 11: [F16-S22] conversa nova (leadId null) → chama linkOrCreateLeadForConversation
  // -------------------------------------------------------------------------
  it('11. [F16-S22] conversa sem lead (leadId null) → chama linkOrCreateLeadForConversation', async () => {
    mockEnsureContactConversation.mockResolvedValueOnce({
      conversation: { id: CONVERSATION_ID, leadId: null },
      created: true,
    });

    const event = makeMessageEvent();
    const buf = makeEnvelopeBuffer(event);
    mockEnvelopeSuccess(event);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    expect(mockLinkOrCreateLeadForConversation).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        conversationId: CONVERSATION_ID,
        organizationId: ORG_ID,
        contactRemoteId: event.contactRemoteId,
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 12: [F16-S22] conversa existente com lead → pula auto-link (idempotência)
  // -------------------------------------------------------------------------
  it('12. [F16-S22] conversa com leadId já preenchido → pula linkOrCreateLeadForConversation', async () => {
    const EXISTING_LEAD_ID = '00000000-0000-0000-0000-000000000099';
    mockEnsureContactConversation.mockResolvedValueOnce({
      conversation: { id: CONVERSATION_ID, leadId: EXISTING_LEAD_ID },
      created: false,
    });

    const event = makeMessageEvent();
    const buf = makeEnvelopeBuffer(event);
    mockEnvelopeSuccess(event);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    // Com leadId já preenchido, não deve chamar linkOrCreateLeadForConversation
    expect(mockLinkOrCreateLeadForConversation).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 13: [F16-S28] gate IA passa → publica em hm.q.livechat.ai
  // -------------------------------------------------------------------------
  it('13. [F16-S28] shouldAiRespond=true → publica em hm.q.livechat.ai', async () => {
    mockShouldAiRespond.mockResolvedValueOnce(true);

    const event = makeMessageEvent();
    const buf = makeEnvelopeBuffer(event);
    mockEnvelopeSuccess(event);

    const result = await processMessage(buf, mockDb as never);

    expect(result).toBe('ack');
    // Deve ter publicado no livechat.ai
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.livechat.ai',
      expect.objectContaining({
        payload: expect.objectContaining({
          organizationId: ORG_ID,
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
        }),
      }),
    );
    // Deve ter publicado no socket relay também
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({ payload: expect.objectContaining({ event: 'message:new' }) }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 14: [F16-S28] gate IA falha → nao publica, ack normal
  // -------------------------------------------------------------------------
  it('14. [F16-S28] shouldAiRespond lança erro → não publica em livechat.ai, ack normal', async () => {
    mockShouldAiRespond.mockRejectedValueOnce(new Error('gate error'));

    const event = makeMessageEvent();
    const buf = makeEnvelopeBuffer(event);
    mockEnvelopeSuccess(event);

    const result = await processMessage(buf, mockDb as never);

    // Falha do gate nao deve quebrar o ack
    expect(result).toBe('ack');
    // Nao deve ter publicado no livechat.ai
    expect(mockPublish).not.toHaveBeenCalledWith('hm.q.livechat.ai', expect.anything());
    // Mas deve ter publicado no socket relay (pipeline normal)
    expect(mockPublish).toHaveBeenCalledWith('hm.q.socket.relay', expect.anything());
  });
});
