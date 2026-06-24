// =============================================================================
// reports/export/service.ts -- Logica de exportacao server-side (F23-S09).
//
// SEGURANCA (reaplicada no backend -- nunca confiar no front):
//   1. Permissao reports:export verificada no service (nao so na rota).
//   2. Flag reports.export.enabled verificada antes de qualquer processamento.
//   3. Reutiliza getReports* do service -- reaplica RBAC+city-scope+self-scope.
//   4. Filtros validados via Zod (ExportRequestSchema) antes de chegar aqui.
//   5. Secao collection exige billing:read adicional (via getReportsCollection).
//   6. Secao ai exige escopo global + flag IA (via getReportsAi).
//   7. Secao audit exige audit:read (via getReportsAudit).
//
// LGPD (doc 17 sec 3.3 finalidade 8):
//   - Apenas agregados exportados -- nenhum CPF/telefone/nome de cidadao.
//   - Audit reports.export registra formato/secao/filtros/rowCount sem PII.
//
// Limite sincrono: EXPORT_ROW_LIMIT (500). Acima -> ExportLimitExceededError.
// =============================================================================
import type { ExportFilters, ExportFormat, ReportSection } from '@elemento/shared-schemas';

import type { Database } from '../../../db/client.js';
import { auditLog } from '../../../lib/audit.js';
import type { AuditActor } from '../../../lib/audit.js';
import { FeatureDisabledError, ForbiddenError } from '../../../shared/errors.js';
import { isFlagEnabled } from '../../featureFlags/service.js';
import type { ReportsActorContext } from '../service.js';
import {
  getReportsAi,
  getReportsAttendance,
  getReportsAudit,
  getReportsCollection,
  getReportsCredit,
  getReportsFunnel,
  getReportsOverview,
  getReportsProductivity,
} from '../service.js';

import { serializeToCsv } from './csv.js';
import { serializeToPdf } from './pdf.js';
import { serializeToXlsx } from './xlsx.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

export const EXPORT_FLAG_KEY = 'reports.export.enabled' as const;
export const EXPORT_ROW_LIMIT = 500;
// ---------------------------------------------------------------------------
// Helpers de flattening -- converte response de cada secao em rows tabulares.
// LGPD: nenhum campo de PII incluido nos rows.
// ---------------------------------------------------------------------------

function flattenOverview(
  data: Awaited<ReturnType<typeof getReportsOverview>>,
): Record<string, unknown>[] {
  return [
    {
      'Periodo (de)': data.range.from,
      'Periodo (ate)': data.range.to,
      Escopo: data.range.scope,
      'Leads (total)': data.leads.total,
      'Leads novos': data.leads.newInPeriod,
      'Leads fechados (ganhos)': data.leads.closedWon,
      'Leads fechados (perdidos)': data.leads.closedLost,
      'Taxa de conversao (%)': data.leads.conversionRate,
      'Simulacoes (total)': data.simulations.total,
      'Simulacoes (valor total R$)': data.simulations.amountSum,
      'Simulacoes (valor medio R$)': data.simulations.amountAvg,
      'Contratos ativos': data.contracts.active,
      'Contratos quitados': data.contracts.settled,
      'Contratos em default': data.contracts.defaulted,
      'Carteira ativa (R$)': data.contracts.activePrincipalSum,
      'Conversas abertas': data.conversations.open,
      'Conversas resolvidas': data.conversations.resolved,
    },
  ];
}

function flattenFunnel(
  data: Awaited<ReturnType<typeof getReportsFunnel>>,
): Record<string, unknown>[] {
  return data.stages.map((s) => ({
    Etapa: s.stageName,
    Ordem: s.stageOrder,
    Cards: s.cardCount,
    'Cards estagnados': s.staleCardCount,
    'Conversao para proxima (%)': s.conversionToNextRate ?? '',
    'Tempo medio na etapa (h)': s.avgDwellHours ?? '',
    'Tempo mediano na etapa (h)': s.medianDwellHours ?? '',
  }));
}

function flattenAttendance(
  data: Awaited<ReturnType<typeof getReportsAttendance>>,
): Record<string, unknown>[] {
  const summary: Record<string, unknown>[] = [
    {
      Tipo: 'Resumo',
      Canal: '',
      'Conversas abertas': data.totals.conversationsOpened,
      'Conversas resolvidas': data.totals.conversationsResolved,
      'Mensagens totais': data.totals.messagesTotal,
      '1a resposta media (s)': data.timings.firstResponseAvgSec ?? '',
      '1a resposta P90 (s)': data.timings.firstResponseP90Sec ?? '',
      'Resolucao media (s)': data.timings.resolutionAvgSec ?? '',
      'Resolucao P90 (s)': data.timings.resolutionP90Sec ?? '',
    },
  ];
  const byChannel: Record<string, unknown>[] = data.byChannel.map((c) => ({
    Tipo: 'Por canal',
    Canal: c.channel,
    'Conversas abertas': c.conversationCount,
    'Conversas resolvidas': '',
    'Mensagens totais': c.messageCount,
    '1a resposta media (s)': '',
    '1a resposta P90 (s)': '',
    'Resolucao media (s)': '',
    'Resolucao P90 (s)': '',
  }));
  return [...summary, ...byChannel];
}
function flattenCredit(
  data: Awaited<ReturnType<typeof getReportsCredit>>,
): Record<string, unknown>[] {
  const funnel: Record<string, unknown>[] = [
    {
      Secao: 'Funil',
      Produto: '',
      Simulacoes: data.funnel.simulations,
      Analises: data.funnel.analyses,
      Aprovadas: data.funnel.analysesApproved,
      Recusadas: data.funnel.analysesRefused,
      'Em andamento': data.funnel.analysesInProgress,
      Contratos: data.funnel.contracts,
      'Sim-Analise (%)': data.funnel.simToAnalysisRate,
      'Aprovacao (%)': data.funnel.approvalRate,
      'Sim-Contrato (%)': data.funnel.simToContractRate,
      'Valor total simulado (R$)': data.amounts.simulationsAmountSum,
      'Valor medio simulado (R$)': data.amounts.simulationsAmountAvg,
      'Prazo medio simulado (meses)': data.amounts.simulationsTermAvg,
      'Valor medio aprovado (R$)': data.amounts.analysesApprovedAmountAvg,
      'Carteira ativa (R$)': data.amounts.contractsPrincipalSum,
    },
  ];
  const byProduct: Record<string, unknown>[] = data.byProduct.map((p) => ({
    Secao: 'Por produto',
    Produto: p.productId ?? 'N/A',
    Simulacoes: p.simulations,
    Analises: p.analyses,
    Aprovadas: p.analysesApproved,
    Recusadas: '',
    'Em andamento': '',
    Contratos: p.contracts,
    'Sim-Analise (%)': '',
    'Aprovacao (%)': '',
    'Sim-Contrato (%)': '',
    'Valor total simulado (R$)': '',
    'Valor medio simulado (R$)': '',
    'Prazo medio simulado (meses)': '',
    'Valor medio aprovado (R$)': '',
    'Carteira ativa (R$)': p.principalSum,
  }));
  return [...funnel, ...byProduct];
}

function flattenCollection(
  data: Awaited<ReturnType<typeof getReportsCollection>>,
): Record<string, unknown>[] {
  return [
    {
      'A receber (qtd)': data.wallet.pending,
      'A receber (R$)': data.wallet.pendingAmountSum,
      'Em atraso (qtd)': data.wallet.overdue,
      'Em atraso (R$)': data.wallet.overdueAmountSum,
      'Pagos (qtd)': data.wallet.paid,
      'Pagos (R$)': data.wallet.paidAmountSum,
      'Renegociados (qtd)': data.wallet.renegotiated,
      'Cancelados (qtd)': data.wallet.cancelled,
      'Adimplencia (%)': data.rates.adimplenciaRate,
      'Inadimplencia (%)': data.rates.inadimplenciaRate,
      'Media dias atraso': data.rates.avgDaysOverdue,
      'Cobrancas agendadas': data.jobsEfficiency.scheduled,
      'Cobrancas enviadas': data.jobsEfficiency.sent,
      'Cobrancas falhas': data.jobsEfficiency.failed,
      'Pagos antes do envio': data.jobsEfficiency.paidBeforeSend,
      'Taxa de envio (%)': data.jobsEfficiency.sendRate,
      'Taxa de falha (%)': data.jobsEfficiency.failRate,
    },
  ];
}

function flattenProductivity(
  data: Awaited<ReturnType<typeof getReportsProductivity>>,
): Record<string, unknown>[] {
  return data.agents.map((a) => ({
    // displayName e dado de colaborador (nao PII de cidadao) -- OK para gestores (D3).
    // Para self-scoped (agente), displayName dos colegas e null -- nunca retornado.
    'Agente (ID)': a.agentId,
    'Agente (nome)': a.displayName ?? '',
    'Leads fechados (ganhos)': a.leadsClosedWon,
    'Simulacoes criadas': a.simulationsCreated,
    'Conversas resolvidas': a.conversationsResolved,
    'Contratos originados': a.contractsOriginated,
    '1a resposta media (s)': a.avgFirstResponseSec ?? '',
  }));
}
function flattenAi(data: Awaited<ReturnType<typeof getReportsAi>>): Record<string, unknown>[] {
  const conv: Record<string, unknown>[] = [
    { Secao: 'Saude conversas', Metrica: 'Total', Valor: data.conversations.total, 'Taxa (%)': '' },
    {
      Secao: 'Saude conversas',
      Metrica: 'Ativas',
      Valor: data.conversations.active,
      'Taxa (%)': '',
    },
    {
      Secao: 'Saude conversas',
      Metrica: 'Com handoff',
      Valor: data.conversations.handoffed,
      'Taxa (%)': data.conversations.handoffRate,
    },
    {
      Secao: 'Saude conversas',
      Metrica: 'Concluidas sem handoff',
      Valor: data.conversations.completedWithoutHandoff,
      'Taxa (%)': '',
    },
  ];
  const llm: Record<string, unknown>[] = [
    {
      Secao: 'LLM',
      Metrica: 'Tokens entrada',
      Valor: data.llmMetrics.totalTokensIn,
      'Taxa (%)': '',
    },
    {
      Secao: 'LLM',
      Metrica: 'Tokens saida',
      Valor: data.llmMetrics.totalTokensOut,
      'Taxa (%)': '',
    },
    { Secao: 'LLM', Metrica: 'Total chamadas', Valor: data.llmMetrics.totalCalls, 'Taxa (%)': '' },
    {
      Secao: 'LLM',
      Metrica: 'Custo estimado (USD)',
      Valor: data.llmMetrics.estimatedCostUsd ?? 'N/D',
      'Taxa (%)': data.llmMetrics.errorRate,
    },
  ];
  const handoffReasons: Record<string, unknown>[] = data.handoffReasons.map((r) => ({
    Secao: 'Motivos de handoff',
    Metrica: r.reason,
    Valor: r.count,
    'Taxa (%)': r.rate,
  }));
  return [...conv, ...llm, ...handoffReasons];
}

function flattenAudit(
  data: Awaited<ReturnType<typeof getReportsAudit>>,
): Record<string, unknown>[] {
  const volume: Record<string, unknown>[] = [
    {
      Secao: 'Volume',
      'Tipo ou Acao': 'Total de audit logs',
      Contagem: data.auditVolume.total,
      Atores: '',
    },
  ];
  const byResource: Record<string, unknown>[] = data.auditVolume.byResourceType.map((r) => ({
    Secao: 'Por tipo de recurso',
    'Tipo ou Acao': r.resourceType,
    Contagem: r.count,
    Atores: '',
  }));
  const topActions: Record<string, unknown>[] = data.topActions.map((a) => ({
    Secao: 'Top acoes',
    'Tipo ou Acao': a.action,
    Contagem: a.count,
    Atores: '',
  }));
  const critical: Record<string, unknown>[] = data.criticalActions.map((a) => ({
    Secao: 'Acoes criticas',
    'Tipo ou Acao': a.action,
    Contagem: a.count,
    Atores: a.actorCount,
  }));
  return [...volume, ...byResource, ...topActions, ...critical];
}

// ---------------------------------------------------------------------------
// Mapa de secao para titulo legivel
// ---------------------------------------------------------------------------

const SECTION_TITLES: Record<ReportSection, string> = {
  overview: 'Visao Geral',
  funnel: 'Funil CRM',
  attendance: 'Atendimentos',
  credit: 'Credito',
  collection: 'Cobranca',
  productivity: 'Produtividade',
  ai: 'IA Pre-atendimento',
  audit: 'Auditoria e Operacao',
};

// ---------------------------------------------------------------------------
// Resultado do export
// ---------------------------------------------------------------------------

export interface ExportResult {
  buffer: Buffer;
  contentType: string;
  filename: string;
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Erro de limite de linhas
// ---------------------------------------------------------------------------

export class ExportLimitExceededError extends Error {
  readonly code = 'EXPORT_LIMIT_EXCEEDED' as const;
  readonly rowCount: number;
  readonly limit: number;

  constructor(rowCount: number, limit: number) {
    super(
      'O relatorio possui ' +
        rowCount +
        ' linhas, acima do limite de ' +
        limit +
        '. ' +
        'Refine os filtros (periodo menor, cidade especifica) e tente novamente.',
    );
    this.name = 'ExportLimitExceededError';
    this.rowCount = rowCount;
    this.limit = limit;
  }
}
export async function exportReport(
  db: Database,
  actor: ReportsActorContext,
  section: ReportSection,
  format: ExportFormat,
  filters: ExportFilters,
): Promise<ExportResult> {
  if (!actor.permissions.includes('reports:export')) {
    throw new ForbiddenError('Permissao reports:export necessaria para exportar relatorios');
  }
  const { enabled: exportEnabled } = await isFlagEnabled(db, EXPORT_FLAG_KEY);
  if (!exportEnabled) {
    throw new FeatureDisabledError(EXPORT_FLAG_KEY);
  }
  const baseQuery = {
    range: filters.range ?? ('last30d' as const),
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    cityIds: filters.cityIds,
    agentIds: filters.agentIds,
    channel: filters.channel,
    status: filters.status,
    origin: filters.origin,
    compareWithPrevious: filters.compareWithPrevious ?? false,
  };
  let rows: Record<string, unknown>[];
  const sectionTitle: string = SECTION_TITLES[section];
  switch (section) {
    case 'overview': {
      const data = await getReportsOverview(db, actor, baseQuery);
      rows = flattenOverview(data);
      break;
    }
    case 'funnel': {
      const data = await getReportsFunnel(db, actor, baseQuery);
      rows = flattenFunnel(data);
      break;
    }
    case 'attendance': {
      const data = await getReportsAttendance(db, actor, baseQuery);
      rows = flattenAttendance(data);
      break;
    }
    case 'credit': {
      const data = await getReportsCredit(db, actor, {
        ...baseQuery,
        productIds: filters.productIds,
      });
      rows = flattenCredit(data);
      break;
    }
    case 'collection': {
      const data = await getReportsCollection(db, actor, baseQuery);
      rows = flattenCollection(data);
      break;
    }
    case 'productivity': {
      const data = await getReportsProductivity(db, actor, baseQuery);
      rows = flattenProductivity(data);
      break;
    }
    case 'ai': {
      const data = await getReportsAi(db, actor, baseQuery);
      rows = flattenAi(data);
      break;
    }
    case 'audit': {
      const data = await getReportsAudit(db, actor, baseQuery);
      rows = flattenAudit(data);
      break;
    }
  }
  if (rows.length > EXPORT_ROW_LIMIT) {
    throw new ExportLimitExceededError(rows.length, EXPORT_ROW_LIMIT);
  }
  const exportedAt = new Date().toISOString();
  const scopeLabel =
    actor.cityScopeIds === null ? 'Global' : 'Cidade(s): ' + actor.cityScopeIds.join(', ');
  const slug = section.replace(/[^a-z0-9]/gi, '-');
  const dateSlug = exportedAt.slice(0, 10);
  let buffer: Buffer;
  let contentType: string;
  let filename: string;
  switch (format) {
    case 'csv': {
      buffer = serializeToCsv(rows);
      contentType = 'text/csv; charset=utf-8';
      filename = 'relatorio-' + slug + '-' + dateSlug + '.csv';
      break;
    }
    case 'xlsx': {
      buffer = await serializeToXlsx([{ name: sectionTitle, rows }]);
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      filename = 'relatorio-' + slug + '-' + dateSlug + '.xlsx';
      break;
    }
    case 'pdf': {
      buffer = await serializeToPdf([{ title: sectionTitle, rows }], exportedAt, scopeLabel);
      contentType = 'application/pdf';
      filename = 'relatorio-' + slug + '-' + dateSlug + '.pdf';
      break;
    }
  }
  const auditActor: AuditActor = {
    userId: actor.userId,
    role: actor.permissions[0] ?? 'unknown',
    ...(actor.ip !== undefined && actor.ip !== null ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined && actor.userAgent !== null
      ? { userAgent: actor.userAgent }
      : {}),
  };
  void db
    .transaction(async (tx) => {
      await auditLog(tx as Parameters<typeof auditLog>[0], {
        organizationId: actor.organizationId,
        actor: auditActor,
        action: 'reports.export',
        resource: { type: 'reports', id: actor.organizationId },
        before: null,
        after: null,
        metadata: {
          section,
          format,
          rowCount: rows.length,
          filters: {
            range: filters.range ?? 'last30d',
            cityIds: filters.cityIds ?? null,
            agentIds: filters.agentIds ?? null,
            channel: filters.channel ?? null,
          },
          exportedAt,
        },
      });
    })
    .catch(() => undefined);
  return { buffer, contentType, filename, rowCount: rows.length };
}
