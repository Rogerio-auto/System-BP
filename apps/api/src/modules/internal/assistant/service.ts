// internal/assistant/service.ts -- F6-S06
import { sql } from 'drizzle-orm';

import type { Database } from '../../../db/client.js';
import { AppError, ForbiddenError, NotFoundError } from '../../../shared/errors.js';
import type { UserScopeCtx } from '../../../shared/scope.js';
import { findAnalysesByLeadId } from '../../credit-analyses/repository.js';
import { findCityNamesByIds, findLeadById, findLeads } from '../../leads/repository.js';
import {
  getCollectionWallet,
  getFunnelStages,
  getOverviewLeads,
} from '../../reports/repository.js';

import { findLeadConversationMessages } from './repository.js';
import { MessageDirectionSchema } from './schemas.js';
import type {
  AnalysisStatusResponse,
  BillingUpcomingResponse,
  FunnelMetricsResponse,
  LeadConversationResponse,
  LeadCountResponse,
  LeadSearchResponse,
  Principal,
} from './schemas.js';

/** Limite de candidatos retornados pela busca por nome — evita despejo de PII. */
export const LEAD_SEARCH_CANDIDATE_LIMIT = 8;

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
    // MEDIUM-2 fix: ausência/invalidade de datas é erro de input (400), não falta de permissão (403).
    if (!q.dateFrom || !q.dateTo)
      throw new AppError(400, 'VALIDATION_ERROR', 'dateFrom/dateTo requeridos para range custom');
    const from = new Date(q.dateFrom);
    const to = new Date(q.dateTo);
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || from > to)
      throw new AppError(400, 'VALIDATION_ERROR', 'dateFrom/dateTo invalidos ou ordem incorreta');
    return { from, to, label: 'Periodo customizado' };
  }
  // Código morto (range é enum Zod), mas corrigido por consistência (MEDIUM-2).
  throw new AppError(400, 'VALIDATION_ERROR', 'range invalido: ' + q.range);
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
  query?: { cityIds?: string[] | undefined },
): Promise<BillingUpcomingResponse> {
  assertPermission(principal, 'billing:read');
  const scopeCtx = principalToScopeCtx(principal);
  // MEDIUM-1 fix: a carteira de cobrança (mv_reports_collection) é um SNAPSHOT de estado
  // atual — não tem dimensão temporal. Não aplicamos range aqui: relatar números all-time
  // sob um label de período ("últimos 7 dias") induziria o copiloto ao erro. O único filtro
  // honesto suportado pela fonte é o de cidade (opcional), que repassamos abaixo.
  const wallet = await getCollectionWallet(db, principal.organization_id, scopeCtx, query?.cityIds);
  return {
    source: 'assistant.billing-upcoming',
    totalDues: wallet.pending + wallet.overdue,
    overdueCount: wallet.overdue,
    upcomingCount: wallet.pending,
    totalAmountBrl: wallet.pendingAmountSum + wallet.overdueAmountSum,
    snapshotLabel: 'Carteira atual',
  };
}

/**
 * Retorna as mensagens da conversa de um lead, para o copiloto resumir (F6-S14).
 *
 * LGPD (§12.5): `content` é PII bruta — nunca logada aqui (pino.redact cobre
 * `*.content` globalmente). A DLP do gateway LangGraph redige o texto antes
 * do LLM; este endpoint apenas entrega o histórico.
 *
 * Segurança (doc 10 §3.5, oracle-of-existence): a existência do lead é
 * validada via findLeadById ANTES de buscar mensagens — lead fora do
 * escopo/org da organização → 404 (nunca 403, para não vazar a existência do
 * recurso em outra cidade/org). Lead no escopo mas sem conversas → 200 com
 * `messages: []` (caso válido, não é erro).
 */
export async function getLeadConversation(
  db: Database,
  principal: Principal,
  leadId: string,
): Promise<LeadConversationResponse> {
  assertPermission(principal, 'livechat:conversation:read');
  const scopeCtx = principalToScopeCtx(principal);

  const lead = await findLeadById(db, leadId, principal.organization_id, scopeCtx.cityScopeIds);
  if (lead === null) throw new NotFoundError('Lead nao encontrado');

  const { messages, truncated } = await findLeadConversationMessages(
    db,
    leadId,
    principal.organization_id,
    scopeCtx,
  );

  // direction vem do DB como `text` (CHECK garante 'in'|'out'); narrado via
  // Zod para não usar `as` — mesmo idioma de ChannelProviderSchema.parse().
  const toDto = (m: (typeof messages)[number]): LeadConversationResponse['messages'][number] => ({
    direction: MessageDirectionSchema.parse(m.direction),
    content: m.content,
    created_at: m.createdAt.toISOString(),
  });

  return {
    source: 'assistant.lead-conversation',
    lead_id: leadId,
    messages: messages.map(toDto),
    truncated,
  };
}

/**
 * Busca leads por nome (ou parte do nome) para o copiloto resolver
 * "resuma a conversa da Maria" → lead_id, com desambiguação de homônimos
 * quando há mais de um resultado (F6-S14 decide o que fazer com os
 * candidatos: se 1, resume; se vários, pergunta qual; se nenhum, avisa).
 *
 * Reuso (docs/22-agente-interno-acoes.md §12): delega inteiramente a busca
 * (org + escopo de cidade + filtro por nome/telefone, paginação) para
 * `findLeads` (leads/repository.ts) — não reimplementa a query aqui.
 *
 * LGPD (minimização, doc 17 §8.1/§14.2):
 *   - `name` (termo de busca) É PII — nunca logado nesta função nem em
 *     routes.ts (ver comentário na rota). O parâmetro nunca é passado a
 *     `app.log`/`request.log` em nenhum ponto deste módulo.
 *   - Response devolve apenas lead_id/name/city_name — o mínimo necessário
 *     para o usuário desambiguar homônimos. Nunca telefone/CPF/e-mail
 *     (findLeads() já não seleciona esses campos; cpf_encrypted/cpf_hash
 *     nunca fazem parte do SELECT de leads).
 *   - `city_name` é resolvido via findCityNamesByIds (join leve, só os IDs
 *     presentes nos candidatos já retornados dentro do escopo do principal —
 *     não há como vazar cidade fora do escopo, pois os candidatos em si já
 *     vêm filtrados por cityScopeIds).
 *
 * Volume: busca `LEAD_SEARCH_CANDIDATE_LIMIT + 1` para detectar corte sem
 * uma query de COUNT adicional (mesmo padrão de findLeadConversationMessages).
 * Candidatos são ordenados por nome (apresentação) para facilitar a leitura
 * de uma lista de homônimos — a query em si não é reordenada.
 */
export async function searchLeadsByName(
  db: Database,
  principal: Principal,
  name: string,
): Promise<LeadSearchResponse> {
  assertPermission(principal, 'leads:read');
  const scopeCtx = principalToScopeCtx(principal);

  const result = await findLeads(db, principal.organization_id, scopeCtx.cityScopeIds, {
    page: 1,
    limit: LEAD_SEARCH_CANDIDATE_LIMIT + 1,
    search: name,
  });

  const truncated = result.data.length > LEAD_SEARCH_CANDIDATE_LIMIT;
  const page = truncated ? result.data.slice(0, LEAD_SEARCH_CANDIDATE_LIMIT) : result.data;

  const cityIds = page.map((lead) => lead.cityId).filter((id): id is string => id !== null);
  const cityNames = await findCityNamesByIds(db, cityIds);

  const candidates = page
    .map((lead) => ({
      lead_id: lead.id,
      name: lead.name,
      city_name: lead.cityId !== null ? (cityNames.get(lead.cityId) ?? null) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    source: 'assistant.lead-search',
    candidates,
    truncated,
  };
}
