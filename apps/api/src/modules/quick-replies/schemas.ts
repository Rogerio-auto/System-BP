// =============================================================================
// quick-replies/schemas.ts — Schemas Zod locais de rota (F28-S03).
//
// O contrato de domínio (create/update/response/list-query) vive em
// @elemento/shared-schemas (F28-S02) — não duplicado aqui. Este arquivo cobre
// apenas o que é específico da camada HTTP deste módulo:
//   - params de rota (:id)
//   - body de PATCH /reorder (não existe no pacote compartilhado — é uma
//     operação exclusivamente administrativa, sem consumidor no frontend
//     fora da tela de admin de F28).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const quickReplyIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID da resposta rápida'),
});
export type QuickReplyIdParam = z.infer<typeof quickReplyIdParamSchema>;

// ---------------------------------------------------------------------------
// Reorder (doc 25 §5 — exige `manage`)
// ---------------------------------------------------------------------------

export const quickReplyReorderItemSchema = z.object({
  id: z.string().uuid(),
  sortOrder: z.number().int(),
});

// Envelope `{ items: [...] }` em vez de array nu: é o formato que o cliente web
// já emite (F28-S05, `api.ts` → `reorderQuickReplies`) e permite acrescentar
// campos ao lote no futuro sem quebrar o contrato.
export const quickReplyReorderBodySchema = z.object({
  items: z
    .array(quickReplyReorderItemSchema)
    .min(1, 'Informe ao menos um item para reordenar')
    .max(500, 'Máximo de 500 itens por lote de reordenação'),
});
export type QuickReplyReorderBody = z.infer<typeof quickReplyReorderBodySchema>;
