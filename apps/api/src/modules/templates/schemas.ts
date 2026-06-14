// =============================================================================
// templates/schemas.ts — Schemas Zod para gestão de templates WhatsApp Meta.
//
// Contexto: F5-S09, F5-S12.
//
// LGPD (doc 17 §8.5):
//   - O body do template usa placeholders {{1}}, {{2}} (sem PII bruta).
//   - headerText também validado pelo mesmo DLP — nenhum texto fixo de header
//     pode conter CPF, email ou telefone hardcoded.
//   - Regex defensiva bloqueia PII bruta no body e no headerText.
//   - PR que remover a validação DLP é bloqueado.
//
// F5-S12 — header de mídia:
//   - headerType: 'none'|'text'|'document'|'image'|'video' (default 'none').
//   - headerText: obrigatório (e com DLP) somente quando headerType='text'.
//   - headerType de mídia (document/image/video): headerText ausente;
//     exige amostra para submissão (validada pelo service via uploadSampleForTemplate).
//   - Validação cruzada via superRefine.
//   - Gate: templates.media.enabled (verificado no service, não no schema).
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

/**
 * Tipos de header de template WhatsApp.
 * 'none'     → sem cabeçalho (padrão histórico — body-only).
 * 'text'     → cabeçalho de texto (requer headerText).
 * 'document' → cabeçalho de documento PDF (requer amostra no submit).
 * 'image'    → cabeçalho de imagem JPG/PNG (requer amostra no submit).
 *
 * Nota: 'video' foi removido do MVP — a allowlist de MIME do metaClient não inclui
 * video/mp4 nesta versão, o que causaria 502 confuso ao submeter para a Meta.
 * Reintroduzir em slot futuro quando o suporte completo estiver implementado.
 */
export const TemplateHeaderTypeEnum = z.enum(['none', 'text', 'document', 'image']);
export type TemplateHeaderType = z.infer<typeof TemplateHeaderTypeEnum>;

/** Subconjunto de header types que requerem upload de amostra de mídia. */
export const MEDIA_HEADER_TYPES: readonly TemplateHeaderType[] = ['document', 'image'];

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

export const TemplateCreateSchema = z
  .object({
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

    /**
     * Tipo do cabeçalho (header) do template.
     * 'none'     → sem header (padrão).
     * 'text'     → header de texto; headerText é obrigatório.
     * 'document' → PDF; exige amostra (campo sampleUpload no multipart).
     * 'image'    → imagem; idem.
     */
    headerType: TemplateHeaderTypeEnum.default('none'),

    /**
     * Texto do header quando headerType='text'. DLP impede PII bruta.
     * Ausente/nulo quando headerType ≠ 'text'.
     */
    headerText: z.string().min(1).max(60).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.headerType === 'text') {
      if (!data.headerText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerText'],
          message: "headerText é obrigatório quando headerType='text'.",
        });
      } else {
        rejectPiiInTemplateBody(data.headerText, ctx);
      }
    } else if (data.headerText !== undefined && data.headerText !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['headerText'],
        message: "headerText só é permitido quando headerType='text'.",
      });
    }
  });
export type TemplateCreate = z.infer<typeof TemplateCreateSchema>;

// ---------------------------------------------------------------------------
// Body de edição (somente pending/rejected)
// ---------------------------------------------------------------------------

export const TemplateUpdateSchema = z
  .object({
    body: z.string().min(1).max(1024).superRefine(rejectPiiInTemplateBody).optional(),
    variables: z.array(z.string().min(1).max(100)).optional(),
    category: TemplateCategoryEnum.optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}_[A-Z]{2}$/, 'Idioma deve seguir formato ll_CC (ex: pt_BR, en_US)')
      .optional(),
    /**
     * Altera o tipo de header. Restrito a templates pending/rejected
     * (mesma regra do body — validada no service).
     */
    headerType: TemplateHeaderTypeEnum.optional(),
    /**
     * Texto do header quando headerType='text'. DLP impede PII bruta.
     * Ausente/nulo para outros headerTypes.
     */
    headerText: z.string().min(1).max(60).optional(),
  })
  .superRefine((data, ctx) => {
    // Valida coerência headerType/headerText somente quando ao menos um dos dois é fornecido.
    // Quando nenhum é fornecido, a regra é validada no service (dados existentes do banco).
    if (data.headerType === undefined && data.headerText === undefined) return;

    if (data.headerType === 'text') {
      if (!data.headerText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerText'],
          message: "headerText é obrigatório quando headerType='text'.",
        });
      } else {
        rejectPiiInTemplateBody(data.headerText, ctx);
      }
    } else if (data.headerType !== undefined) {
      // Tipo de mídia ('document'/'image'/'video') ou 'none': headerText deve estar ausente
      if (data.headerText !== undefined && data.headerText !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerText'],
          message: "headerText só é permitido quando headerType='text'.",
        });
      }
    } else {
      // data.headerType === undefined e data.headerText está presente — DLP apenas
      if (data.headerText !== undefined) {
        rejectPiiInTemplateBody(data.headerText, ctx);
      }
    }
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
  /** Tipo do cabeçalho do template (F5-S12). */
  headerType: TemplateHeaderTypeEnum,
  /** Texto do cabeçalho quando headerType='text'; nulo nos demais. */
  headerText: z.string().nullable(),
  // headerHandle (token opaco da Meta) foi removido da resposta pública —
  // o frontend não precisa desse handle e expô-lo aumenta a superfície de ataque.
  // O handle continua persistido no banco para resubmissões internas.
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
