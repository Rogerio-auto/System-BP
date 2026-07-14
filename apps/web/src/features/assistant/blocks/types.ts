// =============================================================================
// features/assistant/blocks/types.ts — Formas dos `value` hidratados dos
// blocos do copiloto interno (F6-S22).
//
// Espelham as responses das tools de leitura consumidas pelo LangGraph
// (apps/api/src/modules/internal/assistant/schemas.ts — não exportado ao
// frontend, por isso replicado aqui). `Block.value` no contrato público
// (apps/api/src/modules/internal-assistant/schemas.ts) é `z.unknown()` de
// propósito — estas interfaces documentam a forma ESPERADA por `type`
// conhecido, mas a validação real acontece em runtime (guards.ts), nunca por
// cast (`as`).
// =============================================================================

/** Tipos de bloco conhecidos hoje (F6-S20/F6-S21). Novos tipos são tolerados
 * (forward-compat) — ver UnknownBlockCard. */
export type KnownBlockType =
  | 'lead_summary'
  | 'funnel_metrics'
  | 'lead_count'
  | 'analysis_status'
  | 'billing';

export interface FunnelStage {
  stageId: string;
  stageName: string;
  stageOrder: number;
  cardCount: number;
  staleCardCount: number;
  avgDwellHours: number | null;
}

export interface FunnelMetricsValue {
  source: string;
  stages: FunnelStage[];
  overview: {
    total: number;
    newInPeriod: number;
    closedWon: number;
    closedLost: number;
    conversionRate: number;
    rangeLabel: string;
  };
}

export interface LeadCountValue {
  source: string;
  total: number;
  newInPeriod: number;
  conversionRate: number;
  rangeLabel: string;
}

export interface AnalysisStatusEntry {
  id: string;
  status: string;
  approvedAmountBrl: number | null;
  createdAt: string;
}

export interface AnalysisStatusValue {
  source: string;
  /** Nome mascarado ("J. Silva") — nunca nome completo. LGPD §12.5. */
  leadNameMasked: string | null;
  analyses: AnalysisStatusEntry[];
}

export interface BillingValue {
  source: string;
  totalDues: number;
  overdueCount: number;
  upcomingCount: number;
  totalAmountBrl: number;
  snapshotLabel: string;
}

export interface LeadSummaryMessage {
  direction: 'in' | 'out';
  content: string | null;
  created_at: string;
}

export interface LeadSummaryValue {
  source: string;
  lead_id: string;
  messages: LeadSummaryMessage[];
  truncated: boolean;
}
