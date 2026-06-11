// =============================================================================
// features/credit-analyses/schemas.ts — Schemas Zod do frontend para análise de crédito.
//
// Espelha contratos do backend (F4-S02) para validação client-side com RHF.
//
// LGPD (doc 17):
//   - DLP: CPF e RG brutos são rejeitados no parecer (mesmo validador do backend).
//   - Campos sensíveis nunca logados no console.
// =============================================================================

import { z } from 'zod';

// ─── Status ───────────────────────────────────────────────────────────────────

export const CreditAnalysisStatusSchema = z.enum([
  'em_analise',
  'pendente',
  'aprovado',
  'recusado',
  'cancelado',
]);

export type CreditAnalysisStatus = z.infer<typeof CreditAnalysisStatusSchema>;

// ─── DLP helper ───────────────────────────────────────────────────────────────

const CPF_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;
const RG_REGEX = /\d{1,2}\.?\d{3}\.?\d{3}-?[\dxX]/;

function rejectPiiInParecer(text: string, ctx: z.RefinementCtx): void {
  if (CPF_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'O parecer não pode conter CPF em forma bruta. ' +
        'Use referência mascarada como "CPF ***.***.***-XX". ' +
        'LGPD Art. 20 §1º.',
    });
  }
  if (RG_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'O parecer não pode conter RG em forma bruta. ' +
        'Use referência mascarada. LGPD Art. 20 §1º.',
    });
  }
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────────

export const PendenciaSchema = z.object({
  tipo: z.string().min(1).max(100),
  descricao: z.string().min(1).max(500),
  prazo: z.string().max(100).optional(),
});

export type Pendencia = z.infer<typeof PendenciaSchema>;

// ─── Formulário de criação ────────────────────────────────────────────────────

export const CreditAnalysisCreateFormSchema = z.object({
  lead_id: z.string().uuid('Lead é obrigatório'),
  simulation_id: z.string().uuid().optional().nullable(),
  parecer_text: z
    .string()
    .min(10, 'O parecer deve ter ao menos 10 caracteres')
    .max(5000, 'O parecer deve ter no máximo 5000 caracteres')
    .superRefine(rejectPiiInParecer),
  status: z.enum(['em_analise', 'pendente']).default('em_analise'),
  pendencias: z.array(PendenciaSchema).default([]),
});

export type CreditAnalysisCreateForm = z.infer<typeof CreditAnalysisCreateFormSchema>;

// ─── Formulário de nova versão ────────────────────────────────────────────────

export const CreditAnalysisVersionFormSchema = z.object({
  parecer_text: z
    .string()
    .min(10, 'O parecer deve ter ao menos 10 caracteres')
    .max(5000, 'O parecer deve ter no máximo 5000 caracteres')
    .superRefine(rejectPiiInParecer),
  status: CreditAnalysisStatusSchema,
  pendencias: z.array(PendenciaSchema).default([]),
  approved_amount: z.number().positive().optional().nullable(),
  approved_term_months: z.number().int().positive().max(600).optional().nullable(),
  approved_rate_monthly: z.number().positive().max(1).optional().nullable(),
});

export type CreditAnalysisVersionForm = z.infer<typeof CreditAnalysisVersionFormSchema>;

// ─── Formulário de decisão ────────────────────────────────────────────────────

export const CreditAnalysisDecideFormSchema = z.object({
  decision: z.enum(['aprovado', 'recusado']),
  parecer_text: z
    .string()
    .min(10, 'O parecer deve ter ao menos 10 caracteres')
    .max(5000, 'O parecer deve ter no máximo 5000 caracteres')
    .superRefine(rejectPiiInParecer),
  approved_amount: z.number().positive().optional().nullable(),
  approved_term_months: z.number().int().positive().max(600).optional().nullable(),
  approved_rate_monthly: z.number().positive().max(1).optional().nullable(),
});

export type CreditAnalysisDecideForm = z.infer<typeof CreditAnalysisDecideFormSchema>;

// ─── Formulário request-review ────────────────────────────────────────────────

export const CreditAnalysisRequestReviewFormSchema = z.object({
  reason: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .nullable()
    .superRefine((text, ctx) => {
      if (text) rejectPiiInParecer(text, ctx);
    }),
});

export type CreditAnalysisRequestReviewForm = z.infer<typeof CreditAnalysisRequestReviewFormSchema>;

// ─── Tipos de resposta da API ─────────────────────────────────────────────────

export interface AttachmentMeta {
  storage_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}

export interface CreditAnalysisVersionResponse {
  id: string;
  analysis_id: string;
  version: number;
  status: CreditAnalysisStatus;
  parecer_text: string;
  pendencias: Pendencia[];
  attachments: AttachmentMeta[];
  author_user_id: string;
  created_at: string;
}

export interface CreditAnalysisResponse {
  id: string;
  organization_id: string;
  lead_id: string;
  /** Nome do lead (PII) — exibido ao analista autorizado. null se não encontrado. */
  lead_name: string | null;
  customer_id: string | null;
  simulation_id: string | null;
  current_version_id: string | null;
  status: CreditAnalysisStatus;
  approved_amount: string | null;
  approved_term_months: number | null;
  approved_rate_monthly: string | null;
  internal_score: string | null;
  analyst_user_id: string | null;
  origin: 'manual' | 'import';
  created_at: string;
  updated_at: string;
  current_version: CreditAnalysisVersionResponse | null;
}

export interface CreditAnalysisListResponse {
  data: CreditAnalysisResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Filtros de listagem ──────────────────────────────────────────────────────

export interface CreditAnalysisFilters {
  page?: number;
  limit?: number;
  status?: CreditAnalysisStatus;
  analyst_user_id?: string;
  lead_id?: string;
}

// ─── Mapeamento status → UI ───────────────────────────────────────────────────

export type BadgeVariant = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const ANALYSIS_STATUS_META: Record<
  CreditAnalysisStatus,
  { label: string; variant: BadgeVariant }
> = {
  em_analise: { label: 'Em análise', variant: 'info' },
  pendente: { label: 'Pendente', variant: 'warning' },
  aprovado: { label: 'Aprovado', variant: 'success' },
  recusado: { label: 'Recusado', variant: 'danger' },
  cancelado: { label: 'Cancelado', variant: 'neutral' },
};

// ─── Transições válidas de status ─────────────────────────────────────────────

/**
 * Status que permitem decisão (aprovado | recusado).
 * Botão "Decidir" só aparece para estes.
 */
export const DECIDABLE_STATUSES: CreditAnalysisStatus[] = ['em_analise', 'pendente'];
