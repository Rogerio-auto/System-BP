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
