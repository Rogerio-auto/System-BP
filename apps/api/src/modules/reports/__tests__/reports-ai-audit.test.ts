// reports/__tests__/reports-ai-audit.test.ts -- F23-S05
// Testes de service (mocked) + repository SQL (vi.importActual).
// Cobre: gating flag IA + permission, SQL parametrizado org-scope.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAiConversationHealth = vi.fn();
const mockGetAiHandoffReasons = vi.fn();
const mockGetAiNodeDistribution = vi.fn();
const mockGetAiLlmMetrics = vi.fn();
const mockGetAiModelBreakdown = vi.fn();
const mockGetAiHandoffSla = vi.fn();
const mockGetAuditVolume = vi.fn();
const mockGetAuditTopActions = vi.fn();
const mockGetAuditCriticalActions = vi.fn();
const mockGetEventOutboxHealth = vi.fn();
const mockGetEventDlqSnapshot = vi.fn();

vi.mock('../repository.js', () => ({
  getOverviewLeads: vi.fn(),
  getOverviewSimulations: vi.fn(),
  getOverviewContracts: vi.fn(),
  getOverviewConversations: vi.fn(),
  getFunnelStages: vi.fn(),
  getAttendanceTotals: vi.fn(),
  getAttendanceByChannel: vi.fn(),
  getAttendanceTimings: vi.fn(),
  getCreditAggregate: vi.fn(),
  getCreditByProduct: vi.fn(),
  getCollectionWallet: vi.fn(),
  getCollectionJobsStats: vi.fn(),
  getProductivityByAgent: vi.fn(),
  getProductivityTeamAverage: vi.fn(),
  getAiConversationHealth: (...a: unknown[]) => mockGetAiConversationHealth(...a),
  getAiHandoffReasons: (...a: unknown[]) => mockGetAiHandoffReasons(...a),
  getAiNodeDistribution: (...a: unknown[]) => mockGetAiNodeDistribution(...a),
  getAiLlmMetrics: (...a: unknown[]) => mockGetAiLlmMetrics(...a),
  getAiModelBreakdown: (...a: unknown[]) => mockGetAiModelBreakdown(...a),
  getAiHandoffSla: (...a: unknown[]) => mockGetAiHandoffSla(...a),
  getAuditVolume: (...a: unknown[]) => mockGetAuditVolume(...a),
  getAuditTopActions: (...a: unknown[]) => mockGetAuditTopActions(...a),
  getAuditCriticalActions: (...a: unknown[]) => mockGetAuditCriticalActions(...a),
  getEventOutboxHealth: (...a: unknown[]) => mockGetEventOutboxHealth(...a),
  getEventDlqSnapshot: (...a: unknown[]) => mockGetEventDlqSnapshot(...a),
}));

vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }));

const mockIsFlagEnabled = vi.fn();
vi.mock('../../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: (...a: unknown[]) => mockIsFlagEnabled(...a),
}));

import { getReportsAi, getReportsAudit } from '../service.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDb = { transaction: vi.fn().mockImplementation(async (fn: (tx: any) => any) => fn({})) };

const adminActor = {
  userId: 'u1',
  organizationId: 'org-1',
  permissions: ['dashboard:read', 'audit:read'],
  cityScopeIds: null,
};
const auditOnlyActor = {
  userId: 'u2',
  organizationId: 'org-1',
  permissions: ['audit:read'],
  cityScopeIds: null,
};
const dashOnlyActor = {
  userId: 'u3',
  organizationId: 'org-1',
  permissions: ['dashboard:read'],
  cityScopeIds: null,
};
const noPermActor = { userId: 'u4', organizationId: 'org-1', permissions: [], cityScopeIds: null };
const baseQuery = { range: 'last30d' as const, compareWithPrevious: false as const };

const AI_CONV = { total: 10, active: 6, handoffed: 3, handoffRate: 30, completedWithoutHandoff: 1 };
const AI_LLM = {
  totalCalls: 100,
  totalTokensIn: 50000,
  totalTokensOut: 10000,
  estimatedCostUsd: 0.25,
  costAvailable: true,
  avgLatencyMs: 450,
  p90LatencyMs: 900,
  errorRate: 2.5,
};
const AI_SLA = { pendingHandoffs: 2, avgTimeToAcceptSec: 120, p90TimeToAcceptSec: 300 };
const AUDIT_VOL = { total: 500, byResourceType: [] };
const OUTBOX = {
  totalCreated: 200,
  totalProcessed: 195,
  totalPending: 3,
  totalFailed: 2,
  successRate: 97.5,
  avgProcessingLatencySec: 0.05,
};
const DLQ = { totalMoved: 5, pendingReprocess: 3, topEventNames: [] };

describe('getReportsAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFlagEnabled.mockResolvedValue({ enabled: true });
    mockGetAiConversationHealth.mockResolvedValue(AI_CONV);
    mockGetAiHandoffReasons.mockResolvedValue([]);
    mockGetAiNodeDistribution.mockResolvedValue([]);
    mockGetAiLlmMetrics.mockResolvedValue(AI_LLM);
    mockGetAiModelBreakdown.mockResolvedValue([]);
    mockGetAiHandoffSla.mockResolvedValue(AI_SLA);
  });

  it('admin: retorna scope=global e dados de IA', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getReportsAi(mockDb as any, adminActor, baseQuery);
    expect(result.range.scope).toBe('global');
    expect(result.conversations.total).toBe(10);
    expect(result.llmMetrics.costAvailable).toBe(true);
    expect(result.handoffSla.pendingHandoffs).toBe(2);
  });

  it('sem dashboard:read lanca 403', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(getReportsAi(mockDb as any, noPermActor, baseQuery)).rejects.toThrow();
  });

  it('audit:read sem dashboard:read lanca 403', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(getReportsAi(mockDb as any, auditOnlyActor, baseQuery)).rejects.toThrow();
  });

  it('flag IA desabilitada lanca 403', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(getReportsAi(mockDb as any, adminActor, baseQuery)).rejects.toThrow();
  });
});

describe('getReportsAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuditVolume.mockResolvedValue(AUDIT_VOL);
    mockGetAuditTopActions.mockResolvedValue([]);
    mockGetAuditCriticalActions.mockResolvedValue([]);
    mockGetEventOutboxHealth.mockResolvedValue(OUTBOX);
    mockGetEventDlqSnapshot.mockResolvedValue(DLQ);
  });

  it('audit:read: retorna scope=global', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await getReportsAudit(mockDb as any, auditOnlyActor, baseQuery);
    expect(result.range.scope).toBe('global');
    expect(result.auditVolume.total).toBe(500);
    expect(result.outboxHealth.successRate).toBe(97.5);
    expect(result.dlqSnapshot.totalMoved).toBe(5);
  });

  it('sem audit:read lanca 403', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(getReportsAudit(mockDb as any, noPermActor, baseQuery)).rejects.toThrow();
  });

  it('dashboard:read sem audit:read lanca 403', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(getReportsAudit(mockDb as any, dashOnlyActor, baseQuery)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Repository SQL tests --- via vi.importActual
// ---------------------------------------------------------------------------

const ORG_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
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
  const captured: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    execute: vi.fn().mockImplementation((sqlObj: DrizzleSqlObject) => {
      const query = sqlObj.toQuery({
        escapeName: (n: string) => n,
        escapeString: (s: string) => s,
        escapeParam: (_n: number) => '?',
      });
      captured.push({ sql: query.sql, params: query.params });
      return Promise.resolve({ rows: [] });
    }),
  };
  return { db, getCaptures: () => captured };
}

interface AiRepoFns {
  getAiLlmMetrics: (db: unknown, orgId: string, dr: { from: Date; to: Date }) => Promise<unknown>;
  getAiConversationHealth: (
    db: unknown,
    orgId: string,
    dr: { from: Date; to: Date },
  ) => Promise<unknown>;
  getAuditCriticalActions: (
    db: unknown,
    orgId: string,
    dr: { from: Date; to: Date },
  ) => Promise<unknown[]>;
  getEventDlqSnapshot: (
    db: unknown,
    orgId: string,
    dr: { from: Date; to: Date },
  ) => Promise<unknown>;
}

describe('repository SQL parametrizado (vi.importActual)', () => {
  let repo: AiRepoFns;
  beforeEach(async () => {
    repo = await vi.importActual('../repository.js');
  });

  it('getAiLlmMetrics: ORG_UUID em params nao no SQL', async () => {
    const { db, getCaptures } = makeCaptureDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repo.getAiLlmMetrics(db as any, ORG_UUID, repoDateRange);
    const captures = getCaptures();
    expect(captures.length).toBeGreaterThanOrEqual(1);
    for (const c of captures) {
      expect(c.sql).not.toContain(ORG_UUID);
      expect(c.params).toContain(ORG_UUID);
    }
  });

  it('getAiConversationHealth: sem city_id, org em params', async () => {
    const { db, getCaptures } = makeCaptureDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repo.getAiConversationHealth(db as any, ORG_UUID, repoDateRange);
    for (const c of getCaptures()) {
      expect(c.sql).not.toContain(ORG_UUID);
      expect(c.params).toContain(ORG_UUID);
      expect(c.sql).not.toContain('city_id');
    }
  });

  it('getAuditCriticalActions: prefixos LIKE em params nao no SQL', async () => {
    const { db, getCaptures } = makeCaptureDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repo.getAuditCriticalActions(db as any, ORG_UUID, repoDateRange);
    const captures = getCaptures();
    expect(captures.length).toBeGreaterThanOrEqual(1);
    const first = captures[0]!;
    expect(first.sql).toContain('LIKE');
    expect(first.sql).not.toContain('user.%');
    const hasPrefix = first.params.some((p) => typeof p === 'string' && p.endsWith('%'));
    expect(hasPrefix).toBe(true);
  });

  it('getEventDlqSnapshot: moved_at + org parametrizados', async () => {
    const { db, getCaptures } = makeCaptureDb();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await repo.getEventDlqSnapshot(db as any, ORG_UUID, repoDateRange);
    for (const c of getCaptures()) {
      expect(c.sql).not.toContain(ORG_UUID);
      expect(c.params).toContain(ORG_UUID);
    }
  });
});
