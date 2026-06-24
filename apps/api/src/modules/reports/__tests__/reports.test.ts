/* eslint-disable @typescript-eslint/no-explicit-any */
// reports/__tests__/reports.test.ts -- Testes modulo reports (F23-S03)
// RBAC, scope, self-scope, funnel conversionRate, PII check, custom range
// repository city-scope SQL parametrizado (cobertura dos bugs de IN-list)

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

// ---------------------------------------------------------------------------
// Testes de repository: SQL parametrizado + city-scope IN-list
//
// vi.mock('../repository.js') acima intercepta o módulo para os testes de service.
// Para testar o REPOSITORY REAL usamos vi.importActual — obtemos a implementação
// concreta sem o mock, e injetamos um db-stub que captura o SQL produzido pelo
// Drizzle tagged-template antes de enviá-lo ao driver.
//
// Estes testes cobrem os bugs que os service-tests (que mockam o próprio repository)
// não capturavam:
//
//   Bug 1 (CRÍTICO): toSqlIdList gerava "'uuid" (sem aspas de fechamento)
//                    → city_id IN ('uuid-a,'uuid-b) → erro de sintaxe Postgres.
//   Bug 2 (CRÍTICO): ch.kind não existe — coluna real é ch.provider.
//
// A validação verifica:
//   - O SQL gerado contém placeholders ($N) em vez de UUIDs interpolados
//   - A coluna referenciada é ch.provider (não ch.kind)
//   - Quando cityScopeIds=[] retorna vazio sem tocar o banco (short-circuit)
// ---------------------------------------------------------------------------

const CITY_UUID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CITY_UUID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ORG_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const repoDateRange = {
  from: new Date('2026-01-01T00:00:00.000Z'),
  to: new Date('2026-01-31T23:59:59.999Z'),
};

/**
 * Drizzle entrega a db.execute() uma instância SQL (não um plain object).
 * Para extrair o texto e os params, chamamos sqlObj.toQuery() com as funções
 * de escape do driver pg (escapeParam = '$N').
 */
interface DrizzleSqlObject {
  toQuery: (dialect: {
    escapeName: (n: string) => string;
    escapeString: (s: string) => string;
    escapeParam: (n: number, v: unknown) => string;
  }) => { sql: string; params: unknown[] };
}

/** Cria um db-stub que captura e desmonta o objeto SQL que o Drizzle passa a db.execute. */
function makeCaptureDb() {
  let captured: { sql: string; params: unknown[] } | null = null;

  const db = {
    execute: vi.fn().mockImplementation((sqlObj: DrizzleSqlObject) => {
      // Extraímos o SQL gerado usando o dialect do driver pg (parâmetros $1..$n)
      const query = sqlObj.toQuery({
        escapeName: (n: string) => `"${n}"`,
        escapeString: (s: string) => `'${s}'`,
        escapeParam: (n: number) => `$${n}`,
      });
      captured = { sql: query.sql, params: query.params };
      return Promise.resolve({ rows: [] });
    }),
    // Stub mínimo do select builder (usado por getOverviewLeads / getOverviewConversations)
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        innerJoin: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }),
    }),
  };

  return { db, getCapture: () => captured };
}

// Interface mínima das funções testadas no repository (evita typeof import() inline)
interface RepoFns {
  getOverviewSimulations: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    range: { from: Date; to: Date },
    filterCityIds?: string[],
  ) => Promise<{ total: number; amountSum: number; amountAvg: number }>;
  getOverviewContracts: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    range: { from: Date; to: Date },
    filterCityIds?: string[],
  ) => Promise<{ active: number; settled: number; defaulted: number; activePrincipalSum: number }>;
  getFunnelStages: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    filterCityIds?: string[],
  ) => Promise<unknown[]>;
  getAttendanceByChannel: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    range: { from: Date; to: Date },
    selfUserId: string | null,
    filterCityIds?: string[],
    filterChannel?: string,
  ) => Promise<unknown[]>;
  getAttendanceTimings: (
    db: unknown,
    orgId: string,
    scope: { cityScopeIds: string[] | null },
    range: { from: Date; to: Date },
    selfUserId: string | null,
    filterCityIds?: string[],
  ) => Promise<unknown>;
}

describe('repository — city-scope parametrizado (SQL gerado — real impl)', () => {
  // Importa o módulo real (não mockado) do repository
  let repo: RepoFns;

  beforeEach(async () => {
    // vi.importActual contorna o vi.mock acima e entrega a implementação real
    repo = await vi.importActual<RepoFns>('../repository.js');
  });

  it('getOverviewSimulations: cityScopeIds com 2 cidades usa placeholders, nao interpolacao', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getOverviewSimulations(
      db as any,
      ORG_UUID,
      { cityScopeIds: [CITY_UUID_A, CITY_UUID_B] },
      repoDateRange,
    );

    const cap = getCapture();
    expect(cap).not.toBeNull();
    // Drizzle parametriza via $1..$n — o SQL deve conter placeholder
    expect(cap!.sql).toContain('$');
    // UUIDs devem estar nos params, nunca embutidos no SQL
    expect(cap!.params).toContain(CITY_UUID_A);
    expect(cap!.params).toContain(CITY_UUID_B);
    expect(cap!.sql).not.toContain(CITY_UUID_A);
    expect(cap!.sql).not.toContain(CITY_UUID_B);
  });

  it('getOverviewSimulations: cityScopeIds=[] retorna vazio sem chamar db.execute', async () => {
    const { db } = makeCaptureDb();
    const result = await repo.getOverviewSimulations(
      db as any,
      ORG_UUID,
      { cityScopeIds: [] },
      repoDateRange,
    );
    expect(result).toEqual({ total: 0, amountSum: 0, amountAvg: 0 });
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('getOverviewContracts: filterCityIds usa placeholders, nao interpolacao', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getOverviewContracts(db as any, ORG_UUID, { cityScopeIds: null }, repoDateRange, [
      CITY_UUID_A,
    ]);

    const cap = getCapture();
    expect(cap).not.toBeNull();
    expect(cap!.params).toContain(CITY_UUID_A);
    expect(cap!.sql).not.toContain(CITY_UUID_A);
  });

  it('getFunnelStages: cityScopeIds com cidade usa placeholder (bug IN-list corrigido)', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getFunnelStages(db as any, ORG_UUID, { cityScopeIds: [CITY_UUID_A] });

    const cap = getCapture();
    expect(cap).not.toBeNull();
    expect(cap!.params).toContain(CITY_UUID_A);
    expect(cap!.sql).not.toContain(CITY_UUID_A);
    expect(cap!.sql).toContain('mv_reports_funnel');
  });

  it('getAttendanceByChannel: referencia ch.provider (nao ch.kind)', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getAttendanceByChannel(
      db as any,
      ORG_UUID,
      { cityScopeIds: [CITY_UUID_A] },
      repoDateRange,
      null,
      undefined,
      'meta_whatsapp',
    );

    const cap = getCapture();
    expect(cap).not.toBeNull();
    expect(cap!.sql).toContain('ch.provider');
    expect(cap!.sql).not.toContain('ch.kind');
    // o valor do filterChannel vai como param (parametrizado, nao interpolado)
    expect(cap!.params).toContain('meta_whatsapp');
  });

  it('getAttendanceByChannel: cityScopeIds=[] retorna [] sem chamar db', async () => {
    const { db } = makeCaptureDb();
    const result = await repo.getAttendanceByChannel(
      db as any,
      ORG_UUID,
      { cityScopeIds: [] },
      repoDateRange,
      null,
    );
    expect(result).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('getAttendanceTimings: cityScopeIds com 2 cidades parametriza corretamente', async () => {
    const { db, getCapture } = makeCaptureDb();
    await repo.getAttendanceTimings(
      db as any,
      ORG_UUID,
      { cityScopeIds: [CITY_UUID_A, CITY_UUID_B] },
      repoDateRange,
      null,
    );

    const cap = getCapture();
    expect(cap).not.toBeNull();
    expect(cap!.params).toContain(CITY_UUID_A);
    expect(cap!.params).toContain(CITY_UUID_B);
    expect(cap!.sql).not.toContain(CITY_UUID_A);
    expect(cap!.sql).not.toContain(CITY_UUID_B);
  });
});
