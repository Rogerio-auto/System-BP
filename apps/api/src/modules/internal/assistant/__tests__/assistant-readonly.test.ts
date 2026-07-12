// internal/assistant/__tests__/assistant-readonly.test.ts -- F6-S06
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

// Token matches LANGGRAPH_INTERNAL_TOKEN from vitest globalSetup (src/test/setup.ts)
const VALID_TOKEN = 'test-langgraph-token-vitest-only-00';
vi.mock('../../../reports/repository.js', () => ({
  getFunnelStages: vi.fn().mockResolvedValue([
    {
      stageId: 's1',
      stageName: 'Novo',
      stageOrder: 1,
      cardCount: 10,
      staleCardCount: 2,
      avgDwellHours: 24,
      medianDwellHours: 20,
    },
  ]),
  getOverviewLeads: vi.fn().mockResolvedValue({
    total: 100,
    newInPeriod: 10,
    closedWon: 5,
    closedLost: 3,
    conversionRate: 62.5,
  }),
  getCollectionWallet: vi.fn().mockResolvedValue({
    pending: 5,
    pendingAmountSum: 15000,
    overdue: 3,
    overdueAmountSum: 9000,
    paid: 10,
    paidAmountSum: 30000,
    renegotiated: 1,
    cancelled: 0,
    avgDaysOverdue: 5,
  }),
}));
vi.mock('../../../credit-analyses/repository.js', () => ({
  findAnalysesByLeadId: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        status: 'em_analise',
        approvedAmount: null,
        createdAt: new Date('2026-07-01T00:00:00Z'),
      },
    ],
    total: 1,
  }),
}));
vi.mock('../../../leads/repository.js', () => ({
  findLeadById: vi.fn().mockResolvedValue({ id: '33333333-3333-3333-3333-333333333333' }),
  findLeads: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findCityNamesByIds: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock('../repository.js', () => ({
  findLeadConversationMessages: vi.fn().mockResolvedValue({
    messages: [
      {
        direction: 'in',
        content: 'Oi, quero saber sobre o credito',
        createdAt: new Date('2026-07-01T10:00:00Z'),
      },
      {
        direction: 'out',
        content: 'Claro! Vamos te ajudar.',
        createdAt: new Date('2026-07-01T10:01:00Z'),
      },
    ],
    truncated: false,
  }),
}));
vi.mock('../../../../db/client.js', () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [{ name: 'Joao da Silva' }] }) },
}));
import { buildApp } from '../../../../app.js';
import { findCityNamesByIds, findLeadById, findLeads } from '../../../leads/repository.js';
import { findLeadConversationMessages } from '../repository.js';
import { maskLeadName } from '../service.js';

const PRINCIPAL_FULL = {
  user_id: '11111111-1111-1111-1111-111111111111',
  organization_id: '22222222-2222-2222-2222-222222222222',
  permissions: ['dashboard:read', 'leads:read', 'analyses:read', 'billing:read'],
  city_scope_ids: null,
};
const QUERY = { range: 'last7d' };

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
describe('POST /internal/assistant/funnel-metrics', () => {
  it('200 caminho feliz', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/funnel-metrics',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_FULL, query: QUERY },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('assistant.funnel-metrics');
    expect(Array.isArray(body.stages)).toBe(true);
    expect(body.overview.total).toBe(100);
    expect(res.payload).not.toMatch(/cpf/i);
    expect(res.payload).not.toMatch(/telefone|phone/i);
  });
  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/funnel-metrics',
      payload: { principal: PRINCIPAL_FULL, query: QUERY },
    });
    expect(res.statusCode).toBe(401);
  });
  it('403 sem permissao dashboard:read', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/funnel-metrics',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: { ...PRINCIPAL_FULL, permissions: ['leads:read'] }, query: QUERY },
    });
    expect(res.statusCode).toBe(403);
  });
  it('403 cidade fora do scope', async () => {
    const principal = {
      ...PRINCIPAL_FULL,
      city_scope_ids: ['44444444-4444-4444-4444-444444444444'],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/funnel-metrics',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        principal,
        query: { ...QUERY, cityIds: ['55555555-5555-5555-5555-555555555555'] },
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
describe('POST /internal/assistant/lead-count', () => {
  it('200 caminho feliz', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-count',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_FULL, query: QUERY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().source).toBe('assistant.lead-count');
    expect(res.json().total).toBe(100);
  });
  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-count',
      payload: { principal: PRINCIPAL_FULL, query: QUERY },
    });
    expect(res.statusCode).toBe(401);
  });
  it('403 sem permissao leads:read', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-count',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: { ...PRINCIPAL_FULL, permissions: ['dashboard:read'] }, query: QUERY },
    });
    expect(res.statusCode).toBe(403);
  });
});
describe('POST /internal/assistant/analysis-status', () => {
  it('200 nome mascarado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/analysis-status',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_FULL, lead_id: '33333333-3333-3333-3333-333333333333' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('assistant.analysis-status');
    expect(body.leadNameMasked).toBe('J. Silva');
    expect(body.analyses[0].id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(body.analyses[0].status).toBe('em_analise');
    expect(res.payload).not.toMatch(/cpf/i);
  });
  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/analysis-status',
      payload: { principal: PRINCIPAL_FULL, lead_id: '33333333-3333-3333-3333-333333333333' },
    });
    expect(res.statusCode).toBe(401);
  });
  it('403 sem permissao', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/analysis-status',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        principal: { ...PRINCIPAL_FULL, permissions: ['dashboard:read'] },
        lead_id: '33333333-3333-3333-3333-333333333333',
      },
    });
    expect(res.statusCode).toBe(403);
  });
  it('404 lead nao encontrado', async () => {
    const mod = await import('../../../credit-analyses/repository.js');
    vi.mocked(mod.findAnalysesByLeadId).mockResolvedValueOnce({ data: [], total: 0 });
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/analysis-status',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_FULL, lead_id: '33333333-3333-3333-3333-333333333333' },
    });
    expect(res.statusCode).toBe(404);
  });
});
describe('POST /internal/assistant/billing-upcoming', () => {
  it('200 caminho feliz (snapshot da carteira, sem range)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/billing-upcoming',
      headers: { 'x-internal-token': VALID_TOKEN },
      // Billing não aceita range: é snapshot de estado atual (review F6-S06 M-1).
      payload: { principal: PRINCIPAL_FULL, query: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('assistant.billing-upcoming');
    expect(body.overdueCount).toBe(3);
    expect(body.upcomingCount).toBe(5);
    expect(body.snapshotLabel).toBe('Carteira atual');
    expect(body.rangeLabel).toBeUndefined();
    expect(res.payload).not.toMatch(/cpf|telefone/i);
  });
  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/billing-upcoming',
      payload: { principal: PRINCIPAL_FULL, query: QUERY },
    });
    expect(res.statusCode).toBe(401);
  });
  it('403 sem permissao billing:read', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/billing-upcoming',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: { ...PRINCIPAL_FULL, permissions: ['dashboard:read'] }, query: QUERY },
    });
    expect(res.statusCode).toBe(403);
  });
});
describe('POST /internal/assistant/lead-conversation', () => {
  const LEAD_ID = '33333333-3333-3333-3333-333333333333';
  const PRINCIPAL_CONVERSATION = {
    ...PRINCIPAL_FULL,
    permissions: ['livechat:conversation:read'],
  };

  it('200 caminho feliz', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-conversation',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_CONVERSATION, lead_id: LEAD_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('assistant.lead-conversation');
    expect(body.lead_id).toBe(LEAD_ID);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      direction: 'in',
      content: 'Oi, quero saber sobre o credito',
      created_at: '2026-07-01T10:00:00.000Z',
    });
    expect(body.truncated).toBe(false);
    expect(res.payload).not.toMatch(/cpf/i);
    expect(res.payload).not.toMatch(/telefone/i);
  });

  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-conversation',
      payload: { principal: PRINCIPAL_CONVERSATION, lead_id: LEAD_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 sem permissao livechat:conversation:read', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-conversation',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        principal: { ...PRINCIPAL_FULL, permissions: ['dashboard:read'] },
        lead_id: LEAD_ID,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 lead fora do escopo/org (nunca vaza existencia)', async () => {
    vi.mocked(findLeadById).mockResolvedValueOnce(null);
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-conversation',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_CONVERSATION, lead_id: LEAD_ID },
    });
    expect(res.statusCode).toBe(404);
  });

  it('200 lead sem conversa retorna lista vazia', async () => {
    vi.mocked(findLeadConversationMessages).mockResolvedValueOnce({
      messages: [],
      truncated: false,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-conversation',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_CONVERSATION, lead_id: LEAD_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages).toEqual([]);
    expect(body.truncated).toBe(false);
  });
});

// Fixture completa de Lead — findLeads() (leads/repository.ts) retorna o tipo
// completo do Drizzle; a busca só usa id/name/cityId, mas o mock precisa
// satisfazer o tipo inteiro (sem `as`).
function makeLeadFixture(overrides: Partial<{ id: string; name: string; cityId: string | null }>) {
  return {
    id: '77777777-7777-7777-7777-777777777777',
    organizationId: '22222222-2222-2222-2222-222222222222',
    cityId: null,
    agentId: null,
    name: 'Lead Fixture',
    phoneE164: '+5569900000000',
    phoneNormalized: '5569900000000',
    source: 'manual' as const,
    status: 'new' as const,
    email: null,
    cpfEncrypted: null,
    cpfHash: null,
    notes: null,
    lastSimulationId: null,
    lastAnalysisId: null,
    metadata: {},
    cnpj: null,
    legalName: null,
    notionPageId: null,
    anonymizedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('POST /internal/assistant/lead-search', () => {
  const PRINCIPAL_LEADS_READ = {
    ...PRINCIPAL_FULL,
    permissions: ['leads:read'],
  };
  const CITY_ID = '66666666-6666-6666-6666-666666666666';

  it('200 match unico', async () => {
    vi.mocked(findLeads).mockResolvedValueOnce({
      data: [
        makeLeadFixture({
          id: '77777777-7777-7777-7777-777777777777',
          name: 'Maria Souza',
          cityId: CITY_ID,
        }),
      ],
      total: 1,
    });
    vi.mocked(findCityNamesByIds).mockResolvedValueOnce(new Map([[CITY_ID, 'Porto Velho']]));

    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_LEADS_READ, name: 'Maria' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('assistant.lead-search');
    expect(body.candidates).toEqual([
      {
        lead_id: '77777777-7777-7777-7777-777777777777',
        name: 'Maria Souza',
        city_name: 'Porto Velho',
      },
    ]);
    expect(body.truncated).toBe(false);
    expect(res.payload).not.toMatch(/cpf/i);
    expect(res.payload).not.toMatch(/telefone|phone|email/i);
  });

  it('200 multiplos candidatos (desambiguacao de homonimos)', async () => {
    vi.mocked(findLeads).mockResolvedValueOnce({
      data: [
        makeLeadFixture({
          id: '11111111-aaaa-1111-aaaa-111111111111',
          name: 'Zeca Souza',
          cityId: null,
        }),
        makeLeadFixture({
          id: '22222222-aaaa-2222-aaaa-222222222222',
          name: 'Ana Souza',
          cityId: CITY_ID,
        }),
      ],
      total: 2,
    });
    vi.mocked(findCityNamesByIds).mockResolvedValueOnce(new Map([[CITY_ID, 'Porto Velho']]));

    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_LEADS_READ, name: 'Souza' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toHaveLength(2);
    // ordenado por nome (apresentacao) -- Ana antes de Zeca
    expect(body.candidates[0].name).toBe('Ana Souza');
    expect(body.candidates[1].name).toBe('Zeca Souza');
    expect(body.candidates[0].city_name).toBe('Porto Velho');
    expect(body.candidates[1].city_name).toBe(null);
    expect(body.truncated).toBe(false);
  });

  it('200 truncated quando ha mais candidatos que o limite', async () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      makeLeadFixture({
        id: `99999999-0000-0000-0000-00000000000${i}`,
        name: `Lead ${i}`,
        cityId: null,
      }),
    );
    vi.mocked(findLeads).mockResolvedValueOnce({ data: many, total: 20 });
    vi.mocked(findCityNamesByIds).mockResolvedValueOnce(new Map());

    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_LEADS_READ, name: 'Lead' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toHaveLength(8);
    expect(body.truncated).toBe(true);
  });

  it('200 nenhum candidato', async () => {
    vi.mocked(findLeads).mockResolvedValueOnce({ data: [], total: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_LEADS_READ, name: 'Ninguem' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toEqual([]);
    expect(body.truncated).toBe(false);
  });

  it('401 sem token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      payload: { principal: PRINCIPAL_LEADS_READ, name: 'Maria' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 sem permissao leads:read', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: {
        principal: { ...PRINCIPAL_FULL, permissions: ['dashboard:read'] },
        name: 'Maria',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 nome muito curto (min 2)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: PRINCIPAL_LEADS_READ, name: 'M' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('escopo de cidade do principal e repassado ao findLeads (nao vaza fora do escopo)', async () => {
    vi.mocked(findLeads).mockResolvedValueOnce({ data: [], total: 0 });
    const scopedPrincipal = { ...PRINCIPAL_LEADS_READ, city_scope_ids: [CITY_ID] };

    await app.inject({
      method: 'POST',
      url: '/internal/assistant/lead-search',
      headers: { 'x-internal-token': VALID_TOKEN },
      payload: { principal: scopedPrincipal, name: 'Maria' },
    });

    expect(findLeads).toHaveBeenCalledWith(
      expect.anything(),
      scopedPrincipal.organization_id,
      [CITY_ID],
      expect.objectContaining({ search: 'Maria' }),
    );
  });
});

describe('maskLeadName unit', () => {
  it('nome completo', () => {
    expect(maskLeadName('Joao da Silva')).toBe('J. Silva');
  });
  it('nome simples', () => {
    expect(maskLeadName('Maria')).toBe('M.');
  });
  it('null', () => {
    expect(maskLeadName(null)).toBe(null);
  });
  it('string vazia', () => {
    expect(maskLeadName('  ')).toBe(null);
  });
});
