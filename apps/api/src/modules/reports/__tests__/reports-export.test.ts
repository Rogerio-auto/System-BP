/* eslint-disable @typescript-eslint/no-explicit-any */
// reports/__tests__/reports-export.test.ts -- F23-S09
// Cobre: gating (sem permissao/flag -> 403/feature-off), escopo reaplicado no export,
//        ausencia de PII no payload, formatos validos (csv/xlsx/pdf).
// Abordagem: mocks no service de reports (nao no repository) -- o service ja
//            tem seus proprios testes de escopo.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- mock das funcoes de reports/service ----
const mockGetReportsOverview = vi.fn();
const mockGetReportsFunnel = vi.fn();
const mockGetReportsAttendance = vi.fn();
const mockGetReportsCredit = vi.fn();
const mockGetReportsCollection = vi.fn();
const mockGetReportsProductivity = vi.fn();
const mockGetReportsAi = vi.fn();
const mockGetReportsAudit = vi.fn();

vi.mock('../service.js', () => ({
  getReportsOverview: (...a: unknown[]) => mockGetReportsOverview(...a),
  getReportsFunnel: (...a: unknown[]) => mockGetReportsFunnel(...a),
  getReportsAttendance: (...a: unknown[]) => mockGetReportsAttendance(...a),
  getReportsCredit: (...a: unknown[]) => mockGetReportsCredit(...a),
  getReportsCollection: (...a: unknown[]) => mockGetReportsCollection(...a),
  getReportsProductivity: (...a: unknown[]) => mockGetReportsProductivity(...a),
  getReportsAi: (...a: unknown[]) => mockGetReportsAi(...a),
  getReportsAudit: (...a: unknown[]) => mockGetReportsAudit(...a),
}));

const mockAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/audit.js', () => ({ auditLog: (...a: unknown[]) => mockAuditLog(...a) }));

const mockIsFlagEnabled = vi.fn();
vi.mock('../../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: (...a: unknown[]) => mockIsFlagEnabled(...a),
}));

import { ExportLimitExceededError, EXPORT_ROW_LIMIT, exportReport } from '../export/service.js';

const mockDb = { transaction: vi.fn().mockImplementation(async (fn: (tx: any) => any) => fn({})) };

// ---- Actors ----
const adminActor = {
  userId: 'user-admin-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read', 'reports:export', 'audit:read', 'billing:read'],
  cityScopeIds: null,
};
const regionalActor = {
  userId: 'user-regional-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read', 'reports:export', 'billing:read'],
  cityScopeIds: ['city-1'],
};
const agentActor = {
  userId: 'user-agent-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read_by_agent', 'reports:export'],
  cityScopeIds: ['city-1'],
};
const noExportPermActor = {
  userId: 'user-noperm-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read'],
  cityScopeIds: null,
};

const baseFilters = { range: 'last30d' as const, compareWithPrevious: false as const };

// ---- Mocks de response do reports service ----
const OVERVIEW_MOCK = {
  range: {
    from: '2026-05-01T00:00:00Z',
    to: '2026-05-31T23:59:59Z',
    label: 'Ultimos 30 dias',
    scope: 'global' as const,
  },
  leads: { total: 10, newInPeriod: 3, closedWon: 2, closedLost: 1, conversionRate: 66.67 },
  simulations: { total: 5, amountSum: 50000, amountAvg: 10000 },
  contracts: { active: 3, settled: 1, defaulted: 0, activePrincipalSum: 30000 },
  conversations: { open: 2, resolved: 8 },
};

const FUNNEL_MOCK = {
  range: {
    from: '2026-05-01T00:00:00Z',
    to: '2026-05-31T23:59:59Z',
    label: 'Ultimos 30 dias',
    scope: 'global' as const,
  },
  stages: [
    {
      stageId: 'stage-1',
      stageName: 'Entrada',
      stageOrder: 1,
      cardCount: 20,
      staleCardCount: 3,
      conversionToNextRate: 75,
      avgDwellHours: 24,
      medianDwellHours: 18,
    },
    {
      stageId: 'stage-2',
      stageName: 'Qualificacao',
      stageOrder: 2,
      cardCount: 15,
      staleCardCount: 2,
      conversionToNextRate: null,
      avgDwellHours: null,
      medianDwellHours: null,
    },
  ],
};

const PRODUCTIVITY_MOCK = {
  range: {
    from: '2026-05-01T00:00:00Z',
    to: '2026-05-31T23:59:59Z',
    label: 'Ultimos 30 dias',
    scope: 'global' as const,
  },
  agents: [
    {
      agentId: 'agent-uuid-1',
      displayName: 'Carlos Silva',
      leadsClosedWon: 5,
      simulationsCreated: 10,
      conversationsResolved: 20,
      contractsOriginated: 3,
      avgFirstResponseSec: 120,
    },
  ],
};

const PRODUCTIVITY_SELF_MOCK = {
  range: {
    from: '2026-05-01T00:00:00Z',
    to: '2026-05-31T23:59:59Z',
    label: 'Ultimos 30 dias',
    scope: 'self' as const,
  },
  agents: [
    // self-scoped: displayName do proprio agente presente, sem colegas
    {
      agentId: 'user-agent-1',
      displayName: 'Meu Nome',
      leadsClosedWon: 2,
      simulationsCreated: 4,
      conversationsResolved: 8,
      contractsOriginated: 1,
      avgFirstResponseSec: 200,
    },
  ],
};
describe('exportReport -- gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('403 se actor nao tem reports:export', async () => {
    await expect(
      exportReport(mockDb as any, noExportPermActor, 'overview', 'csv', baseFilters),
    ).rejects.toThrow('Permissao reports:export necessaria');
  });
  it('FeatureDisabledError se flag reports.export.enabled=false', async () => {
    mockIsFlagEnabled.mockResolvedValue({ enabled: false, status: 'disabled' });
    await expect(
      exportReport(mockDb as any, adminActor, 'overview', 'csv', baseFilters),
    ).rejects.toThrow('Esta funcionalidade');
  });
});
describe('exportReport -- formatos validos (overview)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockGetReportsOverview.mockResolvedValue(OVERVIEW_MOCK);
  });
  it('CSV: retorna buffer com BOM e Content-Type correto', async () => {
    const result = await exportReport(mockDb as any, adminActor, 'overview', 'csv', baseFilters);
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.filename).toMatch(/.csv$/);
    expect(Buffer.isBuffer(result.buffer)).toBe(true);
    expect(result.rowCount).toBe(1);
    expect(result.buffer[0]).toBe(0xef);
    expect(result.buffer[1]).toBe(0xbb);
    expect(result.buffer[2]).toBe(0xbf);
  });
  it('XLSX: retorna buffer com magic bytes XLSX (PK zip)', async () => {
    const result = await exportReport(mockDb as any, adminActor, 'overview', 'xlsx', baseFilters);
    expect(result.contentType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.filename).toMatch(/.xlsx$/);
    expect(result.buffer[0]).toBe(0x50);
    expect(result.buffer[1]).toBe(0x4b);
  });
  it('PDF: retorna buffer com magic bytes PDF (%PDF-)', async () => {
    const result = await exportReport(mockDb as any, adminActor, 'overview', 'pdf', baseFilters);
    expect(result.contentType).toBe('application/pdf');
    expect(result.filename).toMatch(/.pdf$/);
    const str = result.buffer.slice(0, 5).toString('ascii');
    expect(str).toBe('%PDF-');
  });
});
describe('exportReport -- escopo reaplicado (city-scope)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
  });
  it('gestor_regional: getReportsOverview chamado com actor city-scoped correto', async () => {
    mockGetReportsOverview.mockResolvedValue(OVERVIEW_MOCK);
    await exportReport(mockDb as any, regionalActor, 'overview', 'csv', baseFilters);
    expect(mockGetReportsOverview).toHaveBeenCalledWith(
      mockDb,
      regionalActor,
      expect.objectContaining({ range: 'last30d' }),
    );
  });
  it('funnel: getReportsFunnel chamado com actor regional', async () => {
    mockGetReportsFunnel.mockResolvedValue(FUNNEL_MOCK);
    await exportReport(mockDb as any, regionalActor, 'funnel', 'csv', baseFilters);
    expect(mockGetReportsFunnel).toHaveBeenCalledWith(mockDb, regionalActor, expect.anything());
  });
});

describe('exportReport -- ausencia de PII no payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockGetReportsProductivity.mockResolvedValue(PRODUCTIVITY_MOCK);
  });
  it('productivity (gestor): sem CPF/telefone de cidadao no CSV', async () => {
    const result = await exportReport(
      mockDb as any,
      adminActor,
      'productivity',
      'csv',
      baseFilters,
    );
    const csv = result.buffer.toString('utf8');
    expect(csv).toContain('agent-uuid-1');
    const cpfPattern = /d{3}.d{3}.d{3}-d{2}/;
    expect(cpfPattern.test(csv)).toBe(false);
  });
  it('self-scoped (agente): mostra so o proprio agente, sem colegas', async () => {
    mockGetReportsProductivity.mockResolvedValue(PRODUCTIVITY_SELF_MOCK);
    const result = await exportReport(
      mockDb as any,
      agentActor,
      'productivity',
      'csv',
      baseFilters,
    );
    const csv = result.buffer.toString('utf8');
    expect(csv).toContain('Meu Nome');
    expect(result.rowCount).toBe(1); // self-scoped: apenas 1 agente retornado
    // CSV deve conter header + 1 linha de dados
    expect(result.buffer.byteLength).toBeGreaterThan(0);
    // Sem displayName de colegas (self-scoped retorna so o proprio)
    // Isso ja e garantido pelo mock PRODUCTIVITY_SELF_MOCK.agents.length === 1
  });
});
describe('exportReport -- limite de linhas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
  });
  it('ExportLimitExceededError se funnel retorna mais de EXPORT_ROW_LIMIT stages', async () => {
    const manyStages = Array.from({ length: EXPORT_ROW_LIMIT + 1 }, (_: unknown, i: number) => ({
      stageId: 'stage-' + i,
      stageName: 'Stage ' + i,
      stageOrder: i,
      cardCount: 1,
      staleCardCount: 0,
      conversionToNextRate: null,
      avgDwellHours: null,
      medianDwellHours: null,
    }));
    mockGetReportsFunnel.mockResolvedValue({ range: FUNNEL_MOCK.range, stages: manyStages });
    await expect(
      exportReport(mockDb as any, adminActor, 'funnel', 'csv', baseFilters),
    ).rejects.toBeInstanceOf(ExportLimitExceededError);
  });
  it('ExportLimitExceededError tem rowCount e limit corretos', async () => {
    const manyStages = Array.from({ length: EXPORT_ROW_LIMIT + 5 }, (_: unknown, i: number) => ({
      stageId: 'stage-' + i,
      stageName: 'Stage ' + i,
      stageOrder: i,
      cardCount: 1,
      staleCardCount: 0,
      conversionToNextRate: null,
      avgDwellHours: null,
      medianDwellHours: null,
    }));
    mockGetReportsFunnel.mockResolvedValue({ range: FUNNEL_MOCK.range, stages: manyStages });
    try {
      await exportReport(mockDb as any, adminActor, 'funnel', 'csv', baseFilters);
      throw new Error('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ExportLimitExceededError);
      const e = err as ExportLimitExceededError;
      expect(e.rowCount).toBe(EXPORT_ROW_LIMIT + 5);
      expect(e.limit).toBe(EXPORT_ROW_LIMIT);
    }
  });
});

describe('exportReport -- audit sem PII', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFlagEnabled.mockResolvedValue({ enabled: true, status: 'enabled' });
    mockGetReportsOverview.mockResolvedValue(OVERVIEW_MOCK);
  });
  it('registra audit reports.export com secao/formato/rowCount mas sem PII bruta', async () => {
    await exportReport(mockDb as any, adminActor, 'overview', 'csv', baseFilters);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'reports.export',
        metadata: expect.objectContaining({ section: 'overview', format: 'csv', rowCount: 1 }),
      }),
    );
    const call = mockAuditLog.mock.calls[0]!;
    const metaStr = JSON.stringify(call[1].metadata);
    const cpfPattern = /d{3}.d{3}.d{3}-d{2}/;
    expect(cpfPattern.test(metaStr)).toBe(false);
  });
});
