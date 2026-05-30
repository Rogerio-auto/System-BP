// =============================================================================
// templates/schemas.ts — Schemas Zod para gestão de templates WhatsApp Meta.
//
// Contexto: F5-S09.
//
// LGPD (doc 17 §8.5):
//   - O body do template usa placeholders {{1}}, {{2}} (sem PII bruta).
//   - Regex defensiva bloqueia CPF, email, telefone hardcoded no body.
//   - PR que remover a validação DLP é bloqueado.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// DLP — Regex defensiva para PII bruta no body do template
// ---------------------------------------------------------------------------

/** CPF: 000.000.000-00 ou 00000000000. */
const CPF_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/** Email básico. */
const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Telefone BR: (11) 91234-5678, +55 11 91234-5678, etc. */
const TELEFONE_REGEX = /(\+?55\s?)?(\(?\d{2}\)?[\s-]?)(\d{4,5}[\s-]?\d{4})/;

function rejectPiiInTemplateBody(text: string, ctx: z.RefinementCtx): void {
  if (CPF_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'O body do template não pode conter CPF em forma bruta. ' +
        'Use variável {{N}} — ex: "seu CPF é {{1}}". LGPD Art. 7º.',
    });
  }
  if (EMAIL_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'O body do template não pode conter e-mail hardcoded. ' +
        'Use variável {{N}} se precisar referenciar e-mail. LGPD Art. 7º.',
    });
  }
  if (TELEFONE_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'O body do template não pode conter número de telefone hardcoded. ' +
        'Use variável {{N}}. LGPD Art. 7º.',
    });
  }
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const TemplateCategoryEnum = z.enum(['utility', 'marketing', 'authentication']);
export type TemplateCategory = z.infer<typeof TemplateCategoryEnum>;

export const TemplateStatusEnum = z.enum(['pending', 'approved', 'rejected', 'paused']);
export type TemplateStatus = z.infer<typeof TemplateStatusEnum>;

// ---------------------------------------------------------------------------
// Parâmetros de rota
// ---------------------------------------------------------------------------

export const TemplateIdParamSchema = z.object({
  id: z.string().uuid('Template ID deve ser um UUID válido'),
});
export type TemplateIdParam = z.infer<typeof TemplateIdParamSchema>;

// ---------------------------------------------------------------------------
// Query de listagem
// ---------------------------------------------------------------------------

export const TemplateListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: TemplateStatusEnum.optional(),
  category: TemplateCategoryEnum.optional(),
  language: z.string().optional(),
});
export type TemplateListQuery = z.infer<typeof TemplateListQuerySchema>;

// ---------------------------------------------------------------------------
// Body de criação
// ---------------------------------------------------------------------------

export const TemplateCreateSchema = z.object({
  /** Slug interno único por organização. Letras, números, underscores. */
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9_]+$/, 'name deve conter apenas letras minúsculas, números e underscores'),

  category: TemplateCategoryEnum,

  language: z
    .string()
    .regex(/^[a-z]{2}_[A-Z]{2}$/, 'Idioma deve seguir formato ll_CC (ex: pt_BR, en_US)')
    .default('pt_BR'),

  /** Corpo com placeholders {{1}}, {{2}}. Validação DLP bloqueia PII bruta. */
  body: z.string().min(1).max(1024).superRefine(rejectPiiInTemplateBody),

  /**
   * Nomes semânticos das variáveis em ordem posicional.
   * Ex: ["nome_cliente", "link_simulacao"]
   */
  variables: z.array(z.string().min(1).max(100)).default([]),
});
export type TemplateCreate = z.infer<typeof TemplateCreateSchema>;

// ---------------------------------------------------------------------------
// Body de edição (somente pending/rejected)
// ---------------------------------------------------------------------------

export const TemplateUpdateSchema = z.object({
  body: z.string().min(1).max(1024).superRefine(rejectPiiInTemplateBody).optional(),
  variables: z.array(z.string().min(1).max(100)).optional(),
  category: TemplateCategoryEnum.optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}_[A-Z]{2}$/, 'Idioma deve seguir formato ll_CC (ex: pt_BR, en_US)')
    .optional(),
});
export type TemplateUpdate = z.infer<typeof TemplateUpdateSchema>;

// ---------------------------------------------------------------------------
// Response individual
// ---------------------------------------------------------------------------

export const TemplateResponseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  metaTemplateId: z.string(),
  name: z.string(),
  category: TemplateCategoryEnum,
  language: z.string(),
  body: z.string(),
  variables: z.array(z.string()),
  status: TemplateStatusEnum,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TemplateResponse = z.infer<typeof TemplateResponseSchema>;

// ---------------------------------------------------------------------------
// Response de listagem paginada
// ---------------------------------------------------------------------------

export const TemplateListResponseSchema = z.object({
  data: z.array(TemplateResponseSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  totalPages: z.number().int().nonnegative(),
});
export type TemplateListResponse = z.infer<typeof TemplateListResponseSchema>;
