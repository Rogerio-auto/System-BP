// workers/__tests__/livechat-ai.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    CHATWOOT_ACCOUNT_ID: 1,
  },
}));
vi.mock('pg', () => {
  const M = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: M, default: { Pool: M } };
});

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_c: unknown, v: unknown) => ({ __eq: v })),
  and: vi.fn((...a: unknown[]) => ({ __and: a })),
  isNull: vi.fn().mockReturnValue({}),
  sql: Object.assign(
    vi.fn(() => ({})),
    { mapWith: vi.fn() },
  ),
  relations: vi.fn().mockReturnValue({}),
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn().mockReturnValue({ select: vi.fn(), update: vi.fn(), insert: vi.fn() }),
}));

vi.mock('../../db/client.js', () => ({ db: {}, pool: {} }));

vi.mock('../../db/schema/index.js', () => ({
  conversations: {
    id: 'conversations.id',
    organizationId: 'conversations.org_id',
    leadId: 'conversations.lead_id',
    cityId: 'conversations.city_id',
  },
  messages: {
    id: 'messages.id',
    conversationId: 'messages.conv_id',
    content: 'messages.content',
    createdAt: 'messages.created_at',
  },
  aiConversationStates: {
    conversationId: 'acs.conversation_id',
    organizationId: 'acs.org_id',
    phone: 'acs.phone',
  },
}));

vi.mock('../../lib/queue/index.js', () => ({
  connectRabbitMQ: vi.fn(),
  closeRabbitMQ: vi.fn(),
  getRabbitChannel: vi.fn(),
  publish: vi.fn().mockResolvedValue(undefined),
  makeEnvelope: vi.fn().mockImplementation((_t: unknown, _o: unknown, p: unknown) => p),
}));

vi.mock('../../lib/queue/topology.js', () => ({
  QUEUES: { socketRelay: 'hm.q.socket.relay', livechatAi: 'hm.q.livechat.ai' },
}));

vi.mock('../../lib/queue/envelope.js', () => ({ envelopeSchema: { safeParse: vi.fn() } }));

const { logInfo, logWarn, logError, logFatal } = vi.hoisted(() => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logFatal: vi.fn(),
}));
vi.mock('../../lib/logger.js', () => ({
  logger: {
    child: vi.fn().mockReturnValue({
      info: logInfo,
      debug: vi.fn(),
      warn: logWarn,
      error: logError,
      fatal: logFatal,
    }),
  },
}));

vi.mock('../../shared/phone.js', () => ({
  normalizePhone: vi.fn((raw: string) => ({
    isValid: true,
    e164: raw.startsWith('+') ? raw : '+' + raw,
  })),
}));
const mockProcessWhatsAppMessage = vi.fn();
vi.mock('../../integrations/langgraph/client.js', () => ({
  LangGraphClient: vi
    .fn()
    .mockImplementation(() => ({ processWhatsAppMessage: mockProcessWhatsAppMessage })),
}));

const mockSendMessage = vi.fn();
vi.mock('../../modules/conversations/send.service.js', () => ({
  sendMessage: (...args: unknown[]) => mockSendMessage(...args),
}));

const mockGetOrCreate = vi.fn();
vi.mock('../../modules/livechat/ai-conversation-state.js', () => ({
  getOrCreateConversationState: (...args: unknown[]) => mockGetOrCreate(...args),
}));

import { envelopeSchema } from '../../lib/queue/envelope.js';
import { processJob } from '../livechat-ai.js';

const ORG = '00000000-0000-0000-0000-000000000001';
const CH = '00000000-0000-0000-0000-000000000002';
const CV = '00000000-0000-0000-0000-000000000003';
const MG = '00000000-0000-0000-0000-000000000004';
const AC = '00000000-0000-0000-0000-000000000099';

const validJob = {
  organizationId: ORG,
  channelId: CH,
  conversationId: CV,
  messageId: MG,
  contactRemoteId: '5511999990001',
};
const validEnv = {
  id: 'env-001',
  type: 'livechat.ai',
  organizationId: ORG,
  payload: validJob,
  ts: 0,
};
const convRow = { id: CV, organizationId: ORG, leadId: null, cityId: null };
const msgRow = {
  id: MG,
  conversationId: CV,
  content: 'Quero solicitar',
  createdAt: new Date('2026-06-17T12:00:00Z'),
};
const convState = {
  conversationId: AC,
  organizationId: ORG,
  phone: '5511999990001',
  leadId: null,
  currentNode: 'start',
  graphVersion: null,
  lastMessageAt: new Date(),
  state: {},
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const aiText = {
  reply: { type: 'text', content: 'Ola! Como posso ajudar?' },
  handoff: { required: false, reason: null },
  state: { current_stage: 'greeting' },
  graph_version: 'v1.2',
  latency_ms: 123,
  lead_id: null,
};
const aiNone = {
  reply: { type: 'none', content: '' },
  handoff: { required: false, reason: null },
  state: { current_stage: 'wait' },
  graph_version: 'v1.2',
  latency_ms: 88,
  lead_id: null,
};

const toBuf = (p: unknown) => Buffer.from(JSON.stringify(p), 'utf-8');

function makeDb(rows: unknown[][]) {
  let i = 0;
  const lim = vi.fn().mockImplementation(() => Promise.resolve(rows[i++] ?? []));
  const wh = vi.fn().mockReturnValue({ limit: lim });
  const fr = vi.fn().mockReturnValue({ where: wh });
  const wu = vi.fn().mockResolvedValue(undefined);
  const st = vi.fn().mockReturnValue({ where: wu });
  return {
    select: vi.fn().mockReturnValue({ from: fr }),
    update: vi.fn().mockReturnValue({ set: st }),
    insert: vi.fn(),
    transaction: vi.fn(),
  };
}

describe('processJob (F16-S29)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrCreate.mockResolvedValue(convState);
    mockSendMessage.mockResolvedValue({ id: 'r001' });
    mockProcessWhatsAppMessage.mockResolvedValue(aiText);
    vi.mocked(envelopeSchema.safeParse).mockReturnValue({
      success: true,
      data: validEnv,
    } as ReturnType<typeof envelopeSchema.safeParse>);
  });

  it('1: reply text => sendMessage chamado, ack', async () => {
    const db = makeDb([[convRow], [msgRow]]) as never;
    expect(await processJob(toBuf(validEnv), db)).toBe('ack');
    expect(mockGetOrCreate).toHaveBeenCalledWith(db, expect.any(String), ORG);
    expect(mockSendMessage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: null,
        organizationId: ORG,
        role: 'system',
        cityScopeIds: null,
      }),
      CV,
      { type: 'text', content: 'Ola! Como posso ajudar?' },
      'ai_reply_' + MG,
    );
  });

  it('2: type=none => sendMessage nao chamado, ack', async () => {
    mockProcessWhatsAppMessage.mockResolvedValue(aiNone);
    expect(await processJob(toBuf(validEnv), makeDb([[convRow], [msgRow]]) as never)).toBe('ack');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('3: LangGraph falha => handoff + ack', async () => {
    mockProcessWhatsAppMessage.mockRejectedValue(new Error('LangGraph timeout'));
    const db = makeDb([[convRow], [msgRow]]) as never;
    expect(await processJob(toBuf(validEnv), db)).toBe('ack');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CV }),
      expect.stringContaining('LangGraph'),
    );
  });

  it('4: idempotencia: messageId ja processado => ack sem LangGraph', async () => {
    mockGetOrCreate.mockResolvedValue({
      ...convState,
      state: { last_processed_livechat_message_id: MG },
    });
    expect(await processJob(toBuf(validEnv), makeDb([[convRow], [msgRow]]) as never)).toBe('ack');
    expect(mockProcessWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('5: envelope invalido => nack', async () => {
    vi.mocked(envelopeSchema.safeParse).mockReturnValue({
      success: false,
      error: { issues: [] },
    } as unknown as ReturnType<typeof envelopeSchema.safeParse>);
    expect(await processJob(toBuf({ x: 1 }), makeDb([]) as never)).toBe('nack');
  });

  it('6: job invalido (campo ausente) => nack', async () => {
    vi.mocked(envelopeSchema.safeParse).mockReturnValue({
      success: true,
      data: { ...validEnv, payload: { organizationId: ORG } },
    } as ReturnType<typeof envelopeSchema.safeParse>);
    expect(await processJob(toBuf({}), makeDb([]) as never)).toBe('nack');
  });

  it('7: conversa nao encontrada => ack skip', async () => {
    expect(await processJob(toBuf(validEnv), makeDb([[], [msgRow]]) as never)).toBe('ack');
    expect(mockGetOrCreate).not.toHaveBeenCalled();
  });

  it('8: sendMessage falha => throw (DLX)', async () => {
    mockSendMessage.mockRejectedValue(new Error('WindowClosedError'));
    await expect(
      processJob(toBuf(validEnv), makeDb([[convRow], [msgRow]]) as never),
    ).rejects.toThrow('WindowClosedError');
  });

  it('9: LGPD: reply.content nao aparece em logs info', async () => {
    await processJob(toBuf(validEnv), makeDb([[convRow], [msgRow]]) as never);
    for (const call of logInfo.mock.calls) {
      const s = JSON.stringify(call);
      expect(s).not.toContain('Ola! Como posso ajudar?');
      expect(s).not.toContain('Quero solicitar');
    }
  });

  it('10: handoff required => warn emitido', async () => {
    mockProcessWhatsAppMessage.mockResolvedValue({
      ...aiText,
      handoff: { required: true, reason: 'human_requested' },
    });
    const db = makeDb([[convRow], [msgRow]]) as never;
    expect(await processJob(toBuf(validEnv), db)).toBe('ack');
    expect(logWarn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'human_requested', conversationId: CV }),
      expect.stringContaining('handoff'),
    );
  });
});
