// =============================================================================
// followup/schemas.ts — Schemas Zod para o módulo de follow-up (F5-S05).
//
// Cobre:
//   - FollowupRuleCreateSchema / FollowupRuleUpdateSchema / FollowupRuleResponseSchema
//   - FollowupJobResponseSchema / FollowupJobsListQuerySchema / FollowupJobsListResponseSchema
//   - FollowupRulesListResponseSchema
//
// LGPD (doc 17):
//   - FollowupJobResponseSchema não expõe conteúdo de mensagem (apenas template_key).
//   - lead_id retorna apenas id — nome curto e template_key para UI.
//   - Sem cpf, phone, email em respostas deste módulo.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Tipos base / enums
// ---------------------------------------------------------------------------

export const TriggerTypeSchema = z.enum(['stage_inactivity', 'event_based']);

export const FollowupJobStatusSchema = z.enum([
  'scheduled',
  'triggered',
  'sent',
  'failed',
  'cancelled',
  'customer_replied',
]);

export type FollowupJobStatus = z.infer<typeof FollowupJobStatusSchema>;

// ---------------------------------------------------------------------------
// Param schema (usado nas rotas)
// ---------------------------------------------------------------------------

export const ruleIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export const jobIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

// ---------------------------------------------------------------------------
// Rule schemas
// ---------------------------------------------------------------------------

export const FollowupRuleCreateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'Apenas letras minúsculas, números, hífens e underscores'),
  name: z.string().min(1).max(200),
  trigger_type: TriggerTypeSchema,
  wait_hours: z.number().int().positive('Deve ser maior que 0').max(8760, 'Máximo 1 ano'),
  template_id: z.string().uuid('template_id deve ser UUID'),
  applies_to_stage: z.string().max(100).nullable().optional(),
  applies_to_outcome: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional().default(false),
  max_attempts: z.number().int().min(1).max(10).optional().default(3),
});

export type FollowupRuleCreate = z.infer<typeof FollowupRuleCreateSchema>;

export const FollowupRuleUpdateSchema = FollowupRuleCreateSchema.partial().omit({ key: true });

export type FollowupRuleUpdate = z.infer<typeof FollowupRuleUpdateSchema>;

export const FollowupRuleResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  trigger_type: TriggerTypeSchema,
  wait_hours: z.number(),
  template_id: z.string().uuid(),
  applies_to_stage: z.string().nullable(),
  applies_to_outcome: z.string().nullable(),
  is_active: z.boolean(),
  max_attempts: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type FollowupRuleResponse = z.infer<typeof FollowupRuleResponseSchema>;

export const FollowupRulesListResponseSchema = z.object({
  data: z.array(FollowupRuleResponseSchema),
  total: z.number(),
});

export type FollowupRulesListResponse = z.infer<typeof FollowupRulesListResponseSchema>;

// ---------------------------------------------------------------------------
// Job schemas — LGPD: sem conteúdo de mensagem, sem PII
// ---------------------------------------------------------------------------

export const FollowupJobResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  // LGPD: lead_name é nome curto (primeiro nome apenas) — exibição visual
  lead_name: z.string().nullable(),
  rule_id: z.string().uuid(),
  rule_key: z.string().nullable(),
  // template_key exposto em vez de body — sem conteúdo de mensagem
  template_key: z.string().nullable(),
  scheduled_at: z.string(),
  status: FollowupJobStatusSchema,
  attempt_count: z.number(),
  // last_error é descritivo técnico — nunca contém PII
  last_error: z.string().nullable(),
  // sent_message_id é ID opaco da Meta — não é PII por si só
  sent_message_id: z.string().nullable(),
  idempotency_key: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type FollowupJobResponse = z.infer<typeof FollowupJobResponseSchema>;

export const FollowupJobsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: FollowupJobStatusSchema.optional(),
  rule_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
});

export type FollowupJobsListQuery = z.infer<typeof FollowupJobsListQuerySchema>;

export const FollowupJobsListResponseSchema = z.object({
  data: z.array(FollowupJobResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export type FollowupJobsListResponse = z.infer<typeof FollowupJobsListResponseSchema>;
