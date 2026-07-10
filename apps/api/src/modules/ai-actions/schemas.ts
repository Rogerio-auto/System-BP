// =============================================================================
// ai-actions/schemas.ts — Schemas Zod do painel "IA nas últimas 24h" (F25-S06).
//
// Cobre:
//   - GET  /api/ai-actions          — querystring + resposta paginada.
//   - POST /api/ai-actions/:id/revert — params + resposta de reversão.
//
// Doc normativo: docs/22-agente-interno-acoes.md §8.B/§11.
//
// LGPD §8.5: a resposta da listagem NUNCA expõe o nome completo do lead —
// apenas `lead_name_masked` (ex.: "J. Silva"). Ver service.ts§maskLeadName.
// =============================================================================
import 'zod-openapi/extend';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Ações da IA cobertas pelo painel (doc 22 §11)
// ---------------------------------------------------------------------------

/**
 * Ações do agente de IA no funil que aparecem no painel de observabilidade.
 * Espelha as `action`s gravadas em audit_logs por F25-S03 (qualifyLead) e
 * F25-S05 (funnel-housekeeping).
 */
export const AI_ACTION_NAMES = ['leads.qualified', 'leads.stagnant', 'leads.abandoned'] as const;

export type AiActionName = (typeof AI_ACTION_NAMES)[number];

/**
 * Subconjunto de AI_ACTION_NAMES que pode ser revertido em 1 clique
 * (doc 22 §8.B/§11). `leads.stagnant` é apenas informativo — não há
 * mutação de estado para desfazer.
 */
export const REVERTIBLE_AI_ACTION_NAMES = ['leads.qualified', 'leads.abandoned'] as const;

export type RevertibleAiActionName = (typeof REVERTIBLE_AI_ACTION_NAMES)[number];

// ---------------------------------------------------------------------------
// GET /api/ai-actions
// ---------------------------------------------------------------------------

export const AiActionsWindowSchema = z.enum(['24h', '7d', '30d']);

export const AiActionsListQuerySchema = z.object({
  /** Janela de observação. Default '24h' (nome do painel no doc 22 §11). */
  window: AiActionsWindowSchema.default('24h').describe(
    'Janela de observação das ações da IA: 24h, 7d ou 30d.',
  ),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AiActionsListQuery = z.infer<typeof AiActionsListQuerySchema>;

export const AiActionItemSchema = z.object({
  /** UUID do registro em audit_logs — usado como `:id` em POST /revert. */
  action_id: z.string().uuid(),
  action: z.enum(AI_ACTION_NAMES),
  lead_id: z.string().uuid(),
  /**
   * Nome do lead mascarado (LGPD §8.5) — ex.: "J. Silva".
   * null se o lead não foi encontrado (ex.: hard-delete excepcional).
   */
  lead_name_masked: z.string().nullable(),
  city_id: z.string().uuid().nullable(),
  occurred_at: z.string().datetime({ offset: true }),
  /** true para leads.qualified/leads.abandoned — pode ser revertida via POST /revert. */
  revertible: z.boolean(),
  /** true se já existe uma reversão registrada para esta ação. */
  reverted: z.boolean(),
});

export type AiActionItem = z.infer<typeof AiActionItemSchema>;

export const AiActionsListResponseSchema = z
  .object({
    data: z.array(AiActionItemSchema),
    pagination: z.object({
      page: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
    }),
  })
  .openapi({
    example: {
      data: [
        {
          action_id: '11111111-1111-1111-1111-111111111111',
          action: 'leads.qualified',
          lead_id: '22222222-2222-2222-2222-222222222222',
          lead_name_masked: 'J. Silva',
          city_id: '33333333-3333-3333-3333-333333333333',
          occurred_at: '2026-07-10T12:00:00.000Z',
          revertible: true,
          reverted: false,
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  });

export type AiActionsListResponse = z.infer<typeof AiActionsListResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/ai-actions/:id/revert
// ---------------------------------------------------------------------------

export const AiActionIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type AiActionIdParam = z.infer<typeof AiActionIdParamSchema>;

export const AiActionRevertResponseSchema = z
  .object({
    action_id: z.string().uuid(),
    lead_id: z.string().uuid(),
    action: z.enum(REVERTIBLE_AI_ACTION_NAMES),
    /** Sempre true em resposta 200 — reversão aplicada agora ou já aplicada antes (idempotente). */
    reverted: z.boolean(),
    previous_status: z.string(),
    current_status: z.string(),
    reverted_at: z.string().datetime({ offset: true }),
  })
  .openapi({
    example: {
      action_id: '11111111-1111-1111-1111-111111111111',
      lead_id: '22222222-2222-2222-2222-222222222222',
      action: 'leads.abandoned',
      reverted: true,
      previous_status: 'closed_lost',
      current_status: 'qualifying',
      reverted_at: '2026-07-10T13:00:00.000Z',
    },
  });

export type AiActionRevertResponse = z.infer<typeof AiActionRevertResponseSchema>;
