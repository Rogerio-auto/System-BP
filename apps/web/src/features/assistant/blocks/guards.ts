// =============================================================================
// features/assistant/blocks/guards.ts — Type guards puros para o `value`
// (unknown) de cada bloco do copiloto interno (F6-S22).
//
// `Block.value` chega tipado como `unknown` (contrato real —
// apps/api/src/modules/internal-assistant/schemas.ts usa z.unknown()).
// Nunca fazemos cast (`as`) — cada card valida a forma em runtime antes de
// renderizar; falha de validação cai no estado "dado indisponível" (previsto
// para a Fase 3, quando faltar acesso a uma entidade referenciada).
// =============================================================================

import type {
  AnalysisStatusEntry,
  AnalysisStatusValue,
  BillingValue,
  FunnelMetricsValue,
  FunnelStage,
  LeadCountValue,
  LeadSummaryMessage,
  LeadSummaryValue,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

// ── funnel_metrics ────────────────────────────────────────────────────────────

function isFunnelStage(value: unknown): value is FunnelStage {
  return (
    isRecord(value) &&
    isString(value.stageId) &&
    isString(value.stageName) &&
    isFiniteNumber(value.stageOrder) &&
    isFiniteNumber(value.cardCount) &&
    isFiniteNumber(value.staleCardCount) &&
    isNullableNumber(value.avgDwellHours)
  );
}

export function isFunnelMetricsValue(value: unknown): value is FunnelMetricsValue {
  if (!isRecord(value) || !isString(value.source)) return false;
  if (!Array.isArray(value.stages) || !value.stages.every(isFunnelStage)) return false;
  const overview = value.overview;
  return (
    isRecord(overview) &&
    isFiniteNumber(overview.total) &&
    isFiniteNumber(overview.newInPeriod) &&
    isFiniteNumber(overview.closedWon) &&
    isFiniteNumber(overview.closedLost) &&
    isFiniteNumber(overview.conversionRate) &&
    isString(overview.rangeLabel)
  );
}

// ── lead_count ─────────────────────────────────────────────────────────────────

export function isLeadCountValue(value: unknown): value is LeadCountValue {
  return (
    isRecord(value) &&
    isString(value.source) &&
    isFiniteNumber(value.total) &&
    isFiniteNumber(value.newInPeriod) &&
    isFiniteNumber(value.conversionRate) &&
    isString(value.rangeLabel)
  );
}

// ── analysis_status ──────────────────────────────────────────────────────────

function isAnalysisStatusEntry(value: unknown): value is AnalysisStatusEntry {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.status) &&
    isNullableNumber(value.approvedAmountBrl) &&
    isString(value.createdAt)
  );
}

export function isAnalysisStatusValue(value: unknown): value is AnalysisStatusValue {
  return (
    isRecord(value) &&
    isString(value.source) &&
    isNullableString(value.leadNameMasked) &&
    Array.isArray(value.analyses) &&
    value.analyses.every(isAnalysisStatusEntry)
  );
}

// ── billing ────────────────────────────────────────────────────────────────────

export function isBillingValue(value: unknown): value is BillingValue {
  return (
    isRecord(value) &&
    isString(value.source) &&
    isFiniteNumber(value.totalDues) &&
    isFiniteNumber(value.overdueCount) &&
    isFiniteNumber(value.upcomingCount) &&
    isFiniteNumber(value.totalAmountBrl) &&
    isString(value.snapshotLabel)
  );
}

// ── lead_summary ──────────────────────────────────────────────────────────────

function isLeadSummaryMessage(value: unknown): value is LeadSummaryMessage {
  return (
    isRecord(value) &&
    (value.direction === 'in' || value.direction === 'out') &&
    isNullableString(value.content) &&
    isString(value.created_at)
  );
}

export function isLeadSummaryValue(value: unknown): value is LeadSummaryValue {
  return (
    isRecord(value) &&
    isString(value.source) &&
    isString(value.lead_id) &&
    Array.isArray(value.messages) &&
    value.messages.every(isLeadSummaryMessage) &&
    typeof value.truncated === 'boolean'
  );
}

export { isRecord };
