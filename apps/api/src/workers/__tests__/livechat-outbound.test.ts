// =============================================================================
// livechat-outbound.test.ts — Testes do worker F16-S10.
//
// Estratégia: mock de RabbitMQ client, Redis (lock), livechat service,
//   channelSecrets, GraphClient e db singleton.
//   processOutboundJob() é a função pura testada — sem consumer real.
//
// Cenários cobertos:
//   1. Envio bem-sucedido (text job) → ack + socket relay publicado
//   2. Janela template_only + mensagem de texto → ack + failed marcado + socket relay
//   2b. Janela template_only + template → envio realizado normalmente
//   3. Janela closed → ack + failed marcado + socket relay
//   4. ProviderError retryable (429) → nack com requeue=true
//   5. ProviderError terminal (4xx) → ack + failed marcado + socket relay
//   6. JSON malformado → nack sem requeue
//   7. Envelope inválido → nack sem requeue
//   8. DistributedLockError → nack com requeue=true
//   9. Conversa não encontrada → nack sem requeue
//  10. Segredos do canal ausentes → nack sem requeue
//  11. typing_indicator → ack silencioso
//  12. ig_private_reply → nack sem requeue
//  13. OutboundJob inválido (type=text sem content) → nack sem requeue
//  14. Lock FIFO chamado com a key correta por conversa
//  15. Áudio webm → prepareOutboundAudio transcodifica; serializer recebe job atualizado (F29-S03)
//  16. Áudio mp4/ogg → prepareOutboundAudio retorna null; job passa direto (F29-S03)
//  17. Falha na transcodificação → mensagem marcada como failed, Meta API não chamada (F29-S03)
//  18. Job de texto → prepareOutboundAudio nunca é chamado (F29-S03)
//  19. Mídia imagem → nunca transcodificada, passa direto (F29-S03)
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
    REDIS_URL: 'redis://localhost:6379',
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
// Mock db/client (singleton) — evitar referências a variáveis top-level no factory
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock db/schema (apenas referências de tabela)
// ---------------------------------------------------------------------------
vi.mock('../../db/schema/channelSecrets.js', () => ({
  channelSecrets: {
    channelId: 'channel_secrets.channel_id',
    accessTokenEnc: 'channel_secrets.access_token_enc',
  },
}));

vi.mock('../../db/schema/conversations.js', () => ({
  conversations: {
    id: 'conversations.id',
    lastInboundAt: 'conversations.last_inbound_at',
  },
}));

// ---------------------------------------------------------------------------
// Mock lib/queue
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
// Mock lib/redis — DistributedLockError como classe inline
// ---------------------------------------------------------------------------
const mockRunWithDistributedLock = vi.fn();

vi.mock('../../lib/redis/index.js', () => {
  class DistributedLockError extends Error {
    constructor(key: string) {
      super(`Lock nao adquirido: ${key}`);
      this.name = 'DistributedLockError';
    }
  }
  return {
    connectRedis: vi.fn(),
    closeRedis: vi.fn().mockResolvedValue(undefined),
    getRedis: vi.fn(),
    runWithDistributedLock: (...args: unknown[]) => mockRunWithDistributedLock(...args),
    DistributedLockError,
  };
});

// ---------------------------------------------------------------------------
// Mock lib/crypto/pii
// ---------------------------------------------------------------------------
const mockDecryptPii = vi.fn().mockResolvedValue('decrypted-access-token');

vi.mock('../../lib/crypto/pii.js', () => ({
  decryptPii: (...args: unknown[]) => mockDecryptPii(...args),
  encryptPii: vi.fn().mockResolvedValue(Buffer.from('encrypted')),
  hashDocument: vi.fn().mockReturnValue('hash'),
}));

// ---------------------------------------------------------------------------
// Mock integrations/channels/shared/graphClient
// ---------------------------------------------------------------------------
const mockClientPost = vi.fn();
const mockCreateGraphClient = vi.fn().mockReturnValue({
  post: (...args: unknown[]) => mockClientPost(...args),
  get: vi.fn(),
  downloadBytes: vi.fn(),
  postForm: vi.fn(),
});

vi.mock('../../integrations/channels/shared/graphClient.js', () => ({
  createGraphClient: (...args: unknown[]) => mockCreateGraphClient(...args),
}));

// ---------------------------------------------------------------------------
// Mock integrations/channels/meta/whatsapp/serializer
// ---------------------------------------------------------------------------
const mockSerializeOutboundJob = vi.fn().mockReturnValue({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: '5511999999999',
  type: 'text',
  text: { body: 'Olá!', preview_url: false },
});

vi.mock('../../integrations/channels/meta/whatsapp/serializer.js', () => ({
  serializeOutboundJob: (...args: unknown[]) => mockSerializeOutboundJob(...args),
}));

// ---------------------------------------------------------------------------
// Mock integrations/channels/shared/errors — ProviderError como classe inline
// ---------------------------------------------------------------------------
vi.mock('../../integrations/channels/shared/errors.js', () => {
  class ProviderError extends Error {
    readonly upstreamStatus: number;
    readonly providerCode?: number | undefined;
    readonly isRetryable: boolean;

    constructor(message: string, upstreamStatus: number, providerCode?: number) {
      super(message);
      this.name = 'ProviderError';
      this.upstreamStatus = upstreamStatus;
      if (providerCode !== undefined) {
        this.providerCode = providerCode;
      }
      this.isRetryable = upstreamStatus === 429 || upstreamStatus >= 500 || upstreamStatus === 0;
      Object.setPrototypeOf(this, ProviderError.prototype);
    }
  }

  class ChannelError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'ChannelError';
    }
  }

  return { ProviderError, ChannelError };
});

// ---------------------------------------------------------------------------
// Mock lib/media/prepareOutboundAudio (F29-S03)
// ---------------------------------------------------------------------------
const mockPrepareOutboundAudio = vi.fn().mockResolvedValue(null);

vi.mock('../../lib/media/prepareOutboundAudio.js', () => ({
  prepareOutboundAudio: (...args: unknown[]) => mockPrepareOutboundAudio(...args),
}));

// ---------------------------------------------------------------------------
// Mock livechat service
// ---------------------------------------------------------------------------
const mockFindChannel = vi.fn();
const mockGetComposerState = vi.fn();
const mockUpdateViewStatus = vi.fn();

vi.mock('../../modules/livechat/service.js', () => ({
  findChannel: (...args: unknown[]) => mockFindChannel(...args),
  getComposerState: (...args: unknown[]) => mockGetComposerState(...args),
  updateViewStatus: (...args: unknown[]) => mockUpdateViewStatus(...args),
  NotFoundError: class NotFoundError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'NotFoundError';
    }
  },
}));

// ---------------------------------------------------------------------------
// Import do módulo sob teste (APÓS todos os mocks)
// ---------------------------------------------------------------------------
import { db as mockDbSingleton } from '../../db/client.js';
import { ProviderError } from '../../integrations/channels/shared/errors.js';
import { envelopeSchema } from '../../lib/queue/envelope.js';
import { DistributedLockError } from '../../lib/redis/index.js';
import { processOutboundJob } from '../livechat-outbound.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const CHANNEL_ID = '00000000-0000-0000-0000-000000000002';
const CONVERSATION_ID = '00000000-0000-0000-0000-000000000003';
const MESSAGE_ID = '00000000-0000-0000-0000-000000000004';
const WAMID = 'wamid.HBgLNTUxMTk5OTk5OTkVAgASGBQyMkI2RjYwQkE4RUE2OTA3MBMA';

/** Canal padrão meta_whatsapp. */
const DEFAULT_CHANNEL = {
  id: CHANNEL_ID,
  organizationId: ORG_ID,
  provider: 'meta_whatsapp',
  phoneNumberId: '123456789',
  cityId: null,
  name: 'Canal Teste',
  displayHandle: '+5511999990000',
  phoneNumberEnc: null,
  wabaId: null,
  metaAppId: null,
  igUserId: null,
  igUsername: null,
  igAccountType: null,
  fbPageId: null,
  wahaSessionId: null,
  isActive: true,
  isDefault: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

/** Conversa padrão com janela aberta (lastInboundAt recente). */
const DEFAULT_CONVERSATION = {
  id: CONVERSATION_ID,
  lastInboundAt: new Date(),
};

/** ComposerState padrão — janela open. */
const DEFAULT_COMPOSER_OPEN = {
  conversationId: CONVERSATION_ID,
  provider: 'meta_whatsapp' as const,
  window: 'open' as const,
  lastInboundAt: new Date(),
  remainingMs: 23 * 60 * 60 * 1000,
};

/** Segredo padrão do canal. */
const DEFAULT_SECRET = {
  accessTokenEnc: Buffer.from('enc-token'),
};

/** Referência ao select mockado no singleton db. */
function getMockDbSelect(): ReturnType<typeof vi.fn> {
  // `as` justificado: o módulo db/client.js está mockado com vi.fn() — downcast seguro para testes.
  return mockDbSingleton.select as ReturnType<typeof vi.fn>;
}

/** Configura o select mockado para retornar conversa e secret em sequência. */
function setupDefaultDbSelect(): void {
  getMockDbSelect()
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([DEFAULT_CONVERSATION]),
        }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([DEFAULT_SECRET]),
        }),
      }),
    });
}

/** Cria um OutboundJob de texto. */
function makeTextJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'text',
    organizationId: ORG_ID,
    channelId: CHANNEL_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    contactRemoteId: '5511999999999',
    content: 'Olá, como posso ajudar?',
    ...overrides,
  };
}

/** Cria um OutboundJob de mídia (audio por padrão). */
function makeMediaJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'media',
    organizationId: ORG_ID,
    channelId: CHANNEL_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    contactRemoteId: '5511999999999',
    mediaKind: 'audio',
    publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
    mime: 'audio/webm;codecs=opus',
    ...overrides,
  };
}

/** Cria um OutboundJob de template. */
function makeTemplateJob(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'template',
    organizationId: ORG_ID,
    channelId: CHANNEL_ID,
    conversationId: CONVERSATION_ID,
    messageId: MESSAGE_ID,
    contactRemoteId: '5511999999999',
    templateName: 'boas_vindas',
    languageCode: 'pt_BR',
    components: [],
    ...overrides,
  };
}

/** Monta um Buffer com envelope válido. */
function makeEnvelopeBuffer(payload: unknown): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: 'env-uuid',
      type: 'hm.q.outbound.request',
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
      type: 'hm.q.outbound.request',
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

  // Lock: executa fn() diretamente (sem bloqueio)
  mockRunWithDistributedLock.mockImplementation(
    async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn(),
  );

  // Canal padrão
  mockFindChannel.mockResolvedValue(DEFAULT_CHANNEL);

  // DB select: conversa → secret
  setupDefaultDbSelect();

  // Janela aberta
  mockGetComposerState.mockReturnValue(DEFAULT_COMPOSER_OPEN);

  // decryptPii retorna token decifrado
  mockDecryptPii.mockResolvedValue('decrypted-access-token');

  // Meta API retorna sucesso com wamid
  mockClientPost.mockResolvedValue({
    messaging_product: 'whatsapp',
    contacts: [{ input: '5511999999999', wa_id: '5511999999999' }],
    messages: [{ id: WAMID }],
  });

  // Serializer retorna payload válido
  mockSerializeOutboundJob.mockReturnValue({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '5511999999999',
    type: 'text',
    text: { body: 'Olá, como posso ajudar?', preview_url: false },
  });

  // updateViewStatus: sucesso silencioso
  mockUpdateViewStatus.mockResolvedValue(undefined);

  // prepareOutboundAudio: por padrão, nada muda (job passa direto)
  mockPrepareOutboundAudio.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('processOutboundJob', () => {
  // -------------------------------------------------------------------------
  // Cenário 1: Envio bem-sucedido → ack + socket relay
  // -------------------------------------------------------------------------
  it('1. envio bem-sucedido (text) → ack + socket relay publicado', async () => {
    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });

    // updateViewStatus chamado com 'sent' e externalId (wamid)
    expect(mockUpdateViewStatus).toHaveBeenCalledWith(mockDbSingleton, MESSAGE_ID, 'sent', WAMID);

    // socket relay publicado com message:new
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'message:new',
          data: expect.objectContaining({
            messageId: MESSAGE_ID,
            conversationId: CONVERSATION_ID,
            viewStatus: 'sent',
            externalId: WAMID,
          }),
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 2: Janela template_only + mensagem de texto → ack + failed
  // -------------------------------------------------------------------------
  it('2. janela template_only + texto → ack + failed marcado + status relay', async () => {
    mockGetComposerState.mockReturnValue({
      conversationId: CONVERSATION_ID,
      provider: 'meta_whatsapp',
      window: 'template_only',
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      remainingMs: 0,
    });

    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    // Mensagem marcada como failed
    expect(mockUpdateViewStatus).toHaveBeenCalledWith(mockDbSingleton, MESSAGE_ID, 'failed');
    // socket relay com status_changed failed
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'message:status_changed',
          data: expect.objectContaining({ viewStatus: 'failed', messageId: MESSAGE_ID }),
        }),
      }),
    );
    // Meta API NÃO deve ter sido chamada
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 2b: Janela template_only + template → envio realizado
  // -------------------------------------------------------------------------
  it('2b. janela template_only + template → ack + envio realizado', async () => {
    mockGetComposerState.mockReturnValue({
      conversationId: CONVERSATION_ID,
      provider: 'meta_whatsapp',
      window: 'template_only',
      lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      remainingMs: 0,
    });

    const job = makeTemplateJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    // Meta API DEVE ter sido chamada
    expect(mockClientPost).toHaveBeenCalled();
    expect(mockUpdateViewStatus).toHaveBeenCalledWith(mockDbSingleton, MESSAGE_ID, 'sent', WAMID);
  });

  // -------------------------------------------------------------------------
  // Cenário 3: Janela closed → ack + failed marcado
  // -------------------------------------------------------------------------
  it('3. janela closed → ack + failed marcado + status relay', async () => {
    mockGetComposerState.mockReturnValue({
      conversationId: CONVERSATION_ID,
      provider: 'meta_whatsapp',
      window: 'closed',
      lastInboundAt: null,
      remainingMs: 0,
    });

    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockUpdateViewStatus).toHaveBeenCalledWith(mockDbSingleton, MESSAGE_ID, 'failed');
    expect(mockClientPost).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'message:status_changed',
          data: expect.objectContaining({ viewStatus: 'failed' }),
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 4: ProviderError retryable (429) → nack requeue=true
  // -------------------------------------------------------------------------
  it('4. ProviderError retryable (429) → nack com requeue=true', async () => {
    mockClientPost.mockRejectedValueOnce(new ProviderError('Meta API rate limit', 429, 131026));

    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: true });
    // NÃO deve marcar como failed (vai tentar novamente)
    expect(mockUpdateViewStatus).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 5: ProviderError terminal (4xx opt-out) → ack + failed
  // -------------------------------------------------------------------------
  it('5. ProviderError terminal (130472 opt-out) → ack + failed marcado', async () => {
    mockClientPost.mockRejectedValueOnce(
      new ProviderError('Contato optou por nao receber mensagens', 400, 130472),
    );

    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockUpdateViewStatus).toHaveBeenCalledWith(mockDbSingleton, MESSAGE_ID, 'failed');
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'message:status_changed',
          data: expect.objectContaining({ viewStatus: 'failed' }),
        }),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenário 6: JSON malformado → nack sem requeue
  // -------------------------------------------------------------------------
  it('6. JSON malformado → nack sem requeue', async () => {
    const buf = Buffer.from('{ invalid json ');

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: false });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 7: Envelope inválido → nack sem requeue
  // -------------------------------------------------------------------------
  it('7. envelope inválido (sem organizationId) → nack sem requeue', async () => {
    mockEnvelopeFailure();
    const buf = Buffer.from(JSON.stringify({ id: 'x', type: 'y', payload: {} }));

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: false });
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 8: DistributedLockError → nack requeue=true
  // -------------------------------------------------------------------------
  it('8. DistributedLockError (lock ocupado) → nack com requeue=true', async () => {
    mockRunWithDistributedLock.mockRejectedValueOnce(
      new DistributedLockError('hm:lock:outbound:' + CONVERSATION_ID),
    );

    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: true });
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 9: Conversa não encontrada → nack sem requeue
  // -------------------------------------------------------------------------
  it('9. conversa não encontrada → nack sem requeue', async () => {
    // Reset e configura: select de conversa retorna vazio
    getMockDbSelect().mockReset();
    getMockDbSelect().mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: false });
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 10: Segredos do canal ausentes → nack sem requeue
  // -------------------------------------------------------------------------
  it('10. segredos do canal ausentes → nack sem requeue', async () => {
    getMockDbSelect().mockReset();
    getMockDbSelect()
      .mockReturnValueOnce({
        // conversa existe
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([DEFAULT_CONVERSATION]),
          }),
        }),
      })
      .mockReturnValueOnce({
        // secrets ausentes
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: false });
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 11: typing_indicator → ack silencioso
  // -------------------------------------------------------------------------
  it('11. typing_indicator → ack silencioso sem envio à Meta', async () => {
    const typingJob = {
      type: 'typing_indicator',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      conversationId: CONVERSATION_ID,
      contactRemoteId: '5511999999999',
      kind: 'typing',
    };
    mockEnvelopeSuccess(typingJob);
    const buf = makeEnvelopeBuffer(typingJob);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockClientPost).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 12: ig_private_reply → nack sem requeue (não suportado)
  // -------------------------------------------------------------------------
  it('12. ig_private_reply → nack sem requeue (adapter IG não implementado)', async () => {
    const igJob = {
      type: 'ig_private_reply',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      commentId: 'comment-abc',
      content: 'Olá!',
    };
    mockEnvelopeSuccess(igJob);
    const buf = makeEnvelopeBuffer(igJob);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: false });
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 13: OutboundJob inválido (type=text sem content) → nack sem requeue
  // -------------------------------------------------------------------------
  it('13. OutboundJob inválido (type=text sem content) → nack sem requeue', async () => {
    const invalidJob = {
      type: 'text',
      organizationId: ORG_ID,
      channelId: CHANNEL_ID,
      conversationId: CONVERSATION_ID,
      messageId: MESSAGE_ID,
      contactRemoteId: '5511999999999',
      // content: AUSENTE (campo obrigatório no OutboundJobSchema)
    };
    mockEnvelopeSuccess(invalidJob);
    const buf = makeEnvelopeBuffer(invalidJob);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'nack', requeue: false });
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Cenário 14: Lock FIFO chamado com a key correta
  // -------------------------------------------------------------------------
  it('14. lock FIFO: runWithDistributedLock chamado com key de conversa correta', async () => {
    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    await processOutboundJob(buf, mockDbSingleton as never);

    // A key do lock deve conter o conversationId
    expect(mockRunWithDistributedLock).toHaveBeenCalledWith(
      expect.stringContaining(CONVERSATION_ID),
      expect.any(Number),
      expect.any(Function),
      expect.objectContaining({ maxWaitMs: expect.any(Number) }),
    );
  });

  // -------------------------------------------------------------------------
  // Cenários F29-S03: transcodificação de áudio webm→ogg antes do envio
  // -------------------------------------------------------------------------

  it('15. áudio webm → prepareOutboundAudio transcodifica; serializer recebe job atualizado', async () => {
    mockPrepareOutboundAudio.mockResolvedValueOnce({
      publicMediaUrl: 'https://storage.example.com/new/audio.ogg',
      mime: 'audio/ogg',
    });

    const job = makeMediaJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockPrepareOutboundAudio).toHaveBeenCalledWith({
      mediaKind: 'audio',
      mime: 'audio/webm;codecs=opus',
      publicMediaUrl: 'https://storage.example.com/orig/audio.webm',
      organizationId: ORG_ID,
    });
    // O serializer deve receber o job JÁ transcodificado (url + mime ogg)
    expect(mockSerializeOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        publicMediaUrl: 'https://storage.example.com/new/audio.ogg',
        mime: 'audio/ogg',
      }),
    );
    expect(mockClientPost).toHaveBeenCalled();
  });

  it('16. áudio mp4/ogg (já compatível) → prepareOutboundAudio retorna null; job passa direto', async () => {
    mockPrepareOutboundAudio.mockResolvedValueOnce(null);

    const job = makeMediaJob({
      publicMediaUrl: 'https://storage.example.com/orig/audio.mp4',
      mime: 'audio/mp4',
    });
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockPrepareOutboundAudio).toHaveBeenCalledTimes(1);
    // Job inalterado repassado ao serializer — nenhuma URL/mime nova
    expect(mockSerializeOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        publicMediaUrl: 'https://storage.example.com/orig/audio.mp4',
        mime: 'audio/mp4',
      }),
    );
    expect(mockClientPost).toHaveBeenCalled();
  });

  it('17. falha na transcodificação → mensagem marcada como failed (ack); Meta API não chamada', async () => {
    mockPrepareOutboundAudio.mockRejectedValueOnce(
      new Error('Falha ao transcodificar áudio webm→ogg (remux e re-encode falharam)'),
    );

    const job = makeMediaJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockUpdateViewStatus).toHaveBeenCalledWith(mockDbSingleton, MESSAGE_ID, 'failed');
    expect(mockPublish).toHaveBeenCalledWith(
      'hm.q.socket.relay',
      expect.objectContaining({
        payload: expect.objectContaining({
          event: 'message:status_changed',
          data: expect.objectContaining({ viewStatus: 'failed', messageId: MESSAGE_ID }),
        }),
      }),
    );
    expect(mockClientPost).not.toHaveBeenCalled();
  });

  it('18. job de texto → prepareOutboundAudio NUNCA é chamado (só afeta mídia)', async () => {
    const job = makeTextJob();
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockPrepareOutboundAudio).not.toHaveBeenCalled();
  });

  it('19. mídia imagem → prepareOutboundAudio é chamado mas com mediaKind=image (helper decide passthrough)', async () => {
    mockPrepareOutboundAudio.mockResolvedValueOnce(null);

    const job = makeMediaJob({
      mediaKind: 'image',
      publicMediaUrl: 'https://storage.example.com/orig/photo.jpg',
      mime: 'image/jpeg',
    });
    mockEnvelopeSuccess(job);
    const buf = makeEnvelopeBuffer(job);

    const result = await processOutboundJob(buf, mockDbSingleton as never);

    expect(result).toEqual({ action: 'ack' });
    expect(mockPrepareOutboundAudio).toHaveBeenCalledWith(
      expect.objectContaining({ mediaKind: 'image' }),
    );
    expect(mockSerializeOutboundJob).toHaveBeenCalledWith(
      expect.objectContaining({
        publicMediaUrl: 'https://storage.example.com/orig/photo.jpg',
        mime: 'image/jpeg',
      }),
    );
    expect(mockClientPost).toHaveBeenCalled();
  });
});
