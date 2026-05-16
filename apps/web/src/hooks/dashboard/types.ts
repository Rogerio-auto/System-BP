// =============================================================================
// hooks/dashboard/types.ts — Tipos do hook useDashboardMetrics.
//
// Espelha EXATAMENTE o DashboardMetricsResponseSchema do backend
// (apps/api/src/modules/dashboard/schemas.ts). Nomes de campos são camelCase
// — igual ao schema Zod do backend que já usa camelCase.
//
// LGPD: nenhum destes tipos contém PII de leads.
// =============================================================================

// ---------------------------------------------------------------------------
// Enums canônicos (espelham LeadStatusEnum, LeadSourceEnum, etc. do backend)
// ---------------------------------------------------------------------------

export type LeadStatus =
  | 'new'
  | 'qualifying'
  | 'simulation'
  | 'closed_won'
  | 'closed_lost'
  | 'archived';
export type LeadSource = 'whatsapp' | 'manual' | 'import' | 'chatwoot' | 'api';
export type InteractionChannel = 'whatsapp' | 'phone' | 'email' | 'in_person' | 'chatwoot';
export type Range = 'today' | '7d' | '30d' | 'mtd' | 'ytd';

// ---------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------

export interface DashboardMetricsQuery {
  range?: Range;
  cityId?: string;
}

// ---------------------------------------------------------------------------
// Shapes da resposta (mirrors do backend schemas.ts)
// ---------------------------------------------------------------------------

export interface RangeInfo {
  from: string;
  to: string;
  label: string;
}

export interface LeadsByStatusItem {
  status: LeadStatus;
  count: number;
}

export interface LeadsByCityItem {
  cityId: string;
  cityName: string;
  count: number;
}

export interface LeadsBySourceItem {
  source: LeadSource;
  count: number;
}

export interface LeadsMetrics {
  total: number;
  newInRange: number;
  byStatus: LeadsByStatusItem[];
  byCity: LeadsByCityItem[];
  bySource: LeadsBySourceItem[];
  staleCount: number;
}

export interface InteractionsByChannelItem {
  channel: InteractionChannel;
  count: number;
}

export interface InboundOutboundRatio {
  inbound: number;
  outbound: number;
}

export interface InteractionsMetrics {
  totalInRange: number;
  byChannel: InteractionsByChannelItem[];
  inboundOutboundRatio: InboundOutboundRatio;
}

export interface KanbanCardsByStageItem {
  stageId: string;
  stageName: string;
  count: number;
}

export interface KanbanAvgDaysInStageItem {
  stageId: string;
  days: number;
}

export interface KanbanMetrics {
  cardsByStage: KanbanCardsByStageItem[];
  avgDaysInStage: KanbanAvgDaysInStageItem[];
}

export interface TopAgentItem {
  agentId: string;
  displayName: string;
  closedWon: number;
}

export interface AgentsMetrics {
  topByLeadsClosed: TopAgentItem[];
}

// ---------------------------------------------------------------------------
// Response principal
// ---------------------------------------------------------------------------

export interface DashboardMetricsResponse {
  range: RangeInfo;
  leads: LeadsMetrics;
  interactions: InteractionsMetrics;
  kanban: KanbanMetrics;
  agents: AgentsMetrics;
}
