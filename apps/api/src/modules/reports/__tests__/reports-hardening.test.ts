/* eslint-disable @typescript-eslint/no-explicit-any */
// reports/__tests__/reports-hardening.test.ts -- F23-S13
// Cobre os 3 findings acionaveis da revisao de seguranca:
//   M-01: assertion defensiva papel+escopo em resolveScopeAndValidate
//   M-02: rate-limit especifico no POST /reports/export (app HTTP isolado)
//   B-01: sanitizacao do filename no Content-Disposition

import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForbiddenError } from '../../../shared/errors.js';
import { getReportsOverview } from '../service.js';

// ============================================================
// vi.mock hoists
// ============================================================

const mockGetOverviewLeads = vi.fn().mockResolvedValue({
  total: 0,
  newInPeriod: 0,
  closedWon: 0,
  closedLost: 0,
  conversionRate: 0,
});
const mockGetOverviewSimulations = vi
  .fn()
  .mockResolvedValue({ total: 0, amountSum: 0, amountAvg: 0 });
const mockGetOverviewContracts = vi
  .fn()
  .mockResolvedValue({ active: 0, settled: 0, defaulted: 0, activePrincipalSum: 0 });
const mockGetOverviewConversations = vi.fn().mockResolvedValue({ open: 0, resolved: 0 });

vi.mock('../repository.js', () => ({
  getOverviewLeads: (...a: unknown[]) => mockGetOverviewLeads(...a),
  getOverviewSimulations: (...a: unknown[]) => mockGetOverviewSimulations(...a),
  getOverviewContracts: (...a: unknown[]) => mockGetOverviewContracts(...a),
  getOverviewConversations: (...a: unknown[]) => mockGetOverviewConversations(...a),
  getFunnelStages: vi.fn().mockResolvedValue([]),
  getAttendanceTotals: vi
    .fn()
    .mockResolvedValue({ conversationsOpened: 0, conversationsResolved: 0, messagesTotal: 0 }),
  getAttendanceByChannel: vi.fn().mockResolvedValue([]),
  getAttendanceTimings: vi.fn().mockResolvedValue({
    avgFirstResponseSec: 0,
    p90FirstResponseSec: 0,
    avgResolutionSec: 0,
    p90ResolutionSec: 0,
  }),
  getCreditAggregate: vi.fn().mockResolvedValue({
    simulations: 0,
    analyses: 0,
    analysesApproved: 0,
    analysesRefused: 0,
    analysesInProgress: 0,
    contracts: 0,
    contractsActive: 0,
    contractsSettled: 0,
    contractsDefaulted: 0,
    simulationsAmountSum: 0,
    simulationsAmountAvg: 0,
    simulationsTermAvg: 0,
    analysesApprovedAmountAvg: 0,
    contractsPrincipalSum: 0,
  }),
  getCreditByProduct: vi.fn().mockResolvedValue([]),
  getCollectionWallet: vi.fn().mockResolvedValue({
    pending: 0,
    pendingAmountSum: 0,
    overdue: 0,
    overdueAmountSum: 0,
    paid: 0,
    paidAmountSum: 0,
    renegotiated: 0,
    cancelled: 0,
    avgDaysOverdue: 0,
  }),
  getCollectionJobsStats: vi
    .fn()
    .mockResolvedValue({ scheduled: 0, sent: 0, failed: 0, paidBeforeSend: 0 }),
  getProductivityByAgent: vi.fn().mockResolvedValue([]),
  getProductivityTeamAverage: vi.fn().mockResolvedValue(null),
  getAiConversationHealth: vi
    .fn()
    .mockResolvedValue({ total: 0, resolved: 0, handedOff: 0, abandoned: 0 }),
  getAiHandoffReasons: vi.fn().mockResolvedValue([]),
  getAiNodeDistribution: vi.fn().mockResolvedValue([]),
  getAiLlmMetrics: vi.fn().mockResolvedValue({ tokensTotal: 0, costTotalUsd: 0, avgLatencyMs: 0 }),
  getAiModelBreakdown: vi.fn().mockResolvedValue([]),
  getAiHandoffSla: vi.fn().mockResolvedValue({ within5min: 0, between5and15min: 0, over15min: 0 }),
  getAuditVolume: vi.fn().mockResolvedValue({ total: 0, byDay: [] }),
  getAuditTopActions: vi.fn().mockResolvedValue([]),
  getAuditCriticalActions: vi.fn().mockResolvedValue([]),
  getEventOutboxHealth: vi.fn().mockResolvedValue({ pending: 0, failed: 0, processed: 0 }),
  getEventDlqSnapshot: vi.fn().mockResolvedValue([]),
}));

const mockAuditLog = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../lib/audit.js', () => ({ auditLog: (...a: unknown[]) => mockAuditLog(...a) }));
vi.mock('../../../modules/featureFlags/service.js', () => ({
  isFlagEnabled: vi.fn().mockResolvedValue({ enabled: true, status: 'enabled' }),
}));

// Mock authenticate e authorize para o app HTTP de teste (B-01/M-02)
// Padrao do projeto: authenticate() retorna no-op; authorize() retorna no-op.
// request.user e injetado pelo hook preHandler do buildIsolatedExportApp.
vi.mock('../../auth/middlewares/authenticate.js', () => ({
  authenticate: () => async () => {
    /* no-op: request.user injetado pelo hook do test app */
  },
}));
vi.mock('../../auth/middlewares/authorize.js', () => ({
  authorize: () => async () => {
    /* no-op: permissoes injetadas pelo request.user mockado */
  },
  // routes.ts usa authorizeAny() (semantica OR) nas rotas agregadas do dashboard —
  // sem este export o registro do plugin falha ("No authorizeAny export...").
  authorizeAny: () => async () => {
    /* no-op: permissoes injetadas pelo request.user mockado */
  },
}));

vi.mock('../../../db/client.js', () => ({
  db: { transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn({})) },
}));

vi.mock('../export/service.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    exportReport: vi.fn().mockResolvedValue({
      contentType: 'text/csv; charset=utf-8',
      filename: 'relatorio_overview_2026.csv',
      rowCount: 1,
      buffer: Buffer.from([0xef, 0xbb, 0xbf, 0x6f, 0x6b]),
    }),
  };
});

// ============================================================
// Fixtures de atores
// ============================================================

const mockDb = {
  transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn({})),
};

const adminActor = {
  userId: 'user-admin-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read', 'reports:export'],
  cityScopeIds: null as string[] | null,
};

const regionalActor = {
  userId: 'user-regional-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read', 'reports:export'],
  cityScopeIds: ['city-1'] as string[] | null,
};

const agentActor = {
  userId: 'user-agent-1',
  organizationId: 'org-1',
  permissions: ['dashboard:read_by_agent', 'reports:export'],
  cityScopeIds: ['city-1'] as string[] | null,
};

// Estado inconsistente (M-01): global-scope (null) sem nenhuma permissao de dashboard
const inconsistentGlobalActor = {
  userId: 'user-inconsistent-1',
  organizationId: 'org-1',
  permissions: ['reports:export'],
  cityScopeIds: null as string[] | null,
};

const baseQuery = { range: 'last30d' as const, compareWithPrevious: false as const };

// ============================================================
// M-01: assertion defensiva em resolveScopeAndValidate
// ============================================================

describe('M-01 -- assertion defensiva papel+escopo (resolveScopeAndValidate)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('admin global (cityScopeIds=null + dashboard:read): retorna scope=global', async () => {
    await expect(getReportsOverview(mockDb as any, adminActor, baseQuery)).resolves.toMatchObject({
      range: expect.objectContaining({ scope: 'global' }),
    });
  });

  it('gestor_regional (cityScopeIds=[city-1] + dashboard:read): retorna scope=city', async () => {
    await expect(
      getReportsOverview(mockDb as any, regionalActor, baseQuery),
    ).resolves.toMatchObject({ range: expect.objectContaining({ scope: 'city' }) });
  });

  it('agente (cityScopeIds=[city-1] + dashboard:read_by_agent): retorna scope=self', async () => {
    await expect(getReportsOverview(mockDb as any, agentActor, baseQuery)).resolves.toMatchObject({
      range: expect.objectContaining({ scope: 'self' }),
    });
  });

  it('M-01: estado inconsistente (cityScopeIds=null sem dashboard:read) lanca ForbiddenError', async () => {
    await expect(
      getReportsOverview(mockDb as any, inconsistentGlobalActor, baseQuery),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ============================================================
// M-02: rate-limit no POST /api/reports/export
// App HTTP isolado. Global max=200, per-route max=15.
// Enviamos 16 requests -- a 16a retorna 429.
// ============================================================

async function buildIsolatedExportApp() {
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Rate-limit global necessario para config.rateLimit por-rota funcionar.
  // Global max=200 -- acima do per-route max=15 -- per-route sera o limite efetivo.
  await app.register(rateLimit, { max: 200, timeWindow: '1 minute' });

  // Mock de authenticate: injeta user no request
  app.addHook('preHandler', async (request) => {
    (request as { user?: unknown }).user = {
      id: 'user-admin-1',
      organizationId: 'org-1',
      permissions: ['dashboard:read', 'reports:export'],
      cityScopeIds: null,
      role: 'admin',
    };
  });

  const { reportsRoutes } = await import('../routes.js');
  await app.register(reportsRoutes);
  await app.ready();
  return app;
}

describe('M-02 -- rate-limit no POST /api/reports/export (per-route max=15)', () => {
  it('429 apos 15 requisicoes (a 16a retorna 429)', { timeout: 30_000 }, async () => {
    const app = await buildIsolatedExportApp();

    const payload = JSON.stringify({
      section: 'overview',
      format: 'csv',
      filters: { range: 'last30d', compareWithPrevious: false },
    });

    let lastStatus = 0;
    for (let i = 0; i < 16; i++) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/reports/export',
        headers: { 'Content-Type': 'application/json' },
        payload,
      });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
    await app.close();
  });
});

// ============================================================
// B-01: sanitizacao do filename no Content-Disposition
// ============================================================

describe('B-01 -- sanitizacao do filename no Content-Disposition', () => {
  it('filename padrao (seguro) nao e alterado', async () => {
    const mod = await import('../export/service.js');
    (mod.exportReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      contentType: 'text/csv; charset=utf-8',
      filename: 'relatorio_overview_2026-06-24.csv',
      rowCount: 1,
      buffer: Buffer.from([0xef, 0xbb, 0xbf]),
    });

    const app = await buildIsolatedExportApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/export',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        section: 'overview',
        format: 'csv',
        filters: { range: 'last30d', compareWithPrevious: false },
      }),
    });

    expect(response.statusCode).toBe(200);
    const disposition = response.headers['content-disposition'] as string;
    expect(disposition).toContain('relatorio_overview_2026-06-24.csv');
    expect(disposition.includes('/')).toBe(false);
    await app.close();
  });

  it('filename com path traversal (../../etc/passwd.csv) e sanitizado', async () => {
    const mod = await import('../export/service.js');
    (mod.exportReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      contentType: 'text/csv; charset=utf-8',
      filename: '../../etc/passwd.csv',
      rowCount: 1,
      buffer: Buffer.from([0xef, 0xbb, 0xbf]),
    });

    const app = await buildIsolatedExportApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/export',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        section: 'overview',
        format: 'csv',
        filters: { range: 'last30d', compareWithPrevious: false },
      }),
    });

    expect(response.statusCode).toBe(200);
    const disposition = response.headers['content-disposition'] as string;
    // Sem barras (path traversal eliminado)
    expect(disposition.includes('/')).toBe(false);
    // Sem .. duplo consecutivo
    expect(disposition.includes('..')).toBe(false);
    await app.close();
  });

  it('filename com espacos e substituido por underscore', async () => {
    const mod = await import('../export/service.js');
    (mod.exportReport as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      contentType: 'text/csv; charset=utf-8',
      filename: 'relatorio com espacos.csv',
      rowCount: 1,
      buffer: Buffer.from([0xef, 0xbb, 0xbf]),
    });

    const app = await buildIsolatedExportApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/reports/export',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify({
        section: 'overview',
        format: 'csv',
        filters: { range: 'last30d', compareWithPrevious: false },
      }),
    });

    expect(response.statusCode).toBe(200);
    const disposition = response.headers['content-disposition'] as string;
    const match = /filename="([^"]*)"/.exec(disposition);
    expect(match).not.toBeNull();
    const sanitized = match?.[1] ?? '';
    expect(sanitized.includes(' ')).toBe(false);
    await app.close();
  });
});
