// =============================================================================
// features/followup/schemas.ts — Schemas Zod frontend para follow-up (F5-S05).
//
// Espelha contratos do backend para validação client-side com RHF.
//
// LGPD (doc 17):
//   - FollowupJobResponse não expõe phone, cpf, email.
//   - lead_name: apenas primeiro nome (backend retorna split_part).
//   - Sem conteúdo de mensagem — apenas template_key.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const TriggerTypeSchema = z.enum(['stage_inactivity', 'event_based']);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

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
// Rule form schema (React Hook Form + Zod)
// ---------------------------------------------------------------------------

export const FollowupRuleFormSchema = z.object({
  key: z
    .string()
    .min(1, 'Chave obrigatória')
    .max(50, 'Máximo 50 caracteres')
    .regex(/^[a-z0-9_-]+$/, 'Apenas letras minúsculas, números, hífens e underscores'),
  name: z.string().min(1, 'Nome obrigatório').max(200, 'Máximo 200 caracteres'),
  trigger_type: TriggerTypeSchema,
  wait_hours: z
    .number({ invalid_type_error: 'Horas de espera devem ser um número' })
    .int('Deve ser número inteiro')
    .positive('Deve ser maior que 0')
    .max(8760, 'Máximo 1 ano (8760h)'),
  template_id: z.string().uuid('Template obrigatório'),
  applies_to_stage: z.string().max(100).nullable().optional(),
  applies_to_outcome: z.string().max(100).nullable().optional(),
  is_active: z.boolean().optional().default(false),
  max_attempts: z
    .number({ invalid_type_error: 'Tentativas devem ser um número' })
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(3),
});

export type FollowupRuleForm = z.infer<typeof FollowupRuleFormSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface FollowupRuleResponse {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  trigger_type: TriggerType;
  wait_hours: number;
  template_id: string;
  applies_to_stage: string | null;
  applies_to_outcome: string | null;
  is_active: boolean;
  max_attempts: number;
  created_at: string;
  updated_at: string;
}

export interface FollowupRulesListResponse {
  data: FollowupRuleResponse[];
  total: number;
}

// LGPD: job response sem PII — apenas lead_name curto e template_key
export interface FollowupJobResponse {
  id: string;
  organization_id: string;
  lead_id: string;
  lead_name: string | null;
  rule_id: string;
  rule_key: string | null;
  template_key: string | null;
  scheduled_at: string;
  status: FollowupJobStatus;
  attempt_count: number;
  last_error: string | null;
  sent_message_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface FollowupJobsListResponse {
  data: FollowupJobResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface FollowupJobsFilters {
  page?: number;
  limit?: number;
  status?: FollowupJobStatus;
  rule_id?: string;
  lead_id?: string;
  date_from?: string;
  date_to?: string;
}

// ---------------------------------------------------------------------------
// UI metadata — status badges
// ---------------------------------------------------------------------------

export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const JOB_STATUS_META: Record<FollowupJobStatus, { label: string; variant: BadgeVariant }> =
  {
    scheduled: { label: 'Agendado', variant: 'info' },
    triggered: { label: 'Em envio', variant: 'warning' },
    sent: { label: 'Enviado', variant: 'success' },
    failed: { label: 'Falhou', variant: 'danger' },
    cancelled: { label: 'Cancelado', variant: 'neutral' },
    customer_replied: { label: 'Cliente respondeu', variant: 'success' },
  };

export const TRIGGER_TYPE_LABEL: Record<TriggerType, string> = {
  stage_inactivity: 'Inatividade no estágio',
  event_based: 'Baseado em evento',
};

export const CANCELLABLE_STATUSES: FollowupJobStatus[] = ['scheduled'];
