// reports/service.ts (F23-S03)
import type {
  AiQuery,
  AiResponse,
  AttendanceQuery,
  AttendanceResponse,
  AuditQuery,
  AuditResponse,
  CollectionQuery,
  CollectionResponse,
  CreditQuery,
  CreditResponse,
  FunnelQuery,
  FunnelResponse,
  OverviewQuery,
  OverviewResponse,
  ProductivityQuery,
  ProductivityResponse,
} from '@elemento/shared-schemas';
import { ReportScopeEnum } from '@elemento/shared-schemas';

import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { ForbiddenError } from '../../shared/errors.js';
import type { UserScopeCtx } from '../../shared/scope.js';
import { isFlagEnabled } from '../featureFlags/service.js';

import {
  getAttendanceByChannel,
  getAttendanceTimings,
  getAttendanceTotals,
  getCreditAggregate,
  getCreditByProduct,
  getCollectionJobsStats,
  getCollectionWallet,
  getProductivityByAgent,
  getProductivityTeamAverage,
  getFunnelStages,
  getOverviewContracts,
  getOverviewConversations,
  getOverviewLeads,
  getOverviewSimulations,
  getAiConversationHealth,
  getAiHandoffReasons,
  getAiNodeDistribution,
  getAiLlmMetrics,
  getAiModelBreakdown,
  getAiHandoffSla,
  getAuditVolume,
  getAuditTopActions,
  getAuditCriticalActions,
  getEventOutboxHealth,
  getEventDlqSnapshot,
} from './repository.js';

export interface ReportsActorContext {
  userId: string;
  organizationId: string;
  permissions: string[];
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}
interface RangeResult {
  from: Date;
  to: Date;
  label: string;
}
function computeRange(query: {
  range: string;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}): RangeResult {
  const now = new Date();
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (query.range === 'today') return { from: s, to: now, label: 'Hoje' };
  if (query.range === 'last7d')
    return { from: new Date(now.getTime() - 7 * 86400000), to: now, label: 'Últimos 7 dias' };
  if (query.range === 'last30d')
    return { from: new Date(now.getTime() - 30 * 86400000), to: now, label: 'Últimos 30 dias' };
  if (query.range === 'last90d')
    return { from: new Date(now.getTime() - 90 * 86400000), to: now, label: 'Últimos 90 dias' };
  if (query.range === 'thisMonth')
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now, label: 'Este mês' };
  if (query.range === 'lastMonth')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      label: 'Mês anterior',
    };
  if (query.range === 'custom') {
    if (!query.dateFrom || !query.dateTo)
      throw new ForbiddenError('dateFrom/dateTo requeridos quando range=custom');
    const from = new Date(query.dateFrom);
    const to = new Date(query.dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to)
      throw new ForbiddenError('dateFrom/dateTo inválidos');
    return { from, to, label: 'Período customizado' };
  }
  throw new ForbiddenError(`range inválido: ${query.range}`);
}

interface ScopeResult {
  selfUserId: string | null;
  scopeLabel: 'global' | 'city' | 'self';
  scopeCtx: UserScopeCtx;
}

function resolveScopeAndValidate(
  actor: ReportsActorContext,
  query: { cityIds?: string[] | undefined; agentIds?: string[] | undefined },
): ScopeResult {
  const hasDashboardRead = actor.permissions.includes('dashboard:read');
  const hasByAgent = actor.permissions.includes('dashboard:read_by_agent');
  if (!hasDashboardRead && !hasByAgent)
    throw new ForbiddenError('Permissão insuficiente para relatórios');
  const scopeCtx: UserScopeCtx = { cityScopeIds: actor.cityScopeIds };
  if (!hasDashboardRead && hasByAgent) {
    if (query.cityIds !== undefined && query.cityIds.length > 0)
      throw new ForbiddenError('Agentes não podem filtrar por cidade');
    if (query.agentIds !== undefined && query.agentIds.some((id) => id !== actor.userId))
      throw new ForbiddenError('Agentes só podem ver dados próprios');
    return { selfUserId: actor.userId, scopeLabel: 'self', scopeCtx };
  }
  if (query.cityIds !== undefined && query.cityIds.length > 0 && actor.cityScopeIds !== null) {
    for (const id of query.cityIds) {
      if (!actor.cityScopeIds.includes(id)) throw new ForbiddenError(`Cidade ${id} fora do escopo`);
    }
  }
  return {
    selfUserId: null,
    scopeLabel: actor.cityScopeIds === null ? 'global' : 'city',
    scopeCtx,
  };
}

async function writeAuditLog(
  db: Database,
  actor: ReportsActorContext,
  section:
    | 'overview'
    | 'funnel'
    | 'attendance'
    | 'credit'
    | 'collection'
    | 'productivity'
    | 'reports.ai'
    | 'reports.audit',
  filters: Record<string, unknown>,
  scopeLabel: string,
): Promise<void> {
  const auditActor: AuditActor = {
    userId: actor.userId,
    role: actor.permissions[0] ?? 'unknown',
    ...(actor.ip !== undefined ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
  };
  await db.transaction(async (tx) => {
    await auditLog(tx as Parameters<typeof auditLog>[0], {
      organizationId: actor.organizationId,
      actor: auditActor,
      action: 'reports.read',
      resource: { type: 'reports', id: actor.organizationId },
      before: null,
      after: null,
      metadata: { section, filters, scope: scopeLabel },
    });
  });
}

export async function getReportsOverview(
  db: Database,
  actor: ReportsActorContext,
  query: OverviewQuery,
): Promise<OverviewResponse> {
  const dateRange = computeRange(query);
  const { selfUserId, scopeLabel, scopeCtx } = resolveScopeAndValidate(actor, query);
  const [leads, simulations, contracts, conversations] = await Promise.all([
    getOverviewLeads(
      db,
      actor.organizationId,
      scopeCtx,
      dateRange,
      selfUserId,
      query.cityIds,
      query.agentIds,
    ),
    getOverviewSimulations(db, actor.organizationId, scopeCtx, dateRange, query.cityIds),
    getOverviewContracts(db, actor.organizationId, scopeCtx, dateRange, query.cityIds),
    getOverviewConversations(db, actor.organizationId, scopeCtx, query.cityIds),
  ]);
  void writeAuditLog(
    db,
    actor,
    'overview',
    { range: query.range, cityIds: query.cityIds ?? null, agentIds: query.agentIds ?? null },
    scopeLabel,
  ).catch(() => undefined);
  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse(scopeLabel),
    },
    leads,
    simulations,
    contracts,
    conversations,
  };
}

export async function getReportsFunnel(
  db: Database,
  actor: ReportsActorContext,
  query: FunnelQuery,
): Promise<FunnelResponse> {
  const dateRange = computeRange(query);
  const { scopeLabel, scopeCtx } = resolveScopeAndValidate(actor, query);
  const stages = await getFunnelStages(db, actor.organizationId, scopeCtx, query.cityIds);
  const stagesWithConversion = stages.map((stage, idx) => {
    const next = stages[idx + 1];
    const conversionToNextRate =
      next !== undefined && stage.cardCount > 0
        ? Math.round((next.cardCount / stage.cardCount) * 10000) / 100
        : null;
    return { ...stage, conversionToNextRate };
  });
  void writeAuditLog(
    db,
    actor,
    'funnel',
    { range: query.range, cityIds: query.cityIds ?? null },
    scopeLabel,
  ).catch(() => undefined);
  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse(scopeLabel),
    },
    stages: stagesWithConversion,
  };
}

export async function getReportsAttendance(
  db: Database,
  actor: ReportsActorContext,
  query: AttendanceQuery,
): Promise<AttendanceResponse> {
  const dateRange = computeRange(query);
  const { selfUserId, scopeLabel, scopeCtx } = resolveScopeAndValidate(actor, query);
  const [totals, byChannel, timings] = await Promise.all([
    getAttendanceTotals(db, actor.organizationId, scopeCtx, dateRange, selfUserId, query.cityIds),
    getAttendanceByChannel(
      db,
      actor.organizationId,
      scopeCtx,
      dateRange,
      selfUserId,
      query.cityIds,
      query.channel,
    ),
    getAttendanceTimings(db, actor.organizationId, scopeCtx, dateRange, selfUserId, query.cityIds),
  ]);
  void writeAuditLog(
    db,
    actor,
    'attendance',
    { range: query.range, cityIds: query.cityIds ?? null, channel: query.channel ?? null },
    scopeLabel,
  ).catch(() => undefined);
  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse(scopeLabel),
    },
    totals: {
      conversationsOpened: totals.conversationsOpened,
      conversationsResolved: totals.conversationsResolved,
      messagesTotal: totals.messagesTotal,
    },
    byChannel,
    timings,
  };
}

export async function getReportsCredit(
  db: Database,
  actor: ReportsActorContext,
  query: CreditQuery,
): Promise<CreditResponse> {
  const dateRange = computeRange(query);
  const { scopeLabel, scopeCtx } = resolveScopeAndValidate(actor, query);
  const [agg, byProduct] = await Promise.all([
    getCreditAggregate(db, actor.organizationId, scopeCtx, query.cityIds, query.productIds),
    getCreditByProduct(db, actor.organizationId, scopeCtx, query.cityIds, query.productIds),
  ]);
  // Funnel rates - default to 0 (not null) to match Zod schema nonnegative()
  const simToAnalysisRate =
    agg.simulations > 0 ? Math.round((agg.analyses / agg.simulations) * 10000) / 100 : 0;
  const approvalRate =
    agg.analyses > 0 ? Math.round((agg.analysesApproved / agg.analyses) * 10000) / 100 : 0;
  const simToContractRate =
    agg.simulations > 0 ? Math.round((agg.contracts / agg.simulations) * 10000) / 100 : 0;
  const defaultRate =
    agg.contracts > 0 ? Math.round((agg.contractsDefaulted / agg.contracts) * 10000) / 100 : 0;
  void writeAuditLog(
    db,
    actor,
    'credit',
    { range: query.range, cityIds: query.cityIds ?? null, productIds: query.productIds ?? null },
    scopeLabel,
  ).catch(() => undefined);
  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse(scopeLabel),
    },
    funnel: {
      simulations: agg.simulations,
      analyses: agg.analyses,
      analysesApproved: agg.analysesApproved,
      analysesRefused: agg.analysesRefused,
      analysesInProgress: agg.analysesInProgress,
      contracts: agg.contracts,
      simToAnalysisRate,
      approvalRate,
      simToContractRate,
    },
    amounts: {
      simulationsAmountSum: agg.simulationsAmountSum,
      simulationsAmountAvg: agg.simulationsAmountAvg,
      simulationsTermAvg: agg.simulationsTermAvg,
      analysesApprovedAmountAvg: agg.analysesApprovedAmountAvg,
      contractsPrincipalSum: agg.contractsPrincipalSum,
    },
    contractsByStatus: {
      active: agg.contractsActive,
      settled: agg.contractsSettled,
      defaulted: agg.contractsDefaulted,
      defaultRate,
    },
    byProduct,
  };
}

export async function getReportsCollection(
  db: Database,
  actor: ReportsActorContext,
  query: CollectionQuery,
): Promise<CollectionResponse> {
  const hasBillingRead = actor.permissions.includes('billing:read');
  if (!hasBillingRead) throw new ForbiddenError('Permissão billing:read necessária');
  const dateRange = computeRange(query);
  // billing:read is always city-scoped or global - no self-scope for collection
  const scopeCtx = { cityScopeIds: actor.cityScopeIds };
  const [wallet, jobs] = await Promise.all([
    getCollectionWallet(db, actor.organizationId, scopeCtx, query.cityIds),
    getCollectionJobsStats(db, actor.organizationId, dateRange),
  ]);
  const totalActive = wallet.pending + wallet.overdue;
  const adimplenciaRate =
    totalActive > 0 ? Math.round((wallet.pending / totalActive) * 10000) / 100 : 0;
  const inadimplenciaRate =
    totalActive > 0 ? Math.round((wallet.overdue / totalActive) * 10000) / 100 : 0;
  const jobsSentTotal = jobs.sent + jobs.failed;
  const sendRate = jobsSentTotal > 0 ? Math.round((jobs.sent / jobsSentTotal) * 10000) / 100 : 0;
  const failRate = jobsSentTotal > 0 ? Math.round((jobs.failed / jobsSentTotal) * 10000) / 100 : 0;
  void writeAuditLog(
    db,
    actor,
    'collection',
    { range: query.range, cityIds: query.cityIds ?? null },
    actor.cityScopeIds === null ? 'global' : 'city',
  ).catch(() => undefined);
  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse(actor.cityScopeIds === null ? 'global' : 'city'),
    },
    wallet: {
      pending: wallet.pending,
      pendingAmountSum: wallet.pendingAmountSum,
      overdue: wallet.overdue,
      overdueAmountSum: wallet.overdueAmountSum,
      paid: wallet.paid,
      paidAmountSum: wallet.paidAmountSum,
      renegotiated: wallet.renegotiated,
      cancelled: wallet.cancelled,
    },
    rates: {
      adimplenciaRate,
      inadimplenciaRate,
      avgDaysOverdue: wallet.avgDaysOverdue,
    },
    jobsEfficiency: {
      scheduled: jobs.scheduled,
      sent: jobs.sent,
      failed: jobs.failed,
      paidBeforeSend: jobs.paidBeforeSend,
      sendRate,
      failRate,
    },
  };
}

export async function getReportsProductivity(
  db: Database,
  actor: ReportsActorContext,
  query: ProductivityQuery,
): Promise<ProductivityResponse> {
  const dateRange = computeRange(query);
  const hasDashboardRead = actor.permissions.includes('dashboard:read');
  const hasByAgent = actor.permissions.includes('dashboard:read_by_agent');
  if (!hasDashboardRead && !hasByAgent)
    throw new ForbiddenError('Permissão insuficiente para relatórios de produtividade');
  const scopeCtx = { cityScopeIds: actor.cityScopeIds };
  // D3: self-scoped agent sees only own row + anonymous team average
  const isSelfScoped = !hasDashboardRead && hasByAgent;
  const selfUserId = isSelfScoped ? actor.userId : null;
  const includeDisplayName = hasDashboardRead; // managers see names; agents do not
  const scopeLabel = isSelfScoped ? 'self' : actor.cityScopeIds === null ? 'global' : 'city';
  const agents = await getProductivityByAgent(
    db,
    actor.organizationId,
    scopeCtx,
    dateRange,
    selfUserId,
    includeDisplayName,
    query.cityIds,
  );
  // D3: only return teamAverage when self-scoped
  let teamAverage: ProductivityResponse['teamAverage'] = undefined;
  if (isSelfScoped) {
    teamAverage = await getProductivityTeamAverage(
      db,
      actor.organizationId,
      scopeCtx,
      dateRange,
      actor.userId,
      query.cityIds,
    );
  }
  void writeAuditLog(
    db,
    actor,
    'productivity',
    { range: query.range, cityIds: query.cityIds ?? null, selfScoped: isSelfScoped },
    scopeLabel,
  ).catch(() => undefined);
  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse(scopeLabel),
    },
    agents,
    teamAverage,
  };
}

// =============================================================================
// F23-S05 --- AI / Pre-attendance + Audit & Operations
// =============================================================================

const AI_GATE_FLAG_KEY = 'ai.livechat_agent.enabled' as const;

export async function getReportsAi(
  db: Database,
  actor: ReportsActorContext,
  query: AiQuery,
): Promise<AiResponse> {
  if (!actor.permissions.includes('dashboard:read'))
    throw new ForbiddenError('Permissao insuficiente para relatorios de IA');

  const { enabled: aiEnabled } = await isFlagEnabled(db, AI_GATE_FLAG_KEY);
  if (!aiEnabled) throw new ForbiddenError('Modulo de IA nao habilitado');

  const dateRange = computeRange(query);
  const { organizationId } = actor;

  const [conversations, handoffReasons, nodeDistribution, llmMetrics, modelBreakdown, handoffSla] =
    await Promise.all([
      getAiConversationHealth(db, organizationId, dateRange),
      getAiHandoffReasons(db, organizationId, dateRange),
      getAiNodeDistribution(db, organizationId, dateRange),
      getAiLlmMetrics(db, organizationId, dateRange),
      getAiModelBreakdown(db, organizationId, dateRange),
      getAiHandoffSla(db, organizationId, dateRange),
    ]);

  void writeAuditLog(
    db,
    actor,
    'reports.ai',
    { range: query.range, organizationId },
    'global',
  ).catch(() => undefined);

  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse('global'),
    },
    conversations,
    handoffReasons,
    nodeDistribution,
    llmMetrics,
    modelBreakdown,
    handoffSla,
  };
}

export async function getReportsAudit(
  db: Database,
  actor: ReportsActorContext,
  query: AuditQuery,
): Promise<AuditResponse> {
  if (!actor.permissions.includes('audit:read'))
    throw new ForbiddenError('Permissao insuficiente para relatorios de auditoria');

  const dateRange = computeRange(query);
  const { organizationId } = actor;

  const [auditVolume, topActions, criticalActions, outboxHealth, dlqSnapshot] = await Promise.all([
    getAuditVolume(db, organizationId, dateRange),
    getAuditTopActions(db, organizationId, dateRange),
    getAuditCriticalActions(db, organizationId, dateRange),
    getEventOutboxHealth(db, organizationId, dateRange),
    getEventDlqSnapshot(db, organizationId, dateRange),
  ]);

  void writeAuditLog(
    db,
    actor,
    'reports.audit',
    { range: query.range, organizationId },
    'global',
  ).catch(() => undefined);

  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
      scope: ReportScopeEnum.parse('global'),
    },
    auditVolume,
    topActions,
    criticalActions,
    outboxHealth,
    dlqSnapshot,
  };
}
