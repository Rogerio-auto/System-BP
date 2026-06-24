/* eslint-disable @typescript-eslint/no-explicit-any */
// reports/__tests__/reports-credit-collection.test.ts -- F23-S04
// Testes de service (mocked) + repository SQL (via vi.importActual).
// Cobre: credit, collection, productivity -- city-scope, self-scope (D3), SQL placeholders.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- mocks de repository ----
const mockGetCreditAggregate = vi.fn();
const mockGetCreditByProduct = vi.fn();
const mockGetCollectionWallet = vi.fn();
const mockGetCollectionJobsStats = vi.fn();
const mockGetProductivityByAgent = vi.fn();
const mockGetProductivityTeamAverage = vi.fn();

vi.mock('../repository.js', () => ({
  // F23-S03 fns (needed by service imports)
  getOverviewLeads: vi.fn(),
  getOverviewSimulations: vi.fn(),
  getOverviewContracts: vi.fn(),
  getOverviewConversations: vi.fn(),
  getFunnelStages: vi.fn(),
  getAttendanceTotals: vi.fn(),
  getAttendanceByChannel: vi.fn(),
  getAttendanceTimings: vi.fn(),
  // F23-S04 fns
  getCreditAggregate: (...a: unknown[]) => mockGetCreditAggregate(...a),
  getCreditByProduct: (...a: unknown[]) => mockGetCreditByProduct(...a),
  getCollectionWallet: (...a: unknown[]) => mockGetCollectionWallet(...a),
  getCollectionJobsStats: (...a: unknown[]) => mockGetCollectionJobsStats(...a),
  getProductivityByAgent: (...a: unknown[]) => mockGetProductivityByAgent(...a),
  getProductivityTeamAverage: (...a: unknown[]) => mockGetProductivityTeamAverage(...a),
}));

const mockAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/audit.js', () => ({ auditLog: (...a: unknown[]) => mockAuditLog(...a) }));

import { getReportsCollection, getReportsCredit, getReportsProductivity } from '../service.js';

const mockDb = {
  transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn({})),
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
const billingActor = {
  userId: 'user-billing-1',
  organizationId: 'org-1',
  permissions: ['billing:read'],
  cityScopeIds: null,
};
const noBillingActor = {
  userId: 'user-nobilling-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read'],
  cityScopeIds: null,
};

const baseQuery = { range: 'last30d' as const, compareWithPrevious: false as const };

const CREDIT_AGG = {
  simulations: 100,
  simulationsAmountSum: 1000000,
  simulationsAmountAvg: 10000,
  simulationsTermAvg: 24,
  analyses: 50,
  analysesApproved: 30,
  analysesRefused: 15,
  analysesInProgress: 5,
  analysesApprovedAmountAvg: 9000,
  contracts: 20,
  contractsActive: 15,
  contractsSettled: 3,
  contractsDefaulted: 2,
  contractsPrincipalSum: 180000,
};
const CREDIT_BY_PRODUCT: never[] = [];

const WALLET_RESULT = {
  pending: 50,
  pendingAmountSum: 25000,
  overdue: 10,
  overdueAmountSum: 5000,
  paid: 100,
  paidAmountSum: 60000,
  renegotiated: 5,
  cancelled: 2,
  avgDaysOverdue: 12.5,
};
const JOBS_RESULT = { scheduled: 200, sent: 180, failed: 10, paidBeforeSend: 5 };

const AGENT_ROW = {
  agentId: 'agent-uuid-1',
  displayName: 'Ana Clara',
  leadsClosedWon: 8,
  simulationsCreated: 12,
  conversationsResolved: 25,
  contractsOriginated: 5,
  avgFirstResponseSec: 180,
};
const TEAM_AVG = {
  leadsClosedWon: 5,
  simulationsCreated: 8,
  conversationsResolved: 18,
  contractsOriginated: 3,
};

describe('getReportsCredit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCreditAggregate.mockResolvedValue(CREDIT_AGG);
    mockGetCreditByProduct.mockResolvedValue(CREDIT_BY_PRODUCT);
  });

  it('admin — funil correto e rates calculados', async () => {
    const result = await getReportsCredit(mockDb as any, adminActor, baseQuery);
    expect(result.range.scope).toBe('global');
    expect(result.funnel.simulations).toBe(100);
    expect(result.funnel.analyses).toBe(50);
    expect(result.funnel.analysesApproved).toBe(30);
    expect(result.funnel.analysesRefused).toBe(15);
    expect(result.funnel.analysesInProgress).toBe(5);
    expect(result.funnel.contracts).toBe(20);
    // simToAnalysisRate = 50/100 * 100 = 50
    expect(result.funnel.simToAnalysisRate).toBe(50);
    // approvalRate = 30/50 * 100 = 60
    expect(result.funnel.approvalRate).toBe(60);
    // simToContractRate = 20/100 * 100 = 20
    expect(result.funnel.simToContractRate).toBe(20);
    // defaultRate = 2/20 * 100 = 10
    expect(result.contractsByStatus.defaultRate).toBe(10);
    expect(result.amounts.contractsPrincipalSum).toBe(180000);
  });

  it('regional (city-scoped) — scope=city', async () => {
    const result = await getReportsCredit(mockDb as any, regionalActor, baseQuery);
    expect(result.range.scope).toBe('city');
  });

  it('agente (self-scoped) — scope=self, chama repository com cityScopeIds=city-1', async () => {
    const result = await getReportsCredit(mockDb as any, agentActor, baseQuery);
    expect(result.range.scope).toBe('self');
    // getCreditAggregate called with cityScopeIds=[city-1] via scopeCtx
    const [, , scopeCtx] = mockGetCreditAggregate.mock.calls[0]!;
    expect((scopeCtx as any).cityScopeIds).toEqual(['city-1']);
  });

  it('zero simulations → rates = 0 (nao null)', async () => {
    mockGetCreditAggregate.mockResolvedValue({
      ...CREDIT_AGG,
      simulations: 0,
      analyses: 0,
      contracts: 0,
    });
    const result = await getReportsCredit(mockDb as any, adminActor, baseQuery);
    expect(result.funnel.simToAnalysisRate).toBe(0);
    expect(result.funnel.approvalRate).toBe(0);
    expect(result.funnel.simToContractRate).toBe(0);
    expect(result.contractsByStatus.defaultRate).toBe(0);
  });
});

describe('getReportsCollection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCollectionWallet.mockResolvedValue(WALLET_RESULT);
    mockGetCollectionJobsStats.mockResolvedValue(JOBS_RESULT);
  });

  it('billing:read — wallet + rates + jobsEfficiency calculados', async () => {
    const result = await getReportsCollection(mockDb as any, billingActor, baseQuery);
    expect(result.range.scope).toBe('global');
    expect(result.wallet.pending).toBe(50);
    expect(result.wallet.overdue).toBe(10);
    // adimplenciaRate = 50/(50+10) * 100 = 83.33
    expect(result.rates.adimplenciaRate).toBeCloseTo(83.33, 1);
    // inadimplenciaRate = 10/(50+10) * 100 = 16.67
    expect(result.rates.inadimplenciaRate).toBeCloseTo(16.67, 1);
    expect(result.rates.avgDaysOverdue).toBe(12.5);
    // sendRate = 180/(180+10) * 100 = 94.74
    expect(result.jobsEfficiency.sendRate).toBeCloseTo(94.74, 1);
    // failRate = 10/(180+10) * 100 = 5.26
    expect(result.jobsEfficiency.failRate).toBeCloseTo(5.26, 1);
  });

  it('sem billing:read lanca 403', async () => {
    await expect(getReportsCollection(mockDb as any, noBillingActor, baseQuery)).rejects.toThrow(
      'billing:read',
    );
  });

  it('sem billing:read lanca 403 (agente)', async () => {
    await expect(getReportsCollection(mockDb as any, agentActor, baseQuery)).rejects.toThrow(
      'billing:read',
    );
  });

  it('zero ativos -> rates = 0 (nao null, compatível com Zod nonnegative)', async () => {
    mockGetCollectionWallet.mockResolvedValue({ ...WALLET_RESULT, pending: 0, overdue: 0 });
    const result = await getReportsCollection(mockDb as any, billingActor, baseQuery);
    expect(result.rates.adimplenciaRate).toBe(0);
    expect(result.rates.inadimplenciaRate).toBe(0);
  });
});

describe('getReportsProductivity — D3 self-scope gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProductivityByAgent.mockResolvedValue([AGENT_ROW]);
    mockGetProductivityTeamAverage.mockResolvedValue(TEAM_AVG);
  });

  it('gestor (dashboard:read) — vê todos os agentes, sem teamAverage', async () => {
    const result = await getReportsProductivity(mockDb as any, adminActor, baseQuery);
    expect(result.range.scope).toBe('global');
    expect(result.agents).toHaveLength(1);
    expect(result.teamAverage).toBeUndefined();
    // includeDisplayName = true para gestor
    const [, , , , , includeDisplayName] = mockGetProductivityByAgent.mock.calls[0]!;
    expect(includeDisplayName).toBe(true);
    // selfUserId = null para gestor
    const [, , , , selfUserId] = mockGetProductivityByAgent.mock.calls[0]!;
    expect(selfUserId).toBeNull();
  });

  it('agente (self-scoped D3) — vê só própria linha + teamAverage anônima', async () => {
    const result = await getReportsProductivity(mockDb as any, agentActor, baseQuery);
    expect(result.range.scope).toBe('self');
    expect(result.agents).toHaveLength(1);
    // teamAverage presente para self-scoped
    expect(result.teamAverage).toBeDefined();
    expect(result.teamAverage?.leadsClosedWon).toBe(5);
    // includeDisplayName = false para agente (D3: não expõe nomes dos colegas)
    const [, , , , , includeDisplayName] = mockGetProductivityByAgent.mock.calls[0]!;
    expect(includeDisplayName).toBe(false);
    // selfUserId = agente userId
    const [, , , , selfUserId] = mockGetProductivityByAgent.mock.calls[0]!;
    expect(selfUserId).toBe('user-agent-1');
    // getProductivityTeamAverage chamado com excludeUserId = agente userId
    const [, , , , excludeUserId] = mockGetProductivityTeamAverage.mock.calls[0]!;
    expect(excludeUserId).toBe('user-agent-1');
  });

  it('gestor regional (city-scoped) — scope=city, sem teamAverage', async () => {
    const result = await getReportsProductivity(mockDb as any, regionalActor, baseQuery);
    expect(result.range.scope).toBe('city');
    expect(result.teamAverage).toBeUndefined();
  });

  it('sem permissao lanca 403', async () => {
    const noPermActor = {
      userId: 'x',
      organizationId: 'org-1',
      permissions: [],
      cityScopeIds: null,
    };
    await expect(getReportsProductivity(mockDb as any, noPermActor, baseQuery)).rejects.toThrow(
      'Permiss',
    );
  });
});

// ---------------------------------------------------------------------------
// Repository SQL tests --- via vi.importActual (real impl, no mocks)
// ---------------------------------------------------------------------------

const CITY_UUID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CITY_UUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ORG_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PROD_UUID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const repoDateRange = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-01-31T23:59:59.999Z'),
};

interface DrizzleSqlObject {
  toQuery: (dialect: {
    escapeName: (n: string) => string;
    escapeString: (s: string) => string;
    escapeParam: (n: number, v: unknown) => string;
  }) => { sql: string; params: unknown[] };
}

function makeCaptureDb() {
  let captured: { sql: string; params: unknown[] } | null = null;
  const db = {
    execute: vi.fn().mockImplementation((sqlObj: DrizzleSqlObject) => {
      const query = sqlObj.toQuery({
        escapeName: (n: string) => `"${n}"`,
        escapeString: (s: string) => "'" + s + "'",
        escapeParam: (n: number) => '$' + n,
      });
      captured = { sql: query.sql, params: query.params };
      return Promise.resolve({ rows: [] });
    }),
  };
  return { db, getCapture: () => captured };
}

interface RepoFns {
  getCreditAggregate: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    filterCityIds?: string[],
    filterProductIds?: string[],
  ) => Promise<unknown>;
  getCreditByProduct: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    filterCityIds?: string[],
    filterProductIds?: string[],
  ) => Promise<unknown[]>;
  getCollectionWallet: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    filterCityIds?: string[],
  ) => Promise<unknown>;
  getProductivityByAgent: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    dateRange: { from: Date; to: Date },
    selfUserId: string | null,
    includeDisplayName: boolean,
    filterCityIds?: string[],
  ) => Promise<unknown[]>;
}

describe('repository — SQL parametrizado (vi.importActual)', () => {
  let repo: RepoFns;
  beforeEach(async () => {
    repo = await vi.importActual<RepoFns>('../repository.js');
  });

  it('getCreditAggregate: city-scope usa placeholders, nao UUIDs interpolados', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getCreditAggregate(db as any, ORG_UUID, {
      cityScopeIds: [CITY_UUID_A, CITY_UUID_B],
    });
    const cap = getCapture()!;
    // SQL nao deve conter UUIDs literais (teriam que estar como placeholders)
    expect(cap.sql).not.toContain(CITY_UUID_A);
    expect(cap.sql).not.toContain(CITY_UUID_B);
    // SQL deve conter placeholders
    expect(cap.sql).toMatch(/\$\d+/);
    // Params devem conter os UUIDs
    expect(cap.params).toContain(CITY_UUID_A);
    expect(cap.params).toContain(CITY_UUID_B);
  });

  it('getCreditAggregate: cityScopeIds=[] retorna empty sem tocar banco', async () => {
    const { db } = makeCaptureDb();
    const result = await repo.getCreditAggregate(db as any, ORG_UUID, { cityScopeIds: [] });
    expect(db.execute).not.toHaveBeenCalled();
    expect((result as any).simulations).toBe(0);
  });

  it('getCreditByProduct: filterProductIds usa placeholders', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getCreditByProduct(db as any, ORG_UUID, { cityScopeIds: null }, undefined, [
      PROD_UUID,
    ]);
    const cap = getCapture()!;
    expect(cap.sql).not.toContain(PROD_UUID);
    expect(cap.params).toContain(PROD_UUID);
  });

  it('getCollectionWallet: city-scope usa placeholders', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getCollectionWallet(db as any, ORG_UUID, { cityScopeIds: [CITY_UUID_A] });
    const cap = getCapture()!;
    expect(cap.sql).not.toContain(CITY_UUID_A);
    expect(cap.params).toContain(CITY_UUID_A);
  });

  it('getProductivityByAgent: self-scoped emite AND a.user_id = $N', async () => {
    const { db, getCapture } = makeCaptureDb();
    const SELF_UUID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    await repo.getProductivityByAgent(
      db as any,
      ORG_UUID,
      { cityScopeIds: null },
      repoDateRange,
      SELF_UUID,
      false,
    );
    const cap = getCapture()!;
    // selfUserId nao interpolado - deve estar como placeholder
    expect(cap.sql).not.toContain(SELF_UUID);
    expect(cap.params).toContain(SELF_UUID);
    // displayName col = NULL::text quando includeDisplayName=false
    expect(cap.sql).toContain('NULL::text');
  });

  it('getProductivityByAgent: manager (includeDisplayName=true) usa a.display_name', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getProductivityByAgent(
      db as any,
      ORG_UUID,
      { cityScopeIds: null },
      repoDateRange,
      null,
      true,
    );
    const cap = getCapture()!;
    expect(cap.sql).toContain('a.display_name');
  });
});
