// conversations/__tests__/lead-link.test.ts -- Testes F16-S23.
// Cobertura: vincular lead, criar+vincular, idempotencia, 409, 422, city scope, audit sem PII.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORG_ID = 'aaaabbbb-0001-0000-0000-000000000001';
const CONV_ID = 'aaaabbbb-0002-0000-0000-000000000001';
const CHANNEL_ID = 'aaaabbbb-0003-0000-0000-000000000001';
const LEAD_ID = 'aaaabbbb-0004-0000-0000-000000000001';
const LEAD_ID_2 = 'aaaabbbb-0004-0000-0000-000000000002';
const USER_ID = 'aaaabbbb-0005-0000-0000-000000000001';
const CITY_ID = 'aaaabbbb-0006-0000-0000-000000000001';

function makeConversation(
  overrides: Partial<{
    leadId: string | null;
    contactRemoteId: string;
    contactName: string | null;
    contactPhoneEnc: Buffer | null;
  }> = {},
) {
  return {
    id: CONV_ID,
    organizationId: ORG_ID,
    channelId: CHANNEL_ID,
    contactRemoteId: overrides.contactRemoteId ?? '5521999990001',
    contactName: overrides.contactName !== undefined ? overrides.contactName : 'Maria Silva',
    contactPhoneEnc: overrides.contactPhoneEnc !== undefined ? overrides.contactPhoneEnc : null,
    leadId: overrides.leadId !== undefined ? overrides.leadId : null,
    customerId: null,
    status: 'open',
    kind: 'dm',
    assignedUserId: null,
    lastInboundAt: new Date(),
    lastMessageAt: new Date(),
    unreadCount: 0,
    metadata: null,
    cityId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeChannel(overrides: Partial<{ cityId: string | null }> = {}) {
  return {
    id: CHANNEL_ID,
    organizationId: ORG_ID,
    provider: 'meta_whatsapp',
    name: 'Test Channel',
    isActive: true,
    isDefault: false,
    cityId: overrides.cityId !== undefined ? overrides.cityId : CITY_ID,
    phoneNumberId: 'pn_001',
    phoneNumberEnc: null,
    wabaId: 'waba_001',
    metaAppId: null,
    igUserId: null,
    igUsername: null,
    igAccountType: null,
    fbPageId: null,
    displayHandle: '+5521000000000',
    wahaSessionId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeActor(overrides: Partial<{ cityScopeIds: string[] | null }> = {}) {
  return {
    userId: USER_ID,
    organizationId: ORG_ID,
    role: 'attendant',
    cityScopeIds: overrides.cityScopeIds !== undefined ? overrides.cityScopeIds : null,
    ip: '127.0.0.1',
    userAgent: 'vitest/1.0',
  };
}

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
const mockGetConversation = vi.fn();
const mockFindChannel = vi.fn();
vi.mock('../../livechat/service.js', () => ({
  getConversation: (...args: unknown[]) => mockGetConversation(...args),
  findChannel: (...args: unknown[]) => mockFindChannel(...args),
  getComposerState: vi.fn(),
  getMessages: vi.fn(),
  listConversations: vi.fn(),
}));
const mockLinkConversationLead = vi.fn();
vi.mock('../../livechat/repo.js', () => ({
  linkConversationLead: (...args: unknown[]) => mockLinkConversationLead(...args),
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
const mockGetOrCreateLead = vi.fn();
vi.mock('../../leads/service.js', () => ({
  getOrCreateLead: (...args: unknown[]) => mockGetOrCreateLead(...args),
  createLead: vi.fn(),
}));
const mockAuditLog = vi.fn();
vi.mock('../../../lib/audit.js', () => ({
  auditLog: (...args: unknown[]) => mockAuditLog(...args),
}));
const mockPublish = vi.fn();
vi.mock('../../../lib/queue/index.js', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
  makeEnvelope: vi.fn().mockImplementation((_q: unknown, _o: unknown, p: unknown) => p),
}));
vi.mock('../../../lib/queue/topology.js', () => ({
  QUEUES: { socketRelay: 'socket-relay', outbound: 'outbound' },
}));
vi.mock('../../../lib/crypto/pii.js', () => ({
  decryptPii: vi.fn().mockResolvedValue('+5521999990001'),
  encryptPii: vi.fn(),
  hashDocument: vi.fn(),
}));

describe('linkOrCreateConversationLead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditLog.mockResolvedValue('audit-id-001');
    mockPublish.mockResolvedValue(undefined);
    mockLinkConversationLead.mockResolvedValue(undefined);
  });

  it('vincula lead existente', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    const result = await fn({} as never, makeActor(), CONV_ID, { leadId: LEAD_ID });
    expect(result).toEqual({ conversationId: CONV_ID, leadId: LEAD_ID, created: false });
    expect(mockLinkConversationLead).toHaveBeenCalledWith({}, CONV_ID, ORG_ID, LEAD_ID);
    expect(mockAuditLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ action: 'conversation.lead_linked' }),
    );
    expect(mockPublish).toHaveBeenCalledWith(
      'socket-relay',
      expect.objectContaining({
        event: 'conversation:updated',
        data: expect.objectContaining({ leadId: LEAD_ID }),
      }),
    );
  });

  it('retorna 200 no-op quando ja vinculado ao MESMO lead', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: LEAD_ID }));
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    const result = await fn({} as never, makeActor(), CONV_ID, { leadId: LEAD_ID });
    expect(result).toEqual({ conversationId: CONV_ID, leadId: LEAD_ID, created: false });
    expect(mockLinkConversationLead).not.toHaveBeenCalled();
    expect(mockAuditLog).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('lanca 409 quando ja vinculado a lead DIFERENTE', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: LEAD_ID }));
    const { linkOrCreateConversationLead: fn, ConversationAlreadyLinkedError } = await import(
      '../service.js'
    );
    await expect(
      fn({} as never, makeActor(), CONV_ID, { leadId: LEAD_ID_2 }),
    ).rejects.toBeInstanceOf(ConversationAlreadyLinkedError);
    expect(mockLinkConversationLead).not.toHaveBeenCalled();
  });

  it('cria e vincula novo lead quando leadId ausente', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    mockFindChannel.mockResolvedValue(makeChannel({ cityId: CITY_ID }));
    mockGetOrCreateLead.mockResolvedValue({ lead_id: LEAD_ID, created: true });
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    const result = await fn({} as never, makeActor(), CONV_ID, {});
    expect(result).toEqual({ conversationId: CONV_ID, leadId: LEAD_ID, created: true });
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      {},
      ORG_ID,
      expect.objectContaining({ phone: '+5521999990001', cityId: CITY_ID }),
      null,
    );
    expect(mockLinkConversationLead).toHaveBeenCalledWith({}, CONV_ID, ORG_ID, LEAD_ID);
    expect(mockAuditLog).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalled();
  });

  it('retorna 200 no-op quando ja tem lead e criacao solicitada', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: LEAD_ID }));
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    const result = await fn({} as never, makeActor(), CONV_ID, {});
    expect(result).toEqual({ conversationId: CONV_ID, leadId: LEAD_ID, created: false });
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
    expect(mockLinkConversationLead).not.toHaveBeenCalled();
  });
  it('lanca MissingChannelCityError 422 quando canal sem cityId', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    mockFindChannel.mockResolvedValue(makeChannel({ cityId: null }));
    const { linkOrCreateConversationLead: fn, MissingChannelCityError } = await import(
      '../service.js'
    );
    await expect(fn({} as never, makeActor(), CONV_ID, {})).rejects.toBeInstanceOf(
      MissingChannelCityError,
    );
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  it('lanca 422 quando contactRemoteId nao e numero de telefone', async () => {
    mockGetConversation.mockResolvedValue(
      makeConversation({ leadId: null, contactRemoteId: 'igsid_abc123xyz', contactPhoneEnc: null }),
    );
    mockFindChannel.mockResolvedValue(makeChannel({ cityId: CITY_ID }));
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    await expect(fn({} as never, makeActor(), CONV_ID, {})).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });

  it('passa cityScopeIds ao getConversation', async () => {
    const scopedActor = makeActor({ cityScopeIds: [CITY_ID] });
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    await fn({} as never, scopedActor, CONV_ID, { leadId: LEAD_ID });
    expect(mockGetConversation).toHaveBeenCalledWith({}, CONV_ID, ORG_ID, {
      cityScopeIds: [CITY_ID],
    });
  });

  it('emite audit log apenas com IDs opacos sem PII', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    await fn({} as never, makeActor(), CONV_ID, { leadId: LEAD_ID });
    const auditCall = mockAuditLog.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(auditCall).toMatchObject({
      action: 'conversation.lead_linked',
      resource: { type: 'conversation', id: CONV_ID },
    });
    expect(auditCall.after).not.toHaveProperty('contactName');
    expect(auditCall.after).not.toHaveProperty('contactPhone');
    expect(auditCall.after).not.toHaveProperty('phone');
  });

  // F16-S26: body.cityId permite criar lead em canal sem cidade configurada
  it('F16-S26: cria lead usando body.cityId quando canal sem cityId', async () => {
    const BODY_CITY_ID = 'cccccccc-0007-0000-0000-000000000001';
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    // Canal sem cityId
    mockFindChannel.mockResolvedValue(makeChannel({ cityId: null }));
    mockGetOrCreateLead.mockResolvedValue({ lead_id: LEAD_ID, created: true });
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    // body.cityId fornecido pelo front (seletor de cidade F16-S27)
    const result = await fn({} as never, makeActor(), CONV_ID, { cityId: BODY_CITY_ID });
    expect(result).toEqual({ conversationId: CONV_ID, leadId: LEAD_ID, created: true });
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      {},
      ORG_ID,
      expect.objectContaining({ cityId: BODY_CITY_ID }),
      null,
    );
  });

  it('F16-S26: body.cityId sobrepoe channel.cityId na criacao do lead', async () => {
    const BODY_CITY_ID = 'cccccccc-0007-0000-0000-000000000001';
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    // Canal TEM cityId — body.cityId deve ser preferido
    mockFindChannel.mockResolvedValue(makeChannel({ cityId: CITY_ID }));
    mockGetOrCreateLead.mockResolvedValue({ lead_id: LEAD_ID, created: true });
    const { linkOrCreateConversationLead: fn } = await import('../service.js');
    const result = await fn({} as never, makeActor(), CONV_ID, { cityId: BODY_CITY_ID });
    expect(result).toEqual({ conversationId: CONV_ID, leadId: LEAD_ID, created: true });
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      {},
      ORG_ID,
      expect.objectContaining({ cityId: BODY_CITY_ID }),
      null,
    );
  });

  it('F16-S26: 422 apenas quando canal E body sem cityId', async () => {
    mockGetConversation.mockResolvedValue(makeConversation({ leadId: null }));
    // Nem canal nem body tem cityId
    mockFindChannel.mockResolvedValue(makeChannel({ cityId: null }));
    const { linkOrCreateConversationLead: fn, MissingChannelCityError } = await import(
      '../service.js'
    );
    await expect(fn({} as never, makeActor(), CONV_ID, {})).rejects.toBeInstanceOf(
      MissingChannelCityError,
    );
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
  });
});
