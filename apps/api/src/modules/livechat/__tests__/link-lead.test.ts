// =============================================================================
// livechat/__tests__/link-lead.test.ts — Testes para linkOrCreateLeadForConversation (F16-S22).
//
// Cenarios cobertos:
//   1. match->link: contato com telefone ja existe no CRM -> vincula conversa
//   2. no-match+flag-on+cityId -> cria lead-shell + vincula
//   3. no-match+flag-off -> lead_id permanece NULL (flag desligada)
//   4. no-match+flag-on+sem-cityId -> NULL (leads.city_id NOT NULL)
//   5. idempotencia: dois inbounds do mesmo contato -> match, sem criar novo lead
//   6. contactRemoteId nao-numerico (IGSID) -> null sem lookup
//
// Strategy: mock de todas as dependencias externas (leads, featureFlags, repo).
// =============================================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('pg', () => {
  const MockPool = vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('../../../db/client.js', () => ({
  db: {},
  pool: {},
}));

const {
  mockFindLeadByPhoneInOrg,
  mockGetOrCreateLead,
  mockLinkConversationLead,
  mockIsFlagEnabled,
} = vi.hoisted(() => ({
  mockFindLeadByPhoneInOrg: vi.fn(),
  mockGetOrCreateLead: vi.fn(),
  mockLinkConversationLead: vi.fn().mockResolvedValue(undefined),
  mockIsFlagEnabled: vi.fn(),
}));

vi.mock('../../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: (...args: unknown[]) => mockIsFlagEnabled(...args),
}));

vi.mock('../../leads/repository.js', () => ({
  findLeadByPhoneInOrg: (...args: unknown[]) => mockFindLeadByPhoneInOrg(...args),
}));

vi.mock('../../leads/service.js', () => ({
  getOrCreateLead: (...args: unknown[]) => mockGetOrCreateLead(...args),
}));

vi.mock('../repo.js', () => ({
  findChannelById: vi.fn(),
  findConversationById: vi.fn(),
  findOrCreateConversation: vi.fn(),
  insertInboundMessage: vi.fn(),
  insertInteractionBridge: vi.fn(),
  insertOutboundMessage: vi.fn(),
  linkConversationLead: (...args: unknown[]) => mockLinkConversationLead(...args),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  updateConversationOnInbound: vi.fn(),
  updateConversationOnOutbound: vi.fn(),
  updateMessageViewStatus: vi.fn(),
}));

import type { Database } from '../../../db/client.js';
import { linkOrCreateLeadForConversation } from '../service.js';

const ORG_ID = 'bbbbccdd-0001-0000-0000-000000000001';
const CONV_ID = 'bbbbccdd-0003-0000-0000-000000000001';
const CITY_ID = 'bbbbccdd-0005-0000-0000-000000000001';
const LEAD_ID = 'leadaaaa-0000-0000-0000-000000000001';
const PHONE_NORMALIZED = '5569999999999';

beforeEach(() => {
  vi.clearAllMocks();
  mockLinkConversationLead.mockResolvedValue(undefined);
});

describe('linkOrCreateLeadForConversation', () => {
  const mockDb = {} as unknown as Database;

  it('1. match -- lead existente no CRM -> vincula conversa ao lead', async () => {
    mockFindLeadByPhoneInOrg.mockResolvedValue({ id: LEAD_ID });

    const result = await linkOrCreateLeadForConversation(mockDb, {
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      contactRemoteId: PHONE_NORMALIZED,
      contactName: 'Maria Silva',
      cityId: CITY_ID,
    });

    expect(result).toBe(LEAD_ID);
    expect(mockLinkConversationLead).toHaveBeenCalledWith(mockDb, CONV_ID, ORG_ID, LEAD_ID);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
    expect(mockIsFlagEnabled).not.toHaveBeenCalled();
  });

  it('2. no-match + flag on + cityId -> cria lead-shell e vincula conversa', async () => {
    mockFindLeadByPhoneInOrg.mockResolvedValue(null);
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockGetOrCreateLead.mockResolvedValue({
      lead_id: LEAD_ID,
      customer_id: null,
      created: true,
      current_stage: null,
      city_id: CITY_ID,
      assigned_agent_id: null,
    });

    const result = await linkOrCreateLeadForConversation(mockDb, {
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      contactRemoteId: PHONE_NORMALIZED,
      contactName: 'Joao Novo',
      cityId: CITY_ID,
    });

    expect(result).toBe(LEAD_ID);
    expect(mockGetOrCreateLead).toHaveBeenCalledWith(
      mockDb,
      ORG_ID,
      expect.objectContaining({
        phone: '+' + PHONE_NORMALIZED,
        source: 'whatsapp',
        cityId: CITY_ID,
      }),
      null,
    );
    expect(mockLinkConversationLead).toHaveBeenCalledWith(mockDb, CONV_ID, ORG_ID, LEAD_ID);
  });

  it('3. no-match + flag off -> lead_id permanece NULL', async () => {
    mockFindLeadByPhoneInOrg.mockResolvedValue(null);
    mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });

    const result = await linkOrCreateLeadForConversation(mockDb, {
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      contactRemoteId: PHONE_NORMALIZED,
      contactName: undefined,
      cityId: CITY_ID,
    });

    expect(result).toBeNull();
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
    expect(mockLinkConversationLead).not.toHaveBeenCalled();
  });

  it('4. no-match + flag on + sem cityId -> NULL (constraint NOT NULL em leads)', async () => {
    mockFindLeadByPhoneInOrg.mockResolvedValue(null);
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });

    const result = await linkOrCreateLeadForConversation(mockDb, {
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      contactRemoteId: PHONE_NORMALIZED,
      contactName: undefined,
      cityId: undefined,
    });

    expect(result).toBeNull();
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
    expect(mockLinkConversationLead).not.toHaveBeenCalled();
  });

  it('5. idempotencia -- dois inbounds do mesmo contato: match nos dois, sem criar lead', async () => {
    mockFindLeadByPhoneInOrg.mockResolvedValue({ id: LEAD_ID });

    const r1 = await linkOrCreateLeadForConversation(mockDb, {
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      contactRemoteId: PHONE_NORMALIZED,
      contactName: undefined,
      cityId: CITY_ID,
    });

    const r2 = await linkOrCreateLeadForConversation(mockDb, {
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      contactRemoteId: PHONE_NORMALIZED,
      contactName: undefined,
      cityId: CITY_ID,
    });

    expect(r1).toBe(LEAD_ID);
    expect(r2).toBe(LEAD_ID);
    expect(mockGetOrCreateLead).not.toHaveBeenCalled();
    expect(mockLinkConversationLead).toHaveBeenCalledTimes(2);
  });

  it('6. contactRemoteId nao-numerico (IGSID) -> null sem lookup', async () => {
    const result = await linkOrCreateLeadForConversation(mockDb, {
      conversationId: CONV_ID,
      organizationId: ORG_ID,
      contactRemoteId: 'instagram-user-id-abc123',
      contactName: undefined,
      cityId: CITY_ID,
    });

    expect(result).toBeNull();
    expect(mockFindLeadByPhoneInOrg).not.toHaveBeenCalled();
    expect(mockLinkConversationLead).not.toHaveBeenCalled();
  });
});
