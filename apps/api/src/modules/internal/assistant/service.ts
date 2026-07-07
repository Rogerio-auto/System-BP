// internal/assistant/service.ts -- F6-S06
import { sql } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { ForbiddenError, NotFoundError } from '../../../shared/errors.js';
import type { UserScopeCtx } from '../../../shared/scope.js';
import { findAnalysesByLeadId } from '../../credit-analyses/repository.js';
import {
  getCollectionWallet,
  getFunnelStages,
  getOverviewLeads,
} from '../../reports/repository.js';

import type {
  AnalysisStatusResponse,
  BillingUpcomingResponse,
  FunnelMetricsResponse,
  LeadCountResponse,
  Principal,
} from './schemas.js';

interface DateRange {
  from: Date;
  to: Date;
  label: string;
}

function computeRange(q: {
  range: string;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}): DateRange {
  const now = new Date();
  const sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (q.range === 'today') return { from: sod, to: now, label: 'Hoje' };
  if (q.range === 'last7d')
    return { from: new Date(now.getTime() - 7 * 86400000), to: now, label: 'Ultimos 7 dias' };
  if (q.range === 'last30d')
    return { from: new Date(now.getTime() - 30 * 86400000), to: now, label: 'Ultimos 30 dias' };
  if (q.range === 'last90d')
    return { from: new Date(now.getTime() - 90 * 86400000), to: now, label: 'Ultimos 90 dias' };
  if (q.range === 'thisMonth')
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now, label: 'Este mes' };
  if (q.range === 'lastMonth')
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
      label: 'Mes anterior',
    };
  if (q.range === 'custom') {
    if (!q.dateFrom || !q.dateTo) throw new ForbiddenError('dateFrom/dateTo requeridos');
    const from = new Date(q.dateFrom);
    const to = new Date(q.dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to)
      throw new ForbiddenError('dateFrom/dateTo invalidos');
    return { from, to, label: 'Periodo customizado' };
  }
  throw new ForbiddenError('range invalido: ' + q.range);
}

function principalToScopeCtx(p: Principal): UserScopeCtx {
  return { cityScopeIds: p.city_scope_ids };
}

function assertPermission(p: Principal, required: string): void {
  if (!p.permissions.includes(required))
    throw new ForbiddenError('Permissao insuficiente. Consulte seu administrador.');
}

function assertCityInScope(scopeCtx: UserScopeCtx, cityIds?: string[] | undefined): void {
  if (!cityIds || cityIds.length === 0 || scopeCtx.cityScopeIds === null) return;
  for (const id of cityIds) {
    if (!scopeCtx.cityScopeIds.includes(id))
      throw new ForbiddenError('Permissao insuficiente. Consulte seu administrador.');
  }
}

export function maskLeadName(fullName: string | null | undefined): string | null {
  if (!fullName?.trim()) return null;
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0];
  if (!first) return null;
  const last = parts.length > 1 ? parts[parts.length - 1] : null;
  const initial = first.charAt(0).toUpperCase();
  return last ? initial + '. ' + last : initial + '.';
}

export async function getFunnelMetrics(
  db: Database,
  principal: Principal,
  query: {
    range: string;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    cityIds?: string[] | undefined;
  },
): Promise<FunnelMetricsResponse> {
  assertPermission(principal, 'dashboard:read');
  const scopeCtx = principalToScopeCtx(principal);
  assertCityInScope(scopeCtx, query.cityIds);
  const range = computeRange(query);
  const [stages, overview] = await Promise.all([
    getFunnelStages(db, principal.organization_id, scopeCtx, query.cityIds),
    getOverviewLeads(db, principal.organization_id, scopeCtx, range, null, query.cityIds),
  ]);
  return {
    source: 'assistant.funnel-metrics',
    stages: stages.map((s) => ({
      stageId: s.stageId,
      stageName: s.stageName,
      stageOrder: s.stageOrder,
      cardCount: s.cardCount,
      staleCardCount: s.staleCardCount,
      avgDwellHours: s.avgDwellHours,
    })),
    overview: {
      total: overview.total,
      newInPeriod: overview.newInPeriod,
      closedWon: overview.closedWon,
      closedLost: overview.closedLost,
      conversionRate: overview.conversionRate,
      rangeLabel: range.label,
    },
  };
}

export async function getLeadCount(
  db: Database,
  principal: Principal,
  query: {
    range: string;
    dateFrom?: string | undefined;
    dateTo?: string | undefined;
    cityIds?: string[] | undefined;
  },
): Promise<LeadCountResponse> {
  assertPermission(principal, 'leads:read');
  const scopeCtx = principalToScopeCtx(principal);
  assertCityInScope(scopeCtx, query.cityIds);
  const range = computeRange(query);
  const overview = await getOverviewLeads(
    db,
    principal.organization_id,
    scopeCtx,
    range,
    null,
    query.cityIds,
  );
  return {
    source: 'assistant.lead-count',
    total: overview.total,
    newInPeriod: overview.newInPeriod,
    conversionRate: overview.conversionRate,
    rangeLabel: range.label,
  };
}

export async function getAnalysisStatus(
  db: Database,
  principal: Principal,
  leadId: string,
): Promise<AnalysisStatusResponse> {
  assertPermission(principal, 'analyses:read');
  const scopeCtx = principalToScopeCtx(principal);
  const result = await findAnalysesByLeadId(
    db,
    leadId,
    principal.organization_id,
    scopeCtx.cityScopeIds,
    { page: 1, limit: 10 },
  );
  if (result.data.length === 0) throw new NotFoundError('Analise nao encontrada');
  const nameResult = await db.execute(
    sql`SELECT name FROM leads WHERE id = ${leadId}::uuid AND organization_id = ${principal.organization_id}::uuid LIMIT 1`,
  );
  const nameRow = (nameResult.rows as Array<{ name: string | null }>)[0];
  const leadNameMasked = maskLeadName(nameRow?.name ?? null);
  return {
    source: 'assistant.analysis-status',
    leadNameMasked,
    analyses: result.data.map((a) => ({
      id: a.id,
      status: a.status,
      approvedAmountBrl: a.approvedAmount !== null ? Number(a.approvedAmount) : null,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function getBillingUpcoming(
  db: Database,
  principal: Principal,
  query: { range: string; dateFrom?: string | undefined; dateTo?: string | undefined },
): Promise<BillingUpcomingResponse> {
  assertPermission(principal, 'billing:read');
  const scopeCtx = principalToScopeCtx(principal);
  const range = computeRange(query);
  const wallet = await getCollectionWallet(db, principal.organization_id, scopeCtx);
  return {
    source: 'assistant.billing-upcoming',
    totalDues: wallet.pending + wallet.overdue,
    overdueCount: wallet.overdue,
    upcomingCount: wallet.pending,
    totalAmountBrl: wallet.pendingAmountSum + wallet.overdueAmountSum,
    rangeLabel: range.label,
  };
}
