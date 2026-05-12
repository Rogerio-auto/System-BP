// =============================================================================
// hooks/kanban/types.ts — Tipos compartilhados do módulo Kanban.
//
// Refletem o schema do F1-S13 (kanban_stages + kanban_cards +
// kanban_stage_history). Nunca exponha CPF na UI — LGPD doc 17.
// =============================================================================

export interface KanbanStage {
  id: string;
  name: string;
  slug: string;
  position: number;
  color: string | null;
  cityId: string;
  organizationId: string;
}

export interface KanbanCard {
  id: string;
  stageId: string;
  leadId: string;
  leadName: string;
  /** Telefone parcialmente mascarado para LGPD: "+55 11 ****-1234" */
  phoneMasked: string;
  agentId: string | null;
  agentName: string | null;
  /** Valor em centavos */
  loanAmountCents: number | null;
  position: number;
  lastNote: string | null;
  updatedAt: string;
}

export interface KanbanStageHistory {
  id: string;
  cardId: string;
  fromStageId: string | null;
  toStageId: string;
  fromStageName: string | null;
  toStageName: string;
  actorName: string;
  note: string | null;
  createdAt: string;
}

export interface KanbanFilters {
  cityId?: string | undefined;
  agentId?: string | undefined;
  minAmountCents?: number | undefined;
  maxAmountCents?: number | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export interface MoveCardPayload {
  cardId: string;
  targetStageId: string;
  position?: number | undefined;
}

export interface MoveCardResponse {
  card: KanbanCard;
}
