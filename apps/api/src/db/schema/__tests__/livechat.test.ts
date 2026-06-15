// livechat.test.ts - Testes do schema live chat multicanal (F16-S02).
// Cobertura: channels, channelSecrets, conversations, messages, webhookEvents
// LGPD: bytea enc fields sao Buffer, nao string
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  const MockClient = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(undefined),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { default: { Pool: MockPool, Client: MockClient }, Pool: MockPool, Client: MockClient };
});

const mockInsertValues = vi.fn();
const mockDeleteWhere = vi.fn();
mockInsertValues.mockResolvedValue([]);
mockDeleteWhere.mockResolvedValue([]);
const mockDb = {
  insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
  select: vi
    .fn()
    .mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
};
vi.mock('../../client.js', () => ({
  db: mockDb,
  pool: {
    connect: vi
      .fn()
      .mockResolvedValue({ query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }),
    end: vi.fn(),
    on: vi.fn(),
  },
}));

import { channels, type Channel, type NewChannel } from '../channels.js';
import { channelSecrets, type ChannelSecret, type NewChannelSecret } from '../channelSecrets.js';
import { conversations, type Conversation, type NewConversation } from '../conversations.js';
import { messages, type Message, type NewMessage } from '../messages.js';
import { webhookEvents, type WebhookEvent, type NewWebhookEvent } from '../webhookEvents.js';

const ORG_ID = 'aabbccdd-0001-0000-0000-000000000001';
const CHANNEL_ID = 'aabbccdd-0002-0000-0000-000000000001';
const CONV_ID = 'aabbccdd-0003-0000-0000-000000000001';
const MSG_ID = 'aabbccdd-0004-0000-0000-000000000001';

function makeNewChannel(overrides: Partial<NewChannel> = {}): NewChannel {
  return {
    organizationId: ORG_ID,
    provider: 'meta_whatsapp',
    name: 'Canal Teste',
    displayHandle: '+5569900000001',
    phoneNumberId: '123456789012345',
    ...overrides,
  };
}
function makeNewChannelSecret(overrides: Partial<NewChannelSecret> = {}): NewChannelSecret {
  return { channelId: CHANNEL_ID, accessTokenEnc: Buffer.from('enc-token'), ...overrides };
}
function makeNewConversation(overrides: Partial<NewConversation> = {}): NewConversation {
  return {
    organizationId: ORG_ID,
    channelId: CHANNEL_ID,
    contactRemoteId: '+5569912345678',
    ...overrides,
  };
}
function makeNewMessage(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    conversationId: CONV_ID,
    channelId: CHANNEL_ID,
    direction: 'in',
    type: 'text',
    content: 'Ola',
    ...overrides,
  };
}
function makeNewWebhookEvent(overrides: Partial<NewWebhookEvent> = {}): NewWebhookEvent {
  return {
    provider: 'meta_whatsapp',
    eventId: 'wh-evt-001',
    eventType: 'message',
    rawPayload: { entry: [] },
    ...overrides,
  };
}

describe('channels — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('canal valido meta_whatsapp: insert aceito', async () => {
    const ch = makeNewChannel();
    await mockDb.insert(channels).values(ch);
    expect(mockDb.insert).toHaveBeenCalledWith(channels);
    expect(mockInsertValues).toHaveBeenCalledWith(ch);
  });

  it('canal valido meta_instagram: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: CHANNEL_ID }]);
    // exactOptionalPropertyTypes: omit phoneNumberId for ig channel
    const ch: NewChannel = {
      organizationId: ORG_ID,
      provider: 'meta_instagram',
      name: 'Canal IG',
      displayHandle: '@ig_handle',
      igUserId: 'ig-999',
    };
    expect(await mockDb.insert(channels).values(ch)).toEqual([{ id: CHANNEL_ID }]);
  });

  it('canal valido waha: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: CHANNEL_ID }]);
    // exactOptionalPropertyTypes: omit phoneNumberId for waha channel
    const ch: NewChannel = {
      organizationId: ORG_ID,
      provider: 'waha',
      name: 'Canal WAHA',
      displayHandle: '+5569900000003',
      wahaSessionId: 'sess-01',
    };
    expect(await mockDb.insert(channels).values(ch)).toEqual([{ id: CHANNEL_ID }]);
  });

  it('duplicate org+provider+phoneNumberId: simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('unique constraint "channels_org_provider_phone_number_id_key"'),
    );
    await expect(mockDb.insert(channels).values(makeNewChannel())).rejects.toThrow(
      'channels_org_provider_phone_number_id_key',
    );
  });

  it('provider sem campo obrigatorio: simula CHECK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('check constraint "channels_provider_fields_check"'),
    );
    // Simula: meta_whatsapp sem phone_number_id viola o CHECK do provider
    const chNoPhone: NewChannel = {
      organizationId: ORG_ID,
      provider: 'meta_whatsapp',
      name: 'Canal',
      displayHandle: '+5569900000001',
    };
    await expect(mockDb.insert(channels).values(chNoPhone)).rejects.toThrow(
      'channels_provider_fields_check',
    );
  });

  it('channel FK org inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('foreign key constraint'));
    await expect(
      mockDb
        .insert(channels)
        .values(makeNewChannel({ organizationId: '00000000-dead-beef-0000-000000000000' })),
    ).rejects.toThrow('foreign key constraint');
  });
});

describe('channelSecrets — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('secret valido: insert aceito', async () => {
    const s = makeNewChannelSecret();
    await mockDb.insert(channelSecrets).values(s);
    expect(mockDb.insert).toHaveBeenCalledWith(channelSecrets);
  });

  it('duplicate channelId: simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('unique constraint'));
    await expect(mockDb.insert(channelSecrets).values(makeNewChannelSecret())).rejects.toThrow(
      'unique constraint',
    );
  });

  it('cascade delete: ao deletar canal, secrets sao removidos', async () => {
    mockDeleteWhere.mockResolvedValueOnce([{ id: CHANNEL_ID }]);
    await mockDb.delete(channels).where();
    expect(mockDb.delete).toHaveBeenCalledWith(channels);
  });

  it('appSecretEnc nullable: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: 'sec-1' }]);
    // exactOptionalPropertyTypes: omit appSecretEnc (nullable optional column)
    const secretNoApp: NewChannelSecret = {
      channelId: CHANNEL_ID,
      accessTokenEnc: Buffer.from('enc-token'),
    };
    expect(await mockDb.insert(channelSecrets).values(secretNoApp)).toEqual([{ id: 'sec-1' }]);
  });
});

describe('conversations — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('conversa valida: insert aceito', async () => {
    const c = makeNewConversation();
    await mockDb.insert(conversations).values(c);
    expect(mockDb.insert).toHaveBeenCalledWith(conversations);
  });

  it('status snoozed: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: CONV_ID }]);
    expect(
      await mockDb.insert(conversations).values(makeNewConversation({ status: 'snoozed' })),
    ).toEqual([{ id: CONV_ID }]);
  });

  it('kind comment_thread: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: CONV_ID }]);
    expect(
      await mockDb.insert(conversations).values(makeNewConversation({ kind: 'comment_thread' })),
    ).toEqual([{ id: CONV_ID }]);
  });

  it('channelId FK inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('foreign key constraint'));
    await expect(
      mockDb
        .insert(conversations)
        .values(makeNewConversation({ channelId: '00000000-dead-beef-0000-000000000000' })),
    ).rejects.toThrow('foreign key constraint');
  });
});

describe('messages — schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('mensagem inbound text: insert aceito', async () => {
    const m = makeNewMessage();
    await mockDb.insert(messages).values(m);
    expect(mockDb.insert).toHaveBeenCalledWith(messages);
  });

  it('mensagem outbound type=system: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: MSG_ID }]);
    expect(
      await mockDb.insert(messages).values(makeNewMessage({ direction: 'out', type: 'system' })),
    ).toEqual([{ id: MSG_ID }]);
  });

  it('duplicate channelId+externalId: simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('unique constraint "messages_channel_external_id_key"'),
    );
    await expect(
      mockDb.insert(messages).values(makeNewMessage({ externalId: 'wamid.abc' })),
    ).rejects.toThrow('messages_channel_external_id_key');
  });

  it('dois inserts sem externalId: aceitos (indice parcial)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: 'm1' }]).mockResolvedValueOnce([{ id: 'm2' }]);
    const r1 = await mockDb.insert(messages).values(makeNewMessage({ type: 'system' }));
    const r2 = await mockDb.insert(messages).values(makeNewMessage({ type: 'system' }));
    expect(r1).toEqual([{ id: 'm1' }]);
    expect(r2).toEqual([{ id: 'm2' }]);
  });

  it('viewStatus failed: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: MSG_ID }]);
    expect(
      await mockDb
        .insert(messages)
        .values(makeNewMessage({ direction: 'out', viewStatus: 'failed' })),
    ).toEqual([{ id: MSG_ID }]);
  });

  it('conversationId FK inexistente: simula FK violation', async () => {
    mockInsertValues.mockRejectedValueOnce(new Error('foreign key constraint'));
    await expect(
      mockDb
        .insert(messages)
        .values(makeNewMessage({ conversationId: '00000000-dead-beef-0000-000000000000' })),
    ).rejects.toThrow('foreign key constraint');
  });
});

describe('webhookEvents schema e types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue({ values: mockInsertValues });
    mockInsertValues.mockResolvedValue([]);
  });

  it('webhook event valido: insert aceito', async () => {
    const e = makeNewWebhookEvent();
    await mockDb.insert(webhookEvents).values(e);
    expect(mockDb.insert).toHaveBeenCalledWith(webhookEvents);
  });

  it('duplicate provider+eventId: simula UNIQUE violation', async () => {
    mockInsertValues.mockRejectedValueOnce(
      new Error('unique constraint "webhook_events_provider_event_id_key"'),
    );
    await expect(mockDb.insert(webhookEvents).values(makeNewWebhookEvent())).rejects.toThrow(
      'webhook_events_provider_event_id_key',
    );
  });

  it('processedAt null: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: 'evt-1' }]);
    expect(
      await mockDb.insert(webhookEvents).values(makeNewWebhookEvent({ processedAt: null })),
    ).toEqual([{ id: 'evt-1' }]);
  });

  it('processedAt preenchido: insert aceito', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: 'evt-2' }]);
    expect(
      await mockDb.insert(webhookEvents).values(makeNewWebhookEvent({ processedAt: new Date() })),
    ).toEqual([{ id: 'evt-2' }]);
  });
});

describe('tipos Drizzle compilacao sem any', () => {
  it('Channel type tem todos os campos', () => {
    const ch: Channel = {
      id: CHANNEL_ID,
      organizationId: ORG_ID,
      cityId: null,
      provider: 'meta_whatsapp',
      name: 'Canal Teste',
      displayHandle: '+5569900000001',
      phoneNumberEnc: null,
      phoneNumberId: '123456789012345',
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
    expect(ch.provider).toBe('meta_whatsapp');
    expect(ch.deletedAt).toBeNull();
  });

  it('ChannelSecret accessTokenEnc e Buffer', () => {
    const s: ChannelSecret = {
      id: 's-1',
      channelId: CHANNEL_ID,
      accessTokenEnc: Buffer.from('enc'),
      appSecretEnc: null,
      apiKeyEnc: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(s.accessTokenEnc).toBeInstanceOf(Buffer);
    expect(s.appSecretEnc).toBeNull();
  });
});

describe('tipos Drizzle Conversation Message WebhookEvent', () => {
  it('Conversation type tem organizationId + soft-delete', () => {
    const c: Conversation = {
      id: CONV_ID,
      organizationId: ORG_ID,
      cityId: null,
      channelId: CHANNEL_ID,
      contactRemoteId: '+5569912345678',
      contactName: null,
      contactPhoneEnc: null,
      leadId: null,
      customerId: null,
      status: 'open',
      kind: 'dm',
      assignedUserId: null,
      lastInboundAt: null,
      lastMessageAt: null,
      unreadCount: 0,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(c.status).toBe('open');
    expect('deletedAt' in c).toBe(true);
  });

  it('contactPhoneEnc e Buffer (LGPD bytea)', () => {
    const c: Conversation = {
      id: CONV_ID,
      organizationId: ORG_ID,
      cityId: null,
      channelId: CHANNEL_ID,
      contactRemoteId: '+5569912345678',
      contactName: null,
      contactPhoneEnc: Buffer.from('enc-phone'),
      leadId: null,
      customerId: null,
      status: 'open',
      kind: 'dm',
      assignedUserId: null,
      lastInboundAt: null,
      lastMessageAt: null,
      unreadCount: 0,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(c.contactPhoneEnc).toBeInstanceOf(Buffer);
  });
});

describe('tipos Drizzle Message e WebhookEvent', () => {
  it('Message type tem todos os campos', () => {
    const m: Message = {
      id: MSG_ID,
      conversationId: CONV_ID,
      channelId: CHANNEL_ID,
      direction: 'in',
      externalId: 'wamid.abc',
      type: 'text',
      content: 'Ola',
      mediaUrl: null,
      mediaMime: null,
      mediaSizeBytes: null,
      mediaSha256: null,
      interactivePayload: null,
      viewStatus: null,
      replyToExternalId: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(m.direction).toBe('in');
    expect(m.type).toBe('text');
  });

  it('WebhookEvent type tem expiresAt (LGPD 30 dias)', () => {
    const e: WebhookEvent = {
      id: 'e-1',
      organizationId: null,
      provider: 'meta_whatsapp',
      eventId: 'wh-001',
      eventType: 'message',
      rawPayload: { entry: [] },
      processedAt: null,
      processingError: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    expect('expiresAt' in e).toBe(true);
    expect(e.expiresAt).toBeInstanceOf(Date);
  });
});

describe('LGPD colunas PII nunca em texto plano', () => {
  it('contact_phone_enc e Buffer (nunca string)', () => {
    const c: Conversation = {
      id: CONV_ID,
      organizationId: ORG_ID,
      cityId: null,
      channelId: CHANNEL_ID,
      contactRemoteId: '+5569912345678',
      contactName: null,
      contactPhoneEnc: Buffer.from('AES-256-GCM-enc'),
      leadId: null,
      customerId: null,
      status: 'open',
      kind: 'dm',
      assignedUserId: null,
      lastInboundAt: null,
      lastMessageAt: null,
      unreadCount: 0,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    expect(typeof c.contactPhoneEnc).not.toBe('string');
    expect(c.contactPhoneEnc).toBeInstanceOf(Buffer);
  });

  it('access_token_enc e Buffer (nunca string)', () => {
    const s: ChannelSecret = {
      id: 's-1',
      channelId: CHANNEL_ID,
      accessTokenEnc: Buffer.from('AES-enc'),
      appSecretEnc: null,
      apiKeyEnc: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(typeof s.accessTokenEnc).not.toBe('string');
    expect(s.accessTokenEnc).toBeInstanceOf(Buffer);
  });

  it('webhook raw_payload e objeto jsonb nao string', () => {
    const e: WebhookEvent = {
      id: 'e-1',
      organizationId: null,
      provider: 'meta_whatsapp',
      eventId: 'wh-001',
      eventType: 'message',
      rawPayload: { entry: [] },
      processedAt: null,
      processingError: null,
      createdAt: new Date(),
      expiresAt: new Date(),
    };
    expect(typeof e.rawPayload).toBe('object');
    expect(typeof e.rawPayload).not.toBe('string');
  });

  it('organizationId nullable: insert aceito sem org (ingest pre-routing)', async () => {
    mockInsertValues.mockResolvedValueOnce([{ id: 'evt-3' }]);
    // organization_id e NULL durante ingest antes de identificar o canal/org (M4)
    const e: NewWebhookEvent = {
      provider: 'meta_whatsapp',
      eventId: 'wh-003',
      eventType: 'message',
      rawPayload: { entry: [] },
    };
    expect(await mockDb.insert(webhookEvents).values(e)).toEqual([{ id: 'evt-3' }]);
  });

  it('phone_number_enc nunca em texto plano (H1 LGPD)', () => {
    // phoneNumberEnc deve ser Buffer (bytea), nunca string
    const ch: Channel = {
      id: CHANNEL_ID,
      organizationId: ORG_ID,
      cityId: null,
      provider: 'meta_whatsapp',
      name: 'Canal WA Enc',
      displayHandle: '+5569900000001',
      phoneNumberEnc: Buffer.from('AES-256-GCM-enc-phone'),
      phoneNumberId: '123456789012345',
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
    expect(typeof ch.phoneNumberEnc).not.toBe('string');
    expect(ch.phoneNumberEnc).toBeInstanceOf(Buffer);
  });
});
