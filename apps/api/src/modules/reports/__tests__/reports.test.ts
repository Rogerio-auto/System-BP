/* eslint-disable @typescript-eslint/no-explicit-any */
// reports/__tests__/reports.test.ts -- Testes modulo reports (F23-S03)
// RBAC, scope, self-scope, funnel conversionRate, PII check, custom range

import { beforeEach, describe, expect, it, vi } from 'vitest';

// mocks de repository
const mockGetOverviewLeads = vi.fn();
const mockGetOverviewSimulations = vi.fn();
const mockGetOverviewContracts = vi.fn();
const mockGetOverviewConversations = vi.fn();
const mockGetFunnelStages = vi.fn();
const mockGetAttendanceTotals = vi.fn();
const mockGetAttendanceByChannel = vi.fn();
const mockGetAttendanceTimings = vi.fn();

vi.mock('../repository.js', () => ({
  getOverviewLeads: (...a: unknown[]) => mockGetOverviewLeads(...a),
  getOverviewSimulations: (...a: unknown[]) => mockGetOverviewSimulations(...a),
  getOverviewContracts: (...a: unknown[]) => mockGetOverviewContracts(...a),
  getOverviewConversations: (...a: unknown[]) => mockGetOverviewConversations(...a),
  getFunnelStages: (...a: unknown[]) => mockGetFunnelStages(...a),
  getAttendanceTotals: (...a: unknown[]) => mockGetAttendanceTotals(...a),
  getAttendanceByChannel: (...a: unknown[]) => mockGetAttendanceByChannel(...a),
  getAttendanceTimings: (...a: unknown[]) => mockGetAttendanceTimings(...a),
}));

const mockAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/audit.js', () => ({ auditLog: (...a: unknown[]) => mockAuditLog(...a) }));

import { getReportsAttendance, getReportsFunnel, getReportsOverview } from '../service.js';

// fixtures
const mockDb = {
  transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn({})),
};

const LEADS_RESULT = {
  total: 10,
  newInPeriod: 3,
  closedWon: 2,
  closedLost: 1,
  conversionRate: 66.67,
};
const SIM_RESULT = { total: 5, amountSum: 50000, amountAvg: 10000 };
const CONT_RESULT = { active: 3, settled: 1, defaulted: 0, activePrincipalSum: 30000 };
const CONV_RESULT = { open: 2, resolved: 8 };
const TOTALS_RESULT = { conversationsOpened: 15, conversationsResolved: 10, messagesTotal: 100 };
const CHANNEL_RESULT = [{ channel: 'whatsapp', conversationCount: 10, messageCount: 80 }];
const TIMINGS_RESULT = {
  firstResponseAvgSec: 300,
  firstResponseP90Sec: 600,
  resolutionAvgSec: 3600,
  resolutionP90Sec: 7200,
};

const adminActor = {
  userId: 'user-admin-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read'],
  cityScopeIds: null,
};
const regionalActor = {
  userId: 'user-regional-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read'],
  cityScopeIds: ['city-1'],
};
const agentActor = {
  userId: 'user-agent-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read_by_agent'],
  cityScopeIds: ['city-1'],
};
const noPermActor = {
  userId: 'user-noperm-1',
  organizationId: 'org-1',
  permissions: [],
  cityScopeIds: null,
};
const baseQuery = { range: 'last30d' as const, compareWithPrevious: false };

describe('getReportsOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOverviewLeads.mockResolvedValue(LEADS_RESULT);
    mockGetOverviewSimulations.mockResolvedValue(SIM_RESULT);
    mockGetOverviewContracts.mockResolvedValue(CONT_RESULT);
    mockGetOverviewConversations.mockResolvedValue(CONV_RESULT);
  });

  it('admin (null scope) chama repository sem filtro de cidade', async () => {
    const result = await getReportsOverview(mockDb as any, adminActor, baseQuery);
    expect(mockGetOverviewLeads).toHaveBeenCalledOnce();
    const [, orgId, scopeCtx, , selfUserId] = mockGetOverviewLeads.mock.calls[0]!;
    expect(orgId).toBe('org-1');
    expect((scopeCtx as any).cityScopeIds).toBeNull();
    expect(selfUserId).toBeNull();
    expect(result.range.scope).toBe('global');
    expect(result.leads.total).toBe(10);
  });

  it('gestor_regional (city scope) passa cityScopeIds correto', async () => {
    const result = await getReportsOverview(mockDb as any, regionalActor, baseQuery);
    const [, orgId, scopeCtx, , selfUserId] = mockGetOverviewLeads.mock.calls[0]!;
    expect(orgId).toBe('org-1');
    expect((scopeCtx as any).cityScopeIds).toEqual(['city-1']);
    expect(selfUserId).toBeNull();
    expect(result.range.scope).toBe('city');
  });

  it('agente tem self-scope aplicado (selfUserId = actor.userId)', async () => {
    const result = await getReportsOverview(mockDb as any, agentActor, baseQuery);
    const [, , , , selfUserId] = mockGetOverviewLeads.mock.calls[0]!;
    expect(selfUserId).toBe('user-agent-1');
    expect(result.range.scope).toBe('self');
  });

  it('agente nao pode filtrar por cityIds (403)', async () => {
    await expect(
      getReportsOverview(mockDb as any, agentActor, { ...baseQuery, cityIds: ['city-2'] }),
    ).rejects.toThrow('Agentes');
  });

  it('agente nao pode filtrar por agentIds alheios (403)', async () => {
    await expect(
      getReportsOverview(mockDb as any, agentActor, { ...baseQuery, agentIds: ['user-other'] }),
    ).rejects.toThrow('Agentes');
  });

  it('sem permissao lanca ForbiddenError (403)', async () => {
    await expect(getReportsOverview(mockDb as any, noPermActor, baseQuery)).rejects.toThrow(
      'Permiss',
    );
  });

  it('response nao expoe PII', async () => {
    const result = await getReportsOverview(mockDb as any, adminActor, baseQuery);
    const forbidden = ['name', 'cpf', 'phone', 'email'];
    const hasPii = Object.keys(result.leads).some((k) =>
      forbidden.some((f) => k.toLowerCase().includes(f)),
    );
    expect(hasPii).toBe(false);
  });

  it('range=custom sem dateFrom lanca erro', async () => {
    await expect(
      getReportsOverview(mockDb as any, adminActor, {
        range: 'custom',
        compareWithPrevious: false,
      }),
    ).rejects.toThrow('dateFrom');
  });

  it('cross-org: organizationId do ator sempre propagado', async () => {
    await getReportsOverview(mockDb as any, adminActor, baseQuery);
    const [, orgId] = mockGetOverviewLeads.mock.calls[0]!;
    expect(orgId).toBe('org-1');
  });
});

describe('getReportsFunnel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFunnelStages.mockResolvedValue([
      {
        stageId: 'stage-1',
        stageName: 'Qualificacao',
        stageOrder: 1,
        cardCount: 10,
        staleCardCount: 2,
        avgDwellHours: 24,
        medianDwellHours: 20,
      },
      {
        stageId: 'stage-2',
        stageName: 'Simulacao',
        stageOrder: 2,
        cardCount: 5,
        staleCardCount: 1,
        avgDwellHours: 12,
        medianDwellHours: 10,
      },
      {
        stageId: 'stage-3',
        stageName: 'Aprovacao',
        stageOrder: 3,
        cardCount: 0,
        staleCardCount: 0,
        avgDwellHours: null,
        medianDwellHours: null,
      },
    ]);
  });

  it('calcula conversionToNextRate entre stages consecutivos', async () => {
    const result = await getReportsFunnel(mockDb as any, adminActor, baseQuery);
    expect(result.stages).toHaveLength(3);
    // stage 1 (10) -> stage 2 (5): 50%
    expect(result.stages[0]?.conversionToNextRate).toBe(50);
    // stage 2 (5) -> stage 3 (0): 0%
    expect(result.stages[1]?.conversionToNextRate).toBe(0);
    // ultimo stage: null
    expect(result.stages[2]?.conversionToNextRate).toBeNull();
  });

  it('admin recebe scope global', async () => {
    const result = await getReportsFunnel(mockDb as any, adminActor, baseQuery);
    expect(result.range.scope).toBe('global');
  });

  it('regional recebe scope city', async () => {
    const result = await getReportsFunnel(mockDb as any, regionalActor, baseQuery);
    expect(result.range.scope).toBe('city');
  });

  it('agente recebe scope self', async () => {
    const result = await getReportsFunnel(mockDb as any, agentActor, baseQuery);
    expect(result.range.scope).toBe('self');
  });
});

describe('getReportsAttendance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAttendanceTotals.mockResolvedValue(TOTALS_RESULT);
    mockGetAttendanceByChannel.mockResolvedValue(CHANNEL_RESULT);
    mockGetAttendanceTimings.mockResolvedValue(TIMINGS_RESULT);
  });

  it('admin recebe totais + breakdown por canal + timings', async () => {
    const result = await getReportsAttendance(mockDb as any, adminActor, baseQuery);
    expect(result.totals.conversationsOpened).toBe(15);
    expect(result.totals.conversationsResolved).toBe(10);
    expect(result.byChannel).toHaveLength(1);
    expect(result.timings.firstResponseAvgSec).toBe(300);
    expect(result.range.scope).toBe('global');
  });

  it('agente passa selfUserId para getAttendanceTotals', async () => {
    await getReportsAttendance(mockDb as any, agentActor, baseQuery);
    const callArgs = mockGetAttendanceTotals.mock.calls[0]!;
    expect(callArgs[4]).toBe('user-agent-1');
  });

  it('sem permissao lanca 403 em attendance', async () => {
    await expect(getReportsAttendance(mockDb as any, noPermActor, baseQuery)).rejects.toThrow(
      'Permiss',
    );
  });
});
