// =============================================================================
// features/billing/schemas.ts — Schemas Zod frontend para cobrança (F5-S08, F5-S16).
//
// Espelha contratos do backend para validação client-side com RHF.
//
// LGPD (doc 17):
//   - PaymentDueResponse não expõe CPF — vínculo via customer_id.
//   - customer_name: apenas primeiro nome (backend retorna split_part).
//   - CollectionJobResponse não expõe PII direta.
//   - BoletoResponse inclui campos PII indiretos (url, linha, pix) — nunca
//     logar, não persistir em localStorage. Exposto apenas via endpoint dedicado.
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
// CollectionRule form schema (React Hook Form + Zod)
// ---------------------------------------------------------------------------

export const CollectionRuleFormSchema = z.object({
  key: z
    .string()
    .min(1, 'Chave obrigatória')
    .max(50, 'Máximo 50 caracteres')
    .regex(/^[a-z0-9_-]+$/, 'Apenas letras minúsculas, números, hífens e underscores'),
  name: z.string().min(1, 'Nome obrigatório').max(200, 'Máximo 200 caracteres'),
  trigger_type: CollectionTriggerTypeSchema,
  wait_hours: z
    .number({ invalid_type_error: 'Deve ser um número' })
    .int('Deve ser inteiro')
    .min(-8760, 'Mínimo -1 ano')
    .max(8760, 'Máximo 1 ano'),
  template_id: z.string().uuid('Template obrigatório'),
  applies_to_status: PaymentDueStatusSchema.nullable().optional(),
  is_active: z.boolean().optional().default(false),
  max_attempts: z.number().int().min(1).max(10).optional().default(3),
  // F20-S07: canal de envio opcional. null = usar canal padrão da organização.
  channel_id: z.string().uuid().nullable().optional(),
});

export type CollectionRuleForm = z.infer<typeof CollectionRuleFormSchema>;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

// LGPD: payment_due sem CPF — apenas customer_id e primeiro nome
export interface PaymentDueResponse {
  id: string;
  organization_id: string;
  customer_id: string;
  customer_name: string | null;
  contract_reference: string;
  installment_number: number;
  due_date: string;
  amount: string;
  status: PaymentDueStatus;
  paid_at: string | null;
  origin: 'manual' | 'import';
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Boleto (F5-S16) — indicadores sem PII.
  // Detalhes (url, linha, pix) ficam no BoletoResponse via endpoint dedicado.
  has_boleto: boolean;
  boleto_filename: string | null;
}

export interface PaymentDuesListResponse {
  data: PaymentDueResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface PaymentDuesFilters {
  page?: number;
  limit?: number;
  status?: PaymentDueStatus;
  customer_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface CollectionRuleResponse {
  id: string;
  organization_id: string;
  key: string;
  name: string;
  trigger_type: CollectionTriggerType;
  wait_hours: number;
  template_id: string;
  applies_to_status: PaymentDueStatus | null;
  is_active: boolean;
  max_attempts: number;
  // F20-S07: canal de envio. null = canal padrão da organização.
  channel_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionRulesListResponse {
  data: CollectionRuleResponse[];
  total: number;
}

// LGPD: job response sem PII — apenas contract_reference e primeiro nome do customer
export interface CollectionJobResponse {
  id: string;
  organization_id: string;
  payment_due_id: string;
  contract_reference: string | null;
  customer_name: string | null;
  rule_id: string;
  rule_key: string | null;
  template_key: string | null;
  scheduled_at: string;
  status: CollectionJobStatus;
  attempt_count: number;
  last_error: string | null;
  sent_message_id: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface CollectionJobsListResponse {
  data: CollectionJobResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CollectionJobsFilters {
  page?: number;
  limit?: number;
  status?: CollectionJobStatus;
  rule_id?: string;
  payment_due_id?: string;
  date_from?: string;
  date_to?: string;
}

// ---------------------------------------------------------------------------
// UI metadata — status badges
// ---------------------------------------------------------------------------

export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const DUE_STATUS_META: Record<PaymentDueStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pendente', variant: 'info' },
  overdue: { label: 'Vencida', variant: 'danger' },
  paid: { label: 'Paga', variant: 'success' },
  renegotiated: { label: 'Renegociada', variant: 'warning' },
  cancelled: { label: 'Cancelada', variant: 'neutral' },
};

export const JOB_STATUS_META: Record<
  CollectionJobStatus,
  { label: string; variant: BadgeVariant }
> = {
  scheduled: { label: 'Agendado', variant: 'info' },
  triggered: { label: 'Em envio', variant: 'warning' },
  sent: { label: 'Enviado', variant: 'success' },
  failed: { label: 'Falhou', variant: 'danger' },
  cancelled: { label: 'Cancelado', variant: 'neutral' },
  paid_before_send: { label: 'Pago antes do envio', variant: 'success' },
};

export const TRIGGER_TYPE_LABEL: Record<CollectionTriggerType, string> = {
  days_before_due: 'Dias antes do vencimento',
  days_after_due: 'Dias após o vencimento',
};

export const CANCELLABLE_JOB_STATUSES: CollectionJobStatus[] = ['scheduled'];

export const MARKABLE_DUE_STATUSES: PaymentDueStatus[] = ['pending', 'overdue'];

// ---------------------------------------------------------------------------
// Boleto schemas (F5-S16)
//
// Espelha BoletoAttachReferenceBodySchema + BoletoResponseSchema do backend.
//
// LGPD §14.2: boleto_url / boleto_digitable_line / pix_copia_cola são PII
//   indireta. Nunca logar, nunca persistir em localStorage.
// ---------------------------------------------------------------------------

/**
 * Form schema para modo referência (URL + linha digitável + PIX).
 * Espelha BoletoAttachReferenceBodySchema do backend (F5-S13).
 * Requer ao menos um dos três campos.
 */
export const BoletoReferenceFormSchema = z
  .object({
    boletoUrl: z
      .string()
      .url('URL inválida')
      .max(2048, 'URL muito longa')
      .refine((u) => u.startsWith('https://'), 'A URL deve usar https://')
      .optional()
      .or(z.literal('')),
    digitableLine: z.string().max(200, 'Linha digitável muito longa').optional().or(z.literal('')),
    pixCopiaCola: z.string().max(1000, 'PIX muito longo').optional().or(z.literal('')),
    filename: z
      .string()
      .max(255, 'Nome muito longo')
      .regex(/^[^/\\<>:"|?*]+$/, 'Nome contém caracteres inválidos')
      .optional()
      .or(z.literal('')),
  })
  .refine(
    (b) => {
      const hasUrl = Boolean(b.boletoUrl);
      const hasLine = Boolean(b.digitableLine);
      const hasPix = Boolean(b.pixCopiaCola);
      return hasUrl || hasLine || hasPix;
    },
    { message: 'Preencha ao menos URL, linha digitável ou PIX copia-e-cola' },
  );

export type BoletoReferenceForm = z.infer<typeof BoletoReferenceFormSchema>;

/**
 * Resposta do endpoint POST/DELETE /payment-dues/:id/boleto.
 * LGPD: boleto_url / boleto_digitable_line / pix_copia_cola nunca devem ir
 * para localStorage, logs ou estado persistido fora do componente.
 */
export interface BoletoResponse {
  payment_due_id: string;
  boleto_url: string | null;
  boleto_media_id: string | null;
  boleto_media_expires_at: string | null;
  boleto_digitable_line: string | null;
  pix_copia_cola: string | null;
  boleto_filename: string | null;
  boleto_attached_at: string | null;
  has_boleto: boolean;
}

/** Tamanho máximo de upload (10 MB — espelha o backend). */
export const BOLETO_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Tipos MIME aceitos para upload. */
export const BOLETO_ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type BoletoAcceptedMimeType = (typeof BOLETO_ACCEPTED_MIME_TYPES)[number];
