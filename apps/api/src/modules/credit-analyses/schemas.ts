// =============================================================================
// credit-analyses/schemas.ts — Schemas Zod para o módulo de análise de crédito.
//
// Contexto: F4-S02.
// Dependências: F4-S01 (credit_analyses, credit_analysis_versions tables).
//
// Cobre:
//   - Parâmetros de rota (UUID params)
//   - Bodies de criação, nova versão, decisão e request-review
//   - Queries de listagem paginada
//   - Responses tipados (análise + versão)
//
// LGPD (doc 17 §8.5, Art. 20 §1º):
//   - parecer_text: regex defensiva bloqueia CPF e RG brutos.
//     Mensagem clara ao analista para usar referência mascarada.
//   - attachments: somente metadados (storage_key, sha256, etc.).
//     Nunca URLs assinadas. Conteúdo em object storage.
//   - internal_score: campo restrito — omitido do response público.
//   - Responses nunca expõem PII bruta (lead_id é UUID opaco).
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// DLP — Regex defensiva para PII bruta (LGPD Art. 20 §1º)
// ---------------------------------------------------------------------------

/** CPF: 000.000.000-00 ou 00000000000 (com ou sem pontuação). */
const CPF_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/** RG: formatos comuns BR — 7-9 dígitos com ou sem pontuação (ex: 1.234.567-8). */
const RG_REGEX = /\d{1,2}\.?\d{3}\.?\d{3}-?[\dxX]/;

/**
 * Valida que o texto não contém CPF nem RG brutos.
 * Art. 20 §1º: pareceres de crédito podem mencionar nome e cidade,
 * mas NUNCA CPF/RG identificadores diretos em forma bruta.
 */
function rejectPiiInParecer(text: string, ctx: z.RefinementCtx): void {
  if (CPF_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'O parecer não pode conter CPF em forma bruta (ex: 000.000.000-00). ' +
        'Use referência mascarada como "CPF ***.***.***-XX" ou o número do contrato. ' +
        'LGPD Art. 20 §1º — proteção de dados do titular.',
    });
  }
  if (RG_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'O parecer não pode conter RG em forma bruta. ' +
        'Use referência mascarada ou o número do contrato. ' +
        'LGPD Art. 20 §1º — proteção de dados do titular.',
    });
  }
}

// ---------------------------------------------------------------------------
// Status válidos
// ---------------------------------------------------------------------------

export const CreditAnalysisStatusEnum = z.enum([
  'em_analise',
  'pendente',
  'aprovado',
  'recusado',
  'cancelado',
]);

export type CreditAnalysisStatus = z.infer<typeof CreditAnalysisStatusEnum>;

// ---------------------------------------------------------------------------
// Schemas de sub-estruturas
// ---------------------------------------------------------------------------

/** Pendência documental associada a um parecer. */
const PendenciaSchema = z.object({
  tipo: z.string().min(1).max(100),
  descricao: z.string().min(1).max(500),
  prazo: z.string().max(100).optional(),
});

/** Metadados de um anexo — NUNCA URL assinada ou conteúdo binário. */
const AttachmentMetaSchema = z.object({
  storage_key: z
    .string()
    .min(1)
    .max(512)
    .refine(
      (k) => k.startsWith('credit-analyses/'),
      'storage_key deve começar com "credit-analyses/<organization_id>/"',
    ),
  filename: z.string().min(1).max(255),
  mime_type: z.string().min(1).max(127),
  size_bytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024), // 50 MB
  sha256: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/, 'sha256 deve ser 64 chars hex lowercase'),
});

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const analysisIdParamSchema = z.object({
  id: z.string().uuid('id deve ser UUID'),
});

export type AnalysisIdParam = z.infer<typeof analysisIdParamSchema>;

export const leadIdParamSchema = z.object({
  leadId: z.string().uuid('leadId deve ser UUID'),
});

export type LeadIdParam = z.infer<typeof leadIdParamSchema>;

// ---------------------------------------------------------------------------
// POST /api/credit-analyses — criação de análise + 1ª versão
// ---------------------------------------------------------------------------

export const CreditAnalysisCreateSchema = z.object({
  /** UUID do lead para o qual a análise é criada. */
  lead_id: z.string().uuid('lead_id deve ser UUID'),
  /** UUID do cliente identificado (opcional — pode ser desconhecido no início). */
  customer_id: z.string().uuid('customer_id deve ser UUID').optional().nullable(),
  /** UUID da simulação que originou a análise (opcional). */
  simulation_id: z.string().uuid('simulation_id deve ser UUID').optional().nullable(),
  /** UUID do analista humano responsável (opcional no momento de criação). */
  analyst_user_id: z.string().uuid('analyst_user_id deve ser UUID').optional().nullable(),
  /** Texto do parecer inicial (mínimo 10, máximo 5000 chars). DLP ativo. */
  parecer_text: z
    .string()
    .min(10, 'parecer_text deve ter ao menos 10 caracteres')
    .max(5000, 'parecer_text deve ter no máximo 5000 caracteres')
    .superRefine(rejectPiiInParecer),
  /** Status inicial (padrão: em_analise). */
  status: z.enum(['em_analise', 'pendente']).optional().default('em_analise'),
  /** Pendências documentais associadas ao parecer inicial. */
  pendencias: z.array(PendenciaSchema).optional().default([]),
  /** Metadados de anexos vinculados ao parecer inicial. */
  attachments: z.array(AttachmentMetaSchema).optional().default([]),
  /** Origem da análise (padrão: manual). */
  origin: z.enum(['manual', 'import']).optional().default('manual'),
});

export type CreditAnalysisCreate = z.infer<typeof CreditAnalysisCreateSchema>;

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/versions — nova versão imutável
// ---------------------------------------------------------------------------

export const CreditAnalysisVersionCreateSchema = z.object({
  /** Texto do parecer. DLP ativo: CPF/RG brutos são rejeitados. */
  parecer_text: z
    .string()
    .min(10, 'parecer_text deve ter ao menos 10 caracteres')
    .max(5000, 'parecer_text deve ter no máximo 5000 caracteres')
    .superRefine(rejectPiiInParecer),
  /** Status resultante desta versão. */
  status: CreditAnalysisStatusEnum,
  /** Pendências documentais. */
  pendencias: z.array(PendenciaSchema).optional().default([]),
  /** Metadados de anexos. */
  attachments: z.array(AttachmentMetaSchema).optional().default([]),
  /** Valor aprovado em R$ (obrigatório apenas quando status=aprovado). */
  approved_amount: z.number().positive().optional().nullable(),
  /** Prazo em meses (obrigatório apenas quando status=aprovado). */
  approved_term_months: z.number().int().positive().max(600).optional().nullable(),
  /** Taxa mensal como decimal (obrigatório apenas quando status=aprovado). */
  approved_rate_monthly: z.number().positive().max(1).optional().nullable(),
});

export type CreditAnalysisVersionCreate = z.infer<typeof CreditAnalysisVersionCreateSchema>;

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/decide — promove status a aprovado/recusado
// ---------------------------------------------------------------------------

export const CreditAnalysisDecideSchema = z.object({
  /** Decisão final: aprovado ou recusado. */
  decision: z.enum(['aprovado', 'recusado']),
  /** Texto do parecer de decisão. DLP ativo. */
  parecer_text: z
    .string()
    .min(10, 'parecer_text deve ter ao menos 10 caracteres')
    .max(5000, 'parecer_text deve ter no máximo 5000 caracteres')
    .superRefine(rejectPiiInParecer),
  /** Pendências (tipicamente vazio em aprovação). */
  pendencias: z.array(PendenciaSchema).optional().default([]),
  /** Metadados de anexos. */
  attachments: z.array(AttachmentMetaSchema).optional().default([]),
  // Campos de aprovação — obrigatórios quando decision=aprovado (validado no service)
  /** Valor aprovado em R$ (obrigatório quando decision=aprovado). */
  approved_amount: z.number().positive().optional().nullable(),
  /** Prazo em meses (obrigatório quando decision=aprovado). */
  approved_term_months: z.number().int().positive().max(600).optional().nullable(),
  /** Taxa mensal como decimal 0-1 (obrigatório quando decision=aprovado). */
  approved_rate_monthly: z.number().positive().max(1).optional().nullable(),
});

export type CreditAnalysisDecide = z.infer<typeof CreditAnalysisDecideSchema>;

// ---------------------------------------------------------------------------
// POST /api/credit-analyses/:id/request-review — Art. 20 §5 LGPD
// ---------------------------------------------------------------------------

export const CreditAnalysisRequestReviewSchema = z.object({
  /**
   * Motivo da solicitação de revisão pelo titular (opcional — texto livre).
   * Permite ao titular contextualizar sua solicitação de revisão humana.
   * DLP ativo: CPF/RG brutos são rejeitados.
   */
  reason: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .nullable()
    .superRefine((text, ctx) => {
      if (text !== null && text !== undefined) {
        rejectPiiInParecer(text, ctx);
      }
    }),
});

export type CreditAnalysisRequestReview = z.infer<typeof CreditAnalysisRequestReviewSchema>;

// ---------------------------------------------------------------------------
// GET /api/credit-analyses — query params para listagem
// ---------------------------------------------------------------------------

export const CreditAnalysisListQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 1))
    .pipe(z.number().int().positive().default(1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : 20))
    .pipe(z.number().int().positive().max(100).default(20)),
  status: CreditAnalysisStatusEnum.optional(),
  analyst_user_id: z.string().uuid().optional(),
  lead_id: z.string().uuid().optional(),
});

export type CreditAnalysisListQuery = z.infer<typeof CreditAnalysisListQuerySchema>;

// ---------------------------------------------------------------------------
// Response: versão de análise (parecer)
// ---------------------------------------------------------------------------

export const CreditAnalysisVersionResponseSchema = z.object({
  id: z.string().uuid(),
  analysis_id: z.string().uuid(),
  version: z.number().int(),
  status: CreditAnalysisStatusEnum,
  /** parecer_text: presente mas coberto por pino.redact no app.ts. */
  parecer_text: z.string(),
  pendencias: z.array(PendenciaSchema),
  attachments: z.array(AttachmentMetaSchema),
  author_user_id: z.string().uuid(),
  created_at: z.string().datetime(),
});

export type CreditAnalysisVersionResponse = z.infer<typeof CreditAnalysisVersionResponseSchema>;

// ---------------------------------------------------------------------------
// Response: análise de crédito (cabeçalho + versão atual)
// ---------------------------------------------------------------------------

export const CreditAnalysisResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  /** lead_id: UUID opaco. PII indireta — pino.redact não cobre UUIDs. */
  lead_id: z.string().uuid(),
  /**
   * Nome do lead (PII) — exibido ao analista autorizado (credit_analyses:read).
   * Resolvido via JOIN com leads no service; null se o lead não for encontrado.
   */
  lead_name: z.string().nullable(),
  customer_id: z.string().uuid().nullable(),
  simulation_id: z.string().uuid().nullable(),
  current_version_id: z.string().uuid().nullable(),
  status: CreditAnalysisStatusEnum,
  /** approved_amount: string porque Drizzle retorna numeric como string. */
  approved_amount: z.string().nullable(),
  approved_term_months: z.number().int().nullable(),
  /** approved_rate_monthly: string porque Drizzle retorna numeric como string. */
  approved_rate_monthly: z.string().nullable(),
  /**
   * internal_score: RESTRITO — gated por feature flag.
   * Nunca exposto ao cliente/lead. Analistas com permissão veem via campo separado.
   * Omitido do response público (null sempre nesta rota).
   */
  internal_score: z.string().nullable(),
  analyst_user_id: z.string().uuid().nullable(),
  origin: z.enum(['manual', 'import']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** current_version: versão vigente hidratada (null se recém-criada). */
  current_version: CreditAnalysisVersionResponseSchema.nullable(),
});

export type CreditAnalysisResponse = z.infer<typeof CreditAnalysisResponseSchema>;

// ---------------------------------------------------------------------------
// Response: listagem paginada
// ---------------------------------------------------------------------------

export const CreditAnalysisListResponseSchema = z.object({
  data: z.array(CreditAnalysisResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type CreditAnalysisListResponse = z.infer<typeof CreditAnalysisListResponseSchema>;
