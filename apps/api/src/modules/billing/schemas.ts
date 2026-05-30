// =============================================================================
// billing/schemas.ts — Schemas Zod para o módulo de cobrança (F5-S08).
//
// Cobre:
//   - PaymentDueResponseSchema / PaymentDuesListQuerySchema
//   - CollectionRuleCreateSchema / CollectionRuleUpdateSchema / CollectionRuleResponseSchema
//   - CollectionJobResponseSchema / CollectionJobsListQuerySchema
//   - MarkPaidBodySchema / RenegotiateBodySchema
//
// LGPD (doc 17):
//   - PaymentDueResponse não expõe CPF — vínculo via customer_id.
//   - customer_name: apenas primeiro nome (split_part do lead).
//   - CollectionJobResponse não expõe PII direta.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PaymentDueStatusSchema = z.enum([
  'pending',
  'overdue',
  'paid',
  'renegotiated',
  'cancelled',
]);
export type PaymentDueStatus = z.infer<typeof PaymentDueStatusSchema>;

export const CollectionJobStatusSchema = z.enum([
  'scheduled',
  'triggered',
  'sent',
  'failed',
  'cancelled',
  'paid_before_send',
]);
export type CollectionJobStatus = z.infer<typeof CollectionJobStatusSchema>;

export const CollectionTriggerTypeSchema = z.enum(['days_before_due', 'days_after_due']);
export type CollectionTriggerType = z.infer<typeof CollectionTriggerTypeSchema>;

// ---------------------------------------------------------------------------
// Param schemas
// ---------------------------------------------------------------------------

export const dueIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export const ruleIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export const jobIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

// ---------------------------------------------------------------------------
// PaymentDue schemas
// ---------------------------------------------------------------------------

export const PaymentDueResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  // LGPD: apenas primeiro nome (split_part)
  customer_name: z.string().nullable(),
  contract_reference: z.string(),
  installment_number: z.number().int().positive(),
  due_date: z.string(),
  amount: z.string(),
  status: PaymentDueStatusSchema,
  paid_at: z.string().nullable(),
  origin: z.enum(['manual', 'import']),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type PaymentDueResponse = z.infer<typeof PaymentDueResponseSchema>;

export const PaymentDuesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: PaymentDueStatusSchema.optional(),
  customer_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export type PaymentDuesListQuery = z.infer<typeof PaymentDuesListQuerySchema>;

export const PaymentDuesListResponseSchema = z.object({
  data: z.array(PaymentDueResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export type PaymentDuesListResponse = z.infer<typeof PaymentDuesListResponseSchema>;

// ---------------------------------------------------------------------------
// MarkPaid / Renegotiate schemas
// ---------------------------------------------------------------------------

export const MarkPaidBodySchema = z.object({
  // Idempotência via header Idempotency-Key (verificado no controller)
  // notes: campo opcional para observação do pagamento
  notes: z.string().max(500).optional(),
});

export type MarkPaidBody = z.infer<typeof MarkPaidBodySchema>;

export const RenegotiateBodySchema = z.object({
  notes: z.string().max(500).optional(),
});

export type RenegotiateBody = z.infer<typeof RenegotiateBodySchema>;

// ---------------------------------------------------------------------------
// CollectionRule schemas
// ---------------------------------------------------------------------------

export const CollectionRuleCreateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_-]+$/, 'Apenas letras minúsculas, números, hífens e underscores'),
  name: z.string().min(1).max(200),
  trigger_type: CollectionTriggerTypeSchema,
  wait_hours: z.number().int().min(-8760, 'Mínimo -1 ano').max(8760, 'Máximo 1 ano'),
  template_id: z.string().uuid('template_id deve ser UUID'),
  applies_to_status: PaymentDueStatusSchema.nullable().optional(),
  is_active: z.boolean().optional().default(false),
  max_attempts: z.number().int().min(1).max(10).optional().default(3),
});

export type CollectionRuleCreate = z.infer<typeof CollectionRuleCreateSchema>;

export const CollectionRuleUpdateSchema = CollectionRuleCreateSchema.partial().omit({ key: true });

export type CollectionRuleUpdate = z.infer<typeof CollectionRuleUpdateSchema>;

export const CollectionRuleResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  key: z.string(),
  name: z.string(),
  trigger_type: CollectionTriggerTypeSchema,
  wait_hours: z.number(),
  template_id: z.string().uuid(),
  applies_to_status: PaymentDueStatusSchema.nullable(),
  is_active: z.boolean(),
  max_attempts: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CollectionRuleResponse = z.infer<typeof CollectionRuleResponseSchema>;

export const CollectionRulesListResponseSchema = z.object({
  data: z.array(CollectionRuleResponseSchema),
  total: z.number(),
});

export type CollectionRulesListResponse = z.infer<typeof CollectionRulesListResponseSchema>;

// ---------------------------------------------------------------------------
// CollectionJob schemas — LGPD: sem PII
// ---------------------------------------------------------------------------

export const CollectionJobResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  payment_due_id: z.string().uuid(),
  // LGPD: apenas referência e primeiro nome do customer (sem CPF, phone)
  contract_reference: z.string().nullable(),
  customer_name: z.string().nullable(),
  rule_id: z.string().uuid(),
  rule_key: z.string().nullable(),
  template_key: z.string().nullable(),
  scheduled_at: z.string(),
  status: CollectionJobStatusSchema,
  attempt_count: z.number(),
  last_error: z.string().nullable(),
  sent_message_id: z.string().nullable(),
  idempotency_key: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type CollectionJobResponse = z.infer<typeof CollectionJobResponseSchema>;

export const CollectionJobsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: CollectionJobStatusSchema.optional(),
  rule_id: z.string().uuid().optional(),
  payment_due_id: z.string().uuid().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
});

export type CollectionJobsListQuery = z.infer<typeof CollectionJobsListQuerySchema>;

export const CollectionJobsListResponseSchema = z.object({
  data: z.array(CollectionJobResponseSchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export type CollectionJobsListResponse = z.infer<typeof CollectionJobsListResponseSchema>;
