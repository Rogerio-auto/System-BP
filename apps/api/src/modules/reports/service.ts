// reports/service.ts (F23-S03)
import type {
  AttendanceQuery,
  AttendanceResponse,
  FunnelQuery,
  FunnelResponse,
  OverviewQuery,
  OverviewResponse,
} from '@elemento/shared-schemas';
import { ReportScopeEnum } from '@elemento/shared-schemas';

import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { ForbiddenError } from '../../shared/errors.js';
import type { UserScopeCtx } from '../../shared/scope.js';

import {
  getAttendanceByChannel,
  getAttendanceTimings,
  getAttendanceTotals,
  getFunnelStages,
  getOverviewContracts,
  getOverviewConversations,
  getOverviewLeads,
  getOverviewSimulations,
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
  section: 'overview' | 'funnel' | 'attendance',
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
