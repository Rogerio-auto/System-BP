// =============================================================================
// notification-rules/sla-sources.ts — Fontes de inatividade por eixo (F24-S07).
//
// Cada eixo de inatividade mapeia para uma tabela/coluna de timestamp que indica
// quando o lead "entrou" num estado de espera. O worker consulta essas fontes
// para detectar entidades paradas além do threshold_hours da regra.
//
// Eixos suportados (trigger_key → fonte):
//   <nome do stage>  → kanban_cards.entered_stage_at (lead parado no stage)
//   '*'              → todos os stages da org (sem filtro de stage)
//
// LGPD §8.5:
//   Queries retornam apenas IDs opacos + timestamps.
//   Sem PII (nome, telefone, CPF) no resultado.
//
// Multi-tenant:
//   Todas as queries filtram por organizationId (parâmetro explícito).
// =============================================================================
import { and, eq, isNotNull, lt } from 'drizzle-orm';

import type { Database } from '../../db/client.js';
import { kanbanCards, kanbanStages, leads } from '../../db/schema/index.js';

// ---------------------------------------------------------------------------
// Tipo de entidade retornada pelas fontes
// ---------------------------------------------------------------------------

/**
 * Entidade elegível para notificação de SLA.
 *
 * entityId   = UUID da entidade principal (lead_id).
 * entityType = tipo para notification_rule_deliveries ('lead').
 * cityId     = cidade do lead, para filtro city_scope.
 */
export interface SlaEligibleEntity {
  entityId: string;
  entityType: string;
  cityId: string | null;
  /** Timestamp relevante para diagnóstico (ex: entered_stage_at). */
  sinceAt: Date;
}

// ---------------------------------------------------------------------------
// Fonte: kanban_stage (entered_stage_at)
// ---------------------------------------------------------------------------

/**
 * Encontra leads parados no mesmo kanban stage além de thresholdHours.
 *
 * triggerKey é o nome do stage monitorado (ex: 'Qualificação', 'Simulação').
 * Se for '*', busca leads em qualquer stage além do threshold.
 *
 * LGPD: retorna apenas IDs opacos + timestamps. Sem PII.
 */
export async function findStagnantKanbanCards(
  db: Database,
  organizationId: string,
  thresholdHours: number,
  triggerKey: string,
): Promise<SlaEligibleEntity[]> {
  const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1_000);

  const conditions = [
    eq(kanbanCards.organizationId, organizationId),
    isNotNull(kanbanCards.leadId),
    lt(kanbanCards.enteredStageAt, cutoff),
  ];

  // Filtrar por nome do stage quando triggerKey não for wildcard
  if (triggerKey !== '*') {
    conditions.push(eq(kanbanStages.name, triggerKey));
  }

  const rows = await db
    .select({
      leadId: kanbanCards.leadId,
      cityId: leads.cityId,
      enteredStageAt: kanbanCards.enteredStageAt,
    })
    .from(kanbanCards)
    .innerJoin(kanbanStages, eq(kanbanCards.stageId, kanbanStages.id))
    .innerJoin(leads, eq(kanbanCards.leadId, leads.id))
    .where(and(...conditions));

  return rows.map((r) => ({
    entityId: r.leadId,
    entityType: 'lead',
    cityId: r.cityId ?? null,
    sinceAt: r.enteredStageAt,
  }));
}

// ---------------------------------------------------------------------------
// Dispatcher de fonte por triggerKey
// ---------------------------------------------------------------------------

/**
 * Retorna as entidades elegíveis para uma regra stage_inactivity.
 *
 * Para trigger_kind='stage_inactivity', triggerKey é o nome do stage
 * (ex: 'Qualificação') ou '*' para todos os stages.
 */
export async function findSlaSources(
  db: Database,
  organizationId: string,
  thresholdHours: number,
  triggerKey: string,
): Promise<SlaEligibleEntity[]> {
  return findStagnantKanbanCards(db, organizationId, thresholdHours, triggerKey);
}
