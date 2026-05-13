// =============================================================================
// kanban/schemas.ts — Zod schemas de validação do módulo kanban (F1-S13).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Request: mover card para um novo stage
// ---------------------------------------------------------------------------

export const moveCardBodySchema = z.object({
  /**
   * UUID do stage de destino.
   * Deve pertencer à mesma organização do card.
   */
  toStageId: z.string().uuid({ message: 'toStageId deve ser um UUID válido' }),
});

export type MoveCardBody = z.infer<typeof moveCardBodySchema>;

// ---------------------------------------------------------------------------
// Response: card após movimentação
// ---------------------------------------------------------------------------

export const kanbanCardResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  leadId: z.string().uuid(),
  stageId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
  priority: z.number().int(),
  notes: z.string().nullable(),
  enteredStageAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type KanbanCardResponse = z.infer<typeof kanbanCardResponseSchema>;

// ---------------------------------------------------------------------------
// Response: stage do board (GET /api/kanban/stages)
//
// Alinhado com KanbanStage em apps/web/src/hooks/kanban/types.ts.
// ---------------------------------------------------------------------------

export const kanbanStageResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /** slug gerado pelo frontend a partir do name — derivado aqui para compatibilidade */
  slug: z.string(),
  position: z.number().int(),
  color: z.string().nullable(),
  /** city_id não está em kanban_stages — retornamos string vazia como sentinela */
  cityId: z.string(),
  organizationId: z.string().uuid(),
});

export type KanbanStageResponse = z.infer<typeof kanbanStageResponseSchema>;

export const kanbanStagesListResponseSchema = z.object({
  stages: z.array(kanbanStageResponseSchema),
});

export type KanbanStagesListResponse = z.infer<typeof kanbanStagesListResponseSchema>;

// ---------------------------------------------------------------------------
// Request: filtros de listagem de cards (GET /api/kanban/cards)
//
// Alinhado com KanbanFilters + params usados em apps/web/src/hooks/kanban/useKanbanCards.ts.
// ---------------------------------------------------------------------------

export const listCardsQuerySchema = z.object({
  stage_id: z.string().uuid().optional(),
  city_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  /** Valor mínimo do empréstimo em centavos */
  min_amount_cents: z.coerce.number().int().nonnegative().optional(),
  /** Valor máximo do empréstimo em centavos */
  max_amount_cents: z.coerce.number().int().nonnegative().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListCardsQuery = z.infer<typeof listCardsQuerySchema>;

// ---------------------------------------------------------------------------
// Response: card enriquecido (GET /api/kanban/cards)
//
// Alinhado com KanbanCard em apps/web/src/hooks/kanban/types.ts.
// LGPD §8.5: phoneMasked — nunca expor phoneE164 completo.
// ---------------------------------------------------------------------------

export const kanbanCardEnrichedSchema = z.object({
  id: z.string().uuid(),
  stageId: z.string().uuid(),
  leadId: z.string().uuid(),
  /** Nome do lead (PII — redactado em logs, exposto somente via RBAC leads:read) */
  leadName: z.string(),
  /**
   * Telefone parcialmente mascarado: "+55 69 ****-1234".
   * LGPD: nunca expor phoneE164 completo na resposta de lista.
   */
  phoneMasked: z.string(),
  agentId: z.string().uuid().nullable(),
  agentName: z.string().nullable(),
  /**
   * Valor do empréstimo em centavos.
   * null = sem simulação vinculada ainda.
   */
  loanAmountCents: z.number().int().nullable(),
  /** Mapeado de kanban_cards.priority — ordena cards dentro do stage */
  position: z.number().int(),
  lastNote: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type KanbanCardEnriched = z.infer<typeof kanbanCardEnrichedSchema>;

export const kanbanCardsListResponseSchema = z.object({
  cards: z.array(kanbanCardEnrichedSchema),
  total: z.number().int(),
});
