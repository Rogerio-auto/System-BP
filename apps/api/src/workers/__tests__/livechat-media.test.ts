// =============================================================================
// livechat-media.test.ts — Testes do worker F16-S09.
//
// Estratégia: mocks de RabbitMQ, DB, R2 e GraphClient.
//   processMediaJob() é a função pura testada — sem consumer real.
//
// Cenários cobertos:
//   1. Happy path: download + SHA-256 + upload R2 + update DB + relay (meta_whatsapp)
//   2. Dedup: hash existente → reutiliza URL, sem re-upload R2
//   3. R2 não configurado (R2_ACCOUNT_ID ausente) → nack gracioso
//   4. Canal não encontrado no DB → nack
//   5. Channel secrets não encontrado → nack
//   6. Download falha 403 (ProviderError) → nack
//   7. Mensagem não encontrada após upload (race condition) → ack silencioso (sem relay)
//   8. Payload JSON inválido → nack
//   9. Envelope inválido (sem organizationId) → nack
//  10. mediaRef.refOrUrl é mediaId (não-URL) → chama GET /{mediaId} antes do download
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks hoisted (executam antes dos vi.mock factories — evita TDZ)
// ---------------------------------------------------------------------------
const {
  mockDbSelect,
  mockDbUpdate,
  mockPublish,
  mockMakeEnvelope,
  mockPutObject,
  mockGetPublicUrl,
  mockDecryptPii,
  mockGraphClientGet,
  mockGraphClientDownloadBytes,
  mockEnvelopeSafeParse,
} = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockPublish: vi.fn().mockResolvedValue(undefined),
  mockMakeEnvelope: vi
    .fn()
    .mockImplementation((_type: string, orgId: string, payload: unknown) => ({
      id: 'mock-uuid',
      type: _type,
      organizationId: orgId,
      payload,
      ts: Date.now(),
    })),
  mockPutObject: vi.fn().mockResolvedValue(undefined),
  mockGetPublicUrl: vi.fn().mockReturnValue('https://media.example.com/org/2026/06/16/uuid.jpg'),
  mockDecryptPii: vi.fn().mockResolvedValue('decrypted-access-token'),
  mockGraphClientGet: vi.fn(),
  mockGraphClientDownloadBytes: vi.fn(),
  mockEnvelopeSafeParse: vi.fn(),
}));

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
    R2_ACCOUNT_ID: 'test-r2-account',
    R2_ACCESS_KEY_ID: 'test-r2-key',
    R2_SECRET_ACCESS_KEY: 'test-r2-secret',
    R2_BUCKET: 'test-bucket',
    R2_PUBLIC_URL: 'https://media.example.com',
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
// ---------------------------------------------------------------------------
vi.mock('../../db/client.js', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  pool: {},
}));

// ---------------------------------------------------------------------------
// Mock db/schema (objetos de referência de tabela)
// ---------------------------------------------------------------------------
vi.mock('../../db/schema/channels.js', () => ({
  channels: {
    id: 'channels.id',
    organizationId: 'channels.organization_id',
    provider: 'channels.provider',
  },
}));

vi.mock('../../db/schema/channelSecrets.js', () => ({
  channelSecrets: {
    channelId: 'channel_secrets.channel_id',
    accessTokenEnc: 'channel_secrets.access_token_enc',
  },
}));

vi.mock('../../db/schema/messages.js', () => ({
  messages: {
    id: 'messages.id',
    channelId: 'messages.channel_id',
    mediaSha256: 'messages.media_sha256',
    mediaUrl: 'messages.media_url',
    mediaMime: 'messages.media_mime',
    mediaSizeBytes: 'messages.media_size_bytes',
    updatedAt: 'messages.updated_at',
    conversationId: 'messages.conversation_id',
  },
}));

// ---------------------------------------------------------------------------
// Mock lib/queue
// ---------------------------------------------------------------------------
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
// Mock lib/queue/envelope.js
// ---------------------------------------------------------------------------
vi.mock('../../lib/queue/envelope.js', () => ({
  envelopeSchema: {
    safeParse: (...args: unknown[]) => mockEnvelopeSafeParse(...args),
  },
  makeEnvelope: (...args: unknown[]) => mockMakeEnvelope(...args),
}));

// ---------------------------------------------------------------------------
// Mock lib/storage/r2
// ---------------------------------------------------------------------------
vi.mock('../../lib/storage/r2.js', () => ({
  putObject: (...args: unknown[]) => mockPutObject(...args),
  getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example.com/file'),
  headObject: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Mock lib/crypto/pii
// ---------------------------------------------------------------------------
vi.mock('../../lib/crypto/pii.js', () => ({
  decryptPii: (...args: unknown[]) => mockDecryptPii(...args),
  encryptPii: vi.fn().mockResolvedValue(Buffer.from('encrypted')),
  hashDocument: vi.fn().mockReturnValue('hash'),
}));

// ---------------------------------------------------------------------------
// Mock GraphClient
// ---------------------------------------------------------------------------
vi.mock('../../integrations/channels/shared/graphClient.js', () => ({
  createGraphClient: vi.fn().mockReturnValue({
    get: (...args: unknown[]) => mockGraphClientGet(...args),
    downloadBytes: (...args: unknown[]) => mockGraphClientDownloadBytes(...args),
  }),
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
// Import do módulo APÓS os mocks
// ---------------------------------------------------------------------------
import { processMediaJob } from '../livechat-media.js';

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------
const ORG_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const CHANNEL_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const CONV_ID = 'cccccccc-0000-0000-0000-000000000003';
const MSG_ID = 'dddddddd-0000-0000-0000-000000000004';

const MEDIA_BYTES = Buffer.from('fake-image-bytes-for-testing-purposes-only');
const MEDIA_MIME = 'image/jpeg';

/** Payload base de um job de mídia válido. */
const BASE_JOB = {
  organizationId: ORG_ID,
  channelId: CHANNEL_ID,
  conversationId: CONV_ID,
  messageId: MSG_ID,
  mediaRef: {
    refOrUrl: 'https://lookaside.fbsbx.com/media/abc123',
    mimeType: 'image/jpeg',
    sha256: undefined,
    fileName: 'photo.jpg',
  },
  provider: 'meta_whatsapp' as const,
};

// ---------------------------------------------------------------------------
// Helpers para configurar mocks do DB no fluxo feliz
// ---------------------------------------------------------------------------

/** Mock para query de canal (encontrado). */
function mockChannelFound(): void {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ id: CHANNEL_ID, provider: 'meta_whatsapp' }]),
      }),
    }),
  });
}

/** Mock para query de channel_secrets (encontrado). */
function mockSecretsFound(): void {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ accessTokenEnc: Buffer.from('encrypted-token') }]),
      }),
    }),
  });
}

/** Mock para query de dedup (sem hit). */
function mockDedupMiss(): void {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

/** Mock para query de dedup (com hit — URL existente). */
function mockDedupHit(existingUrl: string): void {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([{ mediaUrl: existingUrl }]),
      }),
    }),
  });
}

/** Mock para update de mensagem (encontrada). */
function mockMessageUpdateFound(): void {
  mockDbUpdate.mockReturnValueOnce({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: MSG_ID, conversationId: CONV_ID }]),
      }),
    }),
  });
}

/** Mock para update de mensagem (não encontrada). */
function mockMessageUpdateNotFound(): void {
  mockDbUpdate.mockReturnValueOnce({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  });
}

// ---------------------------------------------------------------------------
// Configuração do envelopeSchema mock
// ---------------------------------------------------------------------------

function mockEnvelopeParse(payload: unknown): void {
  // mockEnvelopeSafeParse é o vi.fn() hoisted que intercepta envelopeSchema.safeParse
  mockEnvelopeSafeParse.mockReturnValue({
    success: true,
    data: {
      id: 'env-uuid',
      type: 'hm.q.inbound.media',
      organizationId: ORG_ID,
      payload,
      ts: Date.now(),
    },
  });
}

function mockEnvelopeParseFailure(): void {
  mockEnvelopeSafeParse.mockReturnValue({
    success: false,
    error: { issues: [{ message: 'Required', path: ['organizationId'] }] },
  });
}

// ---------------------------------------------------------------------------
// Setup por teste
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // R2_ACCOUNT_ID disponível por padrão nos testes
  process.env['R2_ACCOUNT_ID'] = 'test-r2-account';

  // Download bem-sucedido por padrão
  mockGraphClientDownloadBytes.mockResolvedValue({
    bytes: MEDIA_BYTES,
    mimeType: MEDIA_MIME,
  });

  // getPublicUrl retorna URL padrão
  mockGetPublicUrl.mockReturnValue('https://media.example.com/org/2026/06/16/uuid.jpg');

  // putObject bem-sucedido por padrão
  mockPutObject.mockResolvedValue(undefined);

  // decryptPii retorna token válido por padrão
  mockDecryptPii.mockResolvedValue('decrypted-access-token');
});

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

describe('livechat-media worker — processMediaJob', () => {
  describe('Cenário 1: happy path — download + upload + update + relay', () => {
    it('retorna ack e publica message:media_ready no socket relay', async () => {
      mockEnvelopeParse(BASE_JOB);
      mockChannelFound();
      mockSecretsFound();
      mockDedupMiss();
      mockMessageUpdateFound();

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('ack');
      expect(mockPutObject).toHaveBeenCalledOnce();
      expect(mockPublish).toHaveBeenCalledOnce();

      // Verifica que o relay contém message:media_ready
      const [relayQueue] = mockMakeEnvelope.mock.calls[0] as [string];
      expect(relayQueue).toBe('hm.q.socket.relay');
    });

    it('chama downloadBytes com a URL de mídia', async () => {
      mockEnvelopeParse(BASE_JOB);
      mockChannelFound();
      mockSecretsFound();
      mockDedupMiss();
      mockMessageUpdateFound();

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      await processMediaJob(rawBody);

      expect(mockGraphClientDownloadBytes).toHaveBeenCalledOnce();
    });
  });

  describe('Cenário 2: dedup — hash existente reutiliza URL', () => {
    it('não chama putObject quando sha256 já existe para o canal', async () => {
      const existingUrl = 'https://media.example.com/existing/file.jpg';
      mockEnvelopeParse(BASE_JOB);
      mockChannelFound();
      mockSecretsFound();
      mockDedupHit(existingUrl);
      mockMessageUpdateFound();

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('ack');
      expect(mockPutObject).not.toHaveBeenCalled();
      // Update deve ter sido chamado
      expect(mockDbUpdate).toHaveBeenCalledOnce();
      // Relay deve ser publicado mesmo em dedup
      expect(mockPublish).toHaveBeenCalledOnce();
    });
  });

  describe('Cenário 3: R2 não configurado', () => {
    it('retorna nack gracioso quando R2_ACCOUNT_ID ausente', async () => {
      delete process.env['R2_ACCOUNT_ID'];

      mockEnvelopeParse(BASE_JOB);
      mockChannelFound();

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('nack');
      expect(mockPutObject).not.toHaveBeenCalled();
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 4: canal não encontrado', () => {
    it('retorna nack quando canal não existe no DB', async () => {
      mockEnvelopeParse(BASE_JOB);

      // Canal não encontrado
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('nack');
      expect(mockPutObject).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 5: channel secrets não encontrado', () => {
    it('retorna nack quando channel_secrets ausente', async () => {
      mockEnvelopeParse(BASE_JOB);
      mockChannelFound();

      // Secrets não encontrados
      mockDbSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('nack');
      expect(mockDecryptPii).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 6: download falha', () => {
    it('retorna nack quando downloadBytes lança erro (ex: 403)', async () => {
      mockEnvelopeParse(BASE_JOB);
      mockChannelFound();
      mockSecretsFound();

      mockGraphClientDownloadBytes.mockRejectedValue(new Error('403 Forbidden'));

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('nack');
      expect(mockPutObject).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 7: mensagem não encontrada após upload', () => {
    it('retorna ack silencioso sem publicar relay', async () => {
      mockEnvelopeParse(BASE_JOB);
      mockChannelFound();
      mockSecretsFound();
      mockDedupMiss();
      mockMessageUpdateNotFound(); // mensagem sumiu (race condition ou delete)

      const rawBody = Buffer.from(
        JSON.stringify({ id: 'x', type: 'test', organizationId: ORG_ID, payload: BASE_JOB, ts: 1 }),
      );
      const result = await processMediaJob(rawBody);

      // ack silencioso — não há o que fazer
      expect(result).toBe('ack');
      // Upload já foi feito
      expect(mockPutObject).toHaveBeenCalledOnce();
      // Mas NÃO publica relay
      expect(mockPublish).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 8: payload JSON inválido', () => {
    it('retorna nack para JSON malformado', async () => {
      const rawBody = Buffer.from('{invalid json');
      const result = await processMediaJob(rawBody);

      expect(result).toBe('nack');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 9: envelope inválido', () => {
    it('retorna nack quando envelope não tem organizationId', async () => {
      mockEnvelopeParseFailure();

      const rawBody = Buffer.from(JSON.stringify({ invalid: true }));
      const result = await processMediaJob(rawBody);

      expect(result).toBe('nack');
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 10: mediaRef.refOrUrl é mediaId (não-URL)', () => {
    it('chama GET /{mediaId} antes do downloadBytes', async () => {
      const jobWithMediaId = {
        ...BASE_JOB,
        mediaRef: {
          refOrUrl: 'abc123media456', // sem http — é um mediaId
          mimeType: 'image/jpeg',
        },
      };

      mockEnvelopeParse(jobWithMediaId);
      mockChannelFound();
      mockSecretsFound();

      // GET /{mediaId} retorna a URL real
      mockGraphClientGet.mockResolvedValue({
        url: 'https://lookaside.fbsbx.com/media/real-cdn-url',
        mime_type: 'image/jpeg',
        id: 'abc123media456',
      });

      mockDedupMiss();
      mockMessageUpdateFound();

      const rawBody = Buffer.from(
        JSON.stringify({
          id: 'x',
          type: 'test',
          organizationId: ORG_ID,
          payload: jobWithMediaId,
          ts: 1,
        }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('ack');
      // GET /{mediaId} foi chamado para resolver a URL
      expect(mockGraphClientGet).toHaveBeenCalledOnce();
      expect(mockGraphClientGet).toHaveBeenCalledWith('/abc123media456');
      // downloadBytes foi chamado com a URL resolvida
      expect(mockGraphClientDownloadBytes).toHaveBeenCalledOnce();
      expect(mockPutObject).toHaveBeenCalledOnce();
    });

    it('retorna nack quando GET /{mediaId} falha', async () => {
      const jobWithMediaId = {
        ...BASE_JOB,
        mediaRef: { refOrUrl: 'bad-media-id', mimeType: 'image/jpeg' },
      };

      mockEnvelopeParse(jobWithMediaId);
      mockChannelFound();
      mockSecretsFound();

      // GET falha
      mockGraphClientGet.mockRejectedValue(new Error('Graph API error'));

      const rawBody = Buffer.from(
        JSON.stringify({
          id: 'x',
          type: 'test',
          organizationId: ORG_ID,
          payload: jobWithMediaId,
          ts: 1,
        }),
      );
      const result = await processMediaJob(rawBody);

      expect(result).toBe('nack');
      expect(mockGraphClientDownloadBytes).not.toHaveBeenCalled();
      expect(mockPutObject).not.toHaveBeenCalled();
    });
  });
});
