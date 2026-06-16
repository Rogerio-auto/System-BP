// =============================================================================
// meta-webhook.test.ts — Testes do webhook Meta multicanal (F16-S06).
//
// Estratégia: Fastify sobe com apenas metaWebhookRoutes; DB e serviços mockados.
//
// Cenários cobertos:
//   1. GET verify — verify_token correto + hub.mode=subscribe → 200 + challenge
//   2. GET verify — verify_token errado → 401
//   3. GET verify — hub.mode errado → 401
//   4. POST — HMAC inválido → 403
//   5. POST — HMAC ausente → 403
//   6. POST — payload válido, primeiro request → 200, published=1, skipped=0
//   7. POST — segundo request idêntico (dedup) → 200, published=0, skipped=1
//   8. POST — canal não encontrado → 200, published=0, skipped=0 (silent)
//   9. POST — payload fora do schema Meta → 200, published=0, skipped=0
//  10. POST — instagram object → provider=meta_instagram
//
// LGPD:
//   - rawPayload nunca aparece em audit_logs.after.
//   - event_id e provider são os únicos campos logados.
// =============================================================================
import { createHmac } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-zod-openapi';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — ANTES de qualquer import do módulo sob teste
// ---------------------------------------------------------------------------

// Mock pg para evitar conexão real
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

// ---- Mocks de DB -----------------------------------------------------------
// Cada consulta SELECT em routes.ts tem uma sequência previsível:
//   1. resolveChannelByEntryId → db.select(...).from(channels).where(eq(column, entryId))
//   2. resolveAppSecret       → db.select(...).from(channelSecrets).where(eq(...))
//   3. isDuplicate            → db.select(...).from(webhookEvents).where(and(...))
// + INSERT em webhook_events e INSERT em audit_logs (via transaction)
//
// Usamos mockWhere encadeado com resolvedValueOnce para simular cada resposta
// na ordem certa, sem depender de detectar a tabela.

const mockPublish = vi.fn().mockResolvedValue(undefined);

// Funções de retorno do select — controlamos por teste
let selectCallCount = 0;
let selectResponses: unknown[][] = [];

const mockWhere = vi.fn().mockImplementation(() => {
  const response = selectResponses[selectCallCount] ?? [];
  selectCallCount++;
  return Promise.resolve(response);
});

const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

// INSERT em webhook_events
const mockInsertValues = vi.fn().mockResolvedValue([]);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

// INSERT em audit_logs (via transaction)
const mockAuditValues = vi.fn().mockResolvedValue([]);
const mockTxInsert = vi.fn().mockReturnValue({ values: mockAuditValues });
const mockTx = { insert: mockTxInsert };
const mockTransaction = vi
  .fn()
  .mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));

vi.mock('../../../db/client.js', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    }),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock('../../../lib/queue/index.js', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
  makeEnvelope: (type: string, orgId: string, payload: unknown) => ({
    id: 'mock-envelope-uuid',
    type,
    organizationId: orgId,
    payload,
    ts: Date.now(),
  }),
  connectRabbitMQ: vi.fn(),
  closeRabbitMQ: vi.fn(),
}));

vi.mock('../../../lib/queue/topology.js', () => ({
  QUEUES: {
    inboundMessage: 'hm.q.inbound.message',
    inboundMedia: 'hm.q.inbound.media',
    outboundRequest: 'hm.q.outbound.request',
    socketRelay: 'hm.q.socket.relay',
  },
  EXCHANGE_CHANNELS: 'hm.channels',
  EXCHANGE_DLX: 'hm.dlx',
  assertTopology: vi.fn(),
}));

// Mock decryptPii para retornar secret em claro
const APP_SECRET = 'test-meta-app-secret-at-least-16chars!';
const mockDecryptPii = vi.fn().mockResolvedValue(APP_SECRET);
vi.mock('../../../lib/crypto/pii.js', () => ({
  decryptPii: (...args: unknown[]) => mockDecryptPii(...args),
  encryptPii: vi.fn(),
  hashDocument: vi.fn(),
  compareHash: vi.fn(),
  _testOnly: {},
}));

// ---------------------------------------------------------------------------
// Imports do módulo sob teste — após todos os mocks
// ---------------------------------------------------------------------------
import { metaWebhookRoutes } from '../routes.js';

// ---------------------------------------------------------------------------
// Constantes de teste
// ---------------------------------------------------------------------------

const VERIFY_TOKEN = 'test-verify-token-vitest';
const WABA_ID = 'waba-id-test-001';
const CHANNEL_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '00000000-0000-0000-0000-000000000001';

/** Gera header X-Hub-Signature-256 válido para rawBody. */
function makeSignatureHeader(rawBody: Buffer, secret = APP_SECRET): string {
  const hex = createHmac('sha256', secret).update(rawBody).digest('hex');
  return `sha256=${hex}`;
}

/** Payload de webhook Meta WhatsApp mínimo válido. */
function makeWaPayload(wabaId = WABA_ID): object {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: wabaId,
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5569900000000', phone_number_id: 'ph-id-001' },
              messages: [
                // LGPD: número e texto são PII — nunca logados (apenas IDs técnicos nos logs)
                { id: 'wamid.test', from: '5569988887777', type: 'text', text: { body: 'oi' } },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  };
}

/**
 * Configura os mocks de SELECT para um fluxo normal (canal encontrado, secret disponível,
 * sem dedup).
 *
 * Ordem dos SELECTs em routes.ts para POST:
 *   [0] resolveChannelByEntryId → retorna o canal
 *   [1] resolveAppSecret        → retorna { appSecretEnc: Buffer }
 *   [2] isDuplicate             → retorna [] (sem duplicado)
 */
function setupSelectMocksForHappyPath(
  channelOverride?: Partial<{
    id: string;
    organizationId: string;
    cityId: string | null;
    provider: string;
    isActive: boolean;
  }>,
): void {
  selectCallCount = 0;
  selectResponses = [
    // [0] resolveChannelByEntryId
    [
      {
        id: channelOverride?.id ?? CHANNEL_ID,
        organizationId: channelOverride?.organizationId ?? ORG_ID,
        cityId: channelOverride?.cityId ?? null,
        provider: channelOverride?.provider ?? 'meta_whatsapp',
        isActive: channelOverride?.isActive ?? true,
      },
    ],
    // [1] resolveAppSecret
    [{ appSecretEnc: Buffer.from('mock-enc-secret') }],
    // [2] isDuplicate
    [],
  ];
}

// ---------------------------------------------------------------------------
// Setup do app Fastify mínimo (sem buildApp completo — isola o módulo)
// ---------------------------------------------------------------------------

let app: FastifyInstance;

beforeAll(async () => {
  process.env['WHATSAPP_VERIFY_TOKEN'] = VERIFY_TOKEN;
  process.env['WHATSAPP_APP_SECRET'] = 'legacy-secret-not-used-here';
  process.env['NODE_ENV'] = 'test';

  app = Fastify({ logger: false }).withTypeProvider();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(metaWebhookRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  selectCallCount = 0;
  selectResponses = [];
  // Restaurar mockWhere após clearAllMocks
  mockWhere.mockImplementation(() => {
    const response = selectResponses[selectCallCount] ?? [];
    selectCallCount++;
    return Promise.resolve(response);
  });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockInsertValues.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockAuditValues.mockResolvedValue([]);
  mockTxInsert.mockReturnValue({ values: mockAuditValues });
  mockTransaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) =>
    fn(mockTx),
  );
  mockPublish.mockResolvedValue(undefined);
  mockDecryptPii.mockResolvedValue(APP_SECRET);
});

// ---------------------------------------------------------------------------
// GET /api/webhooks/meta — Handshake de verificação
// ---------------------------------------------------------------------------

describe('GET /api/webhooks/meta', () => {
  it('retorna hub.challenge quando verify_token e hub.mode corretos', async () => {
    const challenge = 'abc123xyz-challenge';
    const res = await app.inject({
      method: 'GET',
      url: '/api/webhooks/meta',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': challenge,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(challenge);
  });

  it('retorna 401 quando verify_token incorreto', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/webhooks/meta',
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token-here',
        'hub.challenge': 'abc123',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('retorna 401 quando hub.mode incorreto', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/webhooks/meta',
      query: {
        'hub.mode': 'unsubscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'abc123',
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/meta — Ingestão de eventos inbound
// ---------------------------------------------------------------------------

describe('POST /api/webhooks/meta', () => {
  it('processa evento válido com HMAC correto → 200, published=1', async () => {
    setupSelectMocksForHappyPath();

    const payload = makeWaPayload();
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = makeSignatureHeader(rawBody);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; published: number; skipped: number };
    expect(body.ok).toBe(true);
    expect(body.published).toBe(1);
    expect(body.skipped).toBe(0);
    expect(mockPublish).toHaveBeenCalledTimes(1);
  });

  it('segundo request idêntico é deduplicado → 200, published=0, skipped=1', async () => {
    // Override do dedup: [2] retorna um evento existente
    selectCallCount = 0;
    selectResponses = [
      // [0] resolveChannelByEntryId
      [
        {
          id: CHANNEL_ID,
          organizationId: ORG_ID,
          cityId: null,
          provider: 'meta_whatsapp',
          isActive: true,
        },
      ],
      // [1] resolveAppSecret
      [{ appSecretEnc: Buffer.from('mock-enc') }],
      // [2] isDuplicate → evento já existe
      [{ id: 'existing-event-uuid' }],
    ];

    const payload = makeWaPayload();
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = makeSignatureHeader(rawBody);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; published: number; skipped: number };
    expect(body.ok).toBe(true);
    expect(body.published).toBe(0);
    expect(body.skipped).toBe(1);
    // Não deve ter publicado na fila
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('HMAC inválido → 403', async () => {
    // Apenas channel resolve — HMAC falha antes de chegar no dedup
    selectCallCount = 0;
    selectResponses = [
      [
        {
          id: CHANNEL_ID,
          organizationId: ORG_ID,
          cityId: null,
          provider: 'meta_whatsapp',
          isActive: true,
        },
      ],
      [{ appSecretEnc: Buffer.from('mock-enc') }],
    ];

    const payload = makeWaPayload();
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256':
          'sha256=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(403);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('HMAC ausente → 403', async () => {
    selectCallCount = 0;
    selectResponses = [
      [
        {
          id: CHANNEL_ID,
          organizationId: ORG_ID,
          cityId: null,
          provider: 'meta_whatsapp',
          isActive: true,
        },
      ],
      [{ appSecretEnc: Buffer.from('mock-enc') }],
    ];

    const payload = makeWaPayload();
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        // sem x-hub-signature-256
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(403);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('canal não encontrado → 200 silencioso (não vaza info)', async () => {
    // Nenhum canal registrado para o WABA ID
    selectCallCount = 0;
    selectResponses = [
      [], // [0] resolveChannelByEntryId → vazio
    ];

    const payload = makeWaPayload('unknown-waba-id-9999');
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = makeSignatureHeader(rawBody);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: rawBody,
    });

    // Deve retornar 200 silencioso — não vaza que o canal não existe
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; published: number; skipped: number };
    expect(body.published).toBe(0);
    expect(body.skipped).toBe(0);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('payload fora do schema Meta → 200 silencioso', async () => {
    // Schema parse falha antes de qualquer SELECT
    selectCallCount = 0;
    selectResponses = [];

    const invalidPayload = { not_meta: true, random: 'data' };
    const rawBody = Buffer.from(JSON.stringify(invalidPayload), 'utf8');
    const signature = makeSignatureHeader(rawBody);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; published: number; skipped: number };
    expect(body.published).toBe(0);
    expect(body.skipped).toBe(0);
  });

  it('processa evento instagram com provider correto', async () => {
    setupSelectMocksForHappyPath({ provider: 'meta_instagram' });

    const igPayload = {
      object: 'instagram',
      entry: [
        {
          id: 'ig-page-id-001',
          changes: [{ field: 'messages', value: { sender: { id: 'ig-user-123' } } }],
        },
      ],
    };
    const rawBody = Buffer.from(JSON.stringify(igPayload), 'utf8');
    const signature = makeSignatureHeader(rawBody);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/meta',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; published: number; skipped: number };
    expect(body.published).toBe(1);
    // Verificar que envelope contém provider=meta_instagram
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const publishedEnvelope = mockPublish.mock.calls[0]?.[1] as {
      payload?: { provider?: string };
    };
    expect(publishedEnvelope?.payload?.provider).toBe('meta_instagram');
  });
});
