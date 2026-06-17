// conversations/__tests__/read-event.test.ts — Testes F16-S26.
//
// Cobre (DoD F16-S26):
//   1. markConversationRead emite conversation:updated no room workspace:{orgId}
//   2. Payload sem PII (apenas conversationId e unreadCount: 0)
//   3. Emit não bloqueia GET /messages (falha de publish é silenciosa)

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = 'aaaabbbb-0001-0000-0000-000000000001';
const CONV_ID = 'aaaabbbb-0002-0000-0000-000000000001';
const USER_ID = 'aaaabbbb-0005-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Mocks — devem vir antes de qualquer import do módulo testado
// ---------------------------------------------------------------------------

vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: { Pool: MockPool }, Pool: MockPool };
});

vi.mock('../../../db/client.js', () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn(), transaction: vi.fn() },
}));

const mockPublish = vi.fn();
const mockMakeEnvelope = vi.fn().mockImplementation((_q: unknown, _o: unknown, p: unknown) => p);
vi.mock('../../../lib/queue/index.js', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
  makeEnvelope: (...args: unknown[]) => mockMakeEnvelope(...args),
}));
vi.mock('../../../lib/queue/topology.js', () => ({
  QUEUES: {
    socketRelay: 'hm.q.socket.relay',
    outbound: 'hm.q.outbound.request',
    livechatAi: 'hm.q.livechat.ai',
  },
}));

const mockGetConversation = vi.fn().mockResolvedValue({});
const mockRepoGetMessages = vi.fn().mockResolvedValue([]);
vi.mock('../../livechat/service.js', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  findChannel: vi.fn(),
  getComposerState: vi.fn(),
  getMessages: (...args: unknown[]) => mockRepoGetMessages(...args),
  listConversations: vi.fn(),
}));

vi.mock('../../livechat/repo.js', () => ({
  linkConversationLead: vi.fn(),
  findChannelById: vi.fn(),
  findConversationById: vi.fn(),
  listConversations: vi.fn(),
  insertInboundMessage: vi.fn(),
  insertOutboundMessage: vi.fn(),
  updateConversationOnInbound: vi.fn(),
  updateConversationOnOutbound: vi.fn(),
  updateMessageViewStatus: vi.fn(),
  updateMessageExternalId: vi.fn(),
  listMessages: vi.fn(),
  findOrCreateConversation: vi.fn(),
  insertInteractionBridge: vi.fn(),
}));
vi.mock('../../leads/service.js', () => ({
  getOrCreateLead: vi.fn(),
  createLead: vi.fn(),
}));
vi.mock('../../../lib/audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue('audit-id-001'),
}));
vi.mock('../../../lib/crypto/pii.js', () => ({
  decryptPii: vi.fn().mockResolvedValue('+5521999990001'),
  encryptPii: vi.fn(),
  hashDocument: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fake DB — suporta db.update(...).set(...).where(...) para markConversationRead
// ---------------------------------------------------------------------------
function makeChainableMock() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('markConversationRead — emissão conversation:updated (F16-S26)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPublish.mockResolvedValue(undefined);
    mockGetConversation.mockResolvedValue({});
    mockRepoGetMessages.mockResolvedValue([]);
  });

  it('emite conversation:updated no room workspace:{orgId} ao marcar lida', async () => {
    const { getMessagesService } = await import('../service.js');
    const chain = makeChainableMock();

    await getMessagesService(
      chain as never,
      { organizationId: ORG_ID, cityScopeIds: null, userId: USER_ID, permissions: [] },
      CONV_ID,
      { limit: 50 },
    );

    // markConversationRead é fire-and-forget — aguardar 1 tick
    await new Promise((r) => setImmediate(r));

    // Deve ter chamado publish
    expect(mockPublish).toHaveBeenCalled();

    // Encontra a call do socket relay
    const relayCall = mockPublish.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('socket.relay'),
    );
    expect(relayCall).toBeDefined();

    // Verifica o envelope (mockMakeEnvelope passa o 3º arg como está)
    const envelope = relayCall![1] as {
      room: string;
      event: string;
      data: Record<string, unknown>;
    };
    expect(envelope.room).toBe(`workspace:${ORG_ID}`);
    expect(envelope.event).toBe('conversation:updated');
    expect(envelope.data).toMatchObject({ conversationId: CONV_ID, unreadCount: 0 });
  });

  it('payload não contém PII — apenas IDs opacos (LGPD §8.1)', async () => {
    const { getMessagesService } = await import('../service.js');
    const chain = makeChainableMock();

    await getMessagesService(
      chain as never,
      { organizationId: ORG_ID, cityScopeIds: null, userId: USER_ID, permissions: [] },
      CONV_ID,
      { limit: 50 },
    );

    await new Promise((r) => setImmediate(r));

    // Nenhum payload deve conter dados PII
    for (const call of mockPublish.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toMatch(/\+55\d{10,}/); // telefone E.164
      expect(serialized).not.toMatch(/Maria|Silva/i); // nome
      expect(serialized).not.toMatch(/content|message_text/); // conteúdo
    }
  });

  it('falha de publish não propaga ao caller (fire-and-forget)', async () => {
    const { getMessagesService } = await import('../service.js');
    const chain = makeChainableMock();
    mockPublish.mockRejectedValue(new Error('RabbitMQ down'));

    // getMessagesService NÃO deve lançar mesmo com publish falhando
    await expect(
      getMessagesService(
        chain as never,
        { organizationId: ORG_ID, cityScopeIds: null, userId: USER_ID, permissions: [] },
        CONV_ID,
        { limit: 50 },
      ),
    ).resolves.toBeDefined();

    // Aguardar o fire-and-forget liquidar
    await new Promise((r) => setImmediate(r));
  });
});
