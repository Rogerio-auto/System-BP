// =============================================================================
// dashboard/service.ts — Regras de negócio para o endpoint de métricas (F8-S03).
//
// Responsabilidades:
//   - Calcular intervalo de datas a partir do parâmetro `range`.
//   - Validar city scope: se cityId fornecido, verificar que está no escopo do usuário.
//   - Orquestrar as queries do repository em paralelo (Promise.all).
//   - Montar o shape final da resposta.
//   - Gravar audit log por chamada (1 linha por request).
//
// LGPD:
//   - Resposta não contém PII de leads (apenas contagens e IDs opacos).
//   - display_name de agentes é dado de colaborador (não PII de cidadão).
//   - Audit log registra apenas filtros aplicados (sem PII).
//
// Erros:
//   - cityId fora do escopo do usuário → ForbiddenError (403).
// =============================================================================
import type { Database } from '../../db/client.js';
import { auditLog } from '../../lib/audit.js';
import type { AuditActor } from '../../lib/audit.js';
import { ForbiddenError } from '../../shared/errors.js';

import {
  countInteractionsByChannel,
  countInteractionsByDirection,
  countInteractionsInRange,
  countKanbanCardsByStage,
  countLeadsByCity,
  countLeadsBySource,
  countLeadsByStatus,
  countNewLeadsInRange,
  countStaleLeads,
  countTotalLeads,
  getAvgDaysInStage,
  getTopAgentsByLeadsClosed,
} from './repository.js';
import type { DashboardMetricsQuery, DashboardMetricsResponse, Range } from './schemas.js';

// ---------------------------------------------------------------------------
// Contexto do ator
// ---------------------------------------------------------------------------

export interface ActorContext {
  userId: string;
  organizationId: string;
  role: string;
  cityScopeIds: string[] | null;
  ip?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Cálculo de intervalo de datas
// ---------------------------------------------------------------------------

interface RangeResult {
  from: Date;
  to: Date;
  label: string;
}

/**
 * Deriva os limites de datas e o label human-readable a partir do enum `range`.
 *
 * Intervalos:
 *   today  → meia-noite de hoje até agora
 *   7d     → últimos 7 dias (corridos)
 *   30d    → últimos 30 dias (corridos) — padrão
 *   mtd    → início do mês corrente até agora
 *   ytd    → início do ano corrente até agora
 */
function computeRange(range: Range): RangeResult {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

  switch (range) {
    case 'today':
      return {
        from: startOfDay,
        to: now,
        label: 'Hoje',
      };

    case '7d': {
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { from, to: now, label: 'Últimos 7 dias' };
    }

    case '30d': {
      const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { from, to: now, label: 'Últimos 30 dias' };
    }

    case 'mtd': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      return { from, to: now, label: 'Mês atual' };
    }

    case 'ytd': {
      const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      return { from, to: now, label: 'Ano atual' };
    }
  }
}

// ---------------------------------------------------------------------------
// Validação de city scope
// ---------------------------------------------------------------------------

/**
 * Valida que o cityId fornecido está no escopo do usuário.
 * Lança ForbiddenError (403) se cityId não está permitido.
 */
function assertCityInScope(cityId: string, cityScopeIds: string[] | null): void {
  // Admin/gestor_geral: cityScopeIds === null → sem restrição
  if (cityScopeIds === null) return;

  if (!cityScopeIds.includes(cityId)) {
    throw new ForbiddenError('Acesso negado: cidade não está no escopo do usuário');
  }
}

// ---------------------------------------------------------------------------
// Service principal
// ---------------------------------------------------------------------------

/**
 * Agrega todos os KPIs do dashboard para o escopo e intervalo solicitados.
 *
 * Estratégia de performance:
 *   - Queries independentes são executadas em paralelo via Promise.all.
 *   - Com TTL 60s de cache em memória pode ser adicionado na camada routes
 *     se p95 > 500ms (decisão registrada no PR).
 */
export async function getDashboardMetrics(
  db: Database,
  actor: ActorContext,
  query: DashboardMetricsQuery,
): Promise<DashboardMetricsResponse> {
  const { range: rangeKey, cityId } = query;

  // 1. Validar city scope se cityId fornecido
  if (cityId !== undefined) {
    assertCityInScope(cityId, actor.cityScopeIds);
  }

  // 2. Calcular intervalo de datas
  const dateRange = computeRange(rangeKey);

  const { organizationId, cityScopeIds } = actor;

  // 3. Executar queries em paralelo — todas independentes entre si
  const [
    totalLeads,
    newInRange,
    byStatus,
    byCity,
    bySource,
    staleCount,
    totalInteractions,
    interactionsByChannel,
    interactionsByDirection,
    cardsByStage,
    avgDaysInStage,
    topAgents,
  ] = await Promise.all([
    countTotalLeads(db, organizationId, cityScopeIds, cityId),
    countNewLeadsInRange(db, organizationId, cityScopeIds, dateRange, cityId),
    countLeadsByStatus(db, organizationId, cityScopeIds, cityId),
    countLeadsByCity(db, organizationId, cityScopeIds, cityId),
    countLeadsBySource(db, organizationId, cityScopeIds, cityId),
    countStaleLeads(db, organizationId, cityScopeIds, cityId),
    countInteractionsInRange(db, organizationId, cityScopeIds, dateRange, cityId),
    countInteractionsByChannel(db, organizationId, cityScopeIds, dateRange, cityId),
    countInteractionsByDirection(db, organizationId, cityScopeIds, dateRange, cityId),
    countKanbanCardsByStage(db, organizationId, cityScopeIds, cityId),
    getAvgDaysInStage(db, organizationId, cityScopeIds, cityId),
    getTopAgentsByLeadsClosed(db, organizationId, cityScopeIds, dateRange, cityId),
  ]);

  // 4. Gravar audit log — ação de leitura, sem PII
  // Audit é feito fora de transação (leitura — sem mutação). Falha silenciosa é
  // preferível a bloquear a resposta. Em produção, monitorar via Pino.
  // Construir AuditActor sem incluir ip/userAgent se forem undefined
  // (exactOptionalPropertyTypes: undefined !== omitido)
  const auditActor: AuditActor = {
    userId: actor.userId,
    role: actor.role,
    ...(actor.ip !== undefined ? { ip: actor.ip } : {}),
    ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
  };

  await db.transaction(async (tx) => {
    await auditLog(tx as unknown as Parameters<typeof auditLog>[0], {
      organizationId,
      actor: auditActor,
      action: 'dashboard.read',
      resource: { type: 'dashboard', id: organizationId },
      before: null,
      after: null,
      // Payload com filtros aplicados (sem PII)
      metadata: {
        range: rangeKey,
        cityId: cityId ?? null,
        cityScopeIds: cityScopeIds ?? 'global',
      },
    });
  });

  // 5. Montar resposta
  return {
    range: {
      from: dateRange.from.toISOString(),
      to: dateRange.to.toISOString(),
      label: dateRange.label,
    },
    leads: {
      total: totalLeads,
      newInRange,
      byStatus,
      byCity,
      bySource,
      staleCount,
    },
    interactions: {
      totalInRange: totalInteractions,
      byChannel: interactionsByChannel,
      inboundOutboundRatio: interactionsByDirection,
    },
    kanban: {
      cardsByStage,
      avgDaysInStage,
    },
    agents: {
      topByLeadsClosed: topAgents,
    },
  };
}
