// =============================================================================
// features/templates/schemas.ts — Schemas Zod do frontend para templates WhatsApp.
//
// Espelha contratos do backend (F5-S09).
// Mesma validação DLP do backend para feedback client-side imediato.
//
// LGPD (doc 17 §8.5):
//   - Body do template não pode conter CPF, email ou telefone hardcoded.
//   - Validação client-side fornece feedback rápido; server valida também.
// =============================================================================
import { z } from 'zod';

// ─── DLP ──────────────────────────────────────────────────────────────────────

const CPF_REGEX = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;
const EMAIL_REGEX = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const TELEFONE_REGEX = /(\+?55\s?)?(\(?\d{2}\)?[\s-]?)(\d{4,5}[\s-]?\d{4})/;

function rejectPiiInTemplateBody(text: string, ctx: z.RefinementCtx): void {
  if (CPF_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'O body não pode conter CPF em forma bruta. Use variável {{N}}. LGPD Art. 7º.',
    });
  }
  if (EMAIL_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'O body não pode conter e-mail hardcoded. Use variável {{N}}. LGPD Art. 7º.',
    });
  }
  if (TELEFONE_REGEX.test(text)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'O body não pode conter número de telefone hardcoded. Use {{N}}. LGPD Art. 7º.',
    });
  }
}

// ─── Enums ────────────────────────────────────────────────────────────────────

export const TemplateCategorySchema = z.enum(['utility', 'marketing', 'authentication']);
export type TemplateCategory = z.infer<typeof TemplateCategorySchema>;

export const TemplateStatusSchema = z.enum(['pending', 'approved', 'rejected', 'paused']);
export type TemplateStatus = z.infer<typeof TemplateStatusSchema>;

/**
 * F5-S15 — headerType espelhado do backend (camelCase).
 * 'none'     → sem header (padrão).
 * 'text'     → header de texto (requer headerText).
 * 'document' → header de documento PDF (requer amostra).
 * 'image'    → header de imagem JPG/PNG (requer amostra).
 */
export const TemplateHeaderTypeSchema = z.enum(['none', 'text', 'document', 'image']);
export type TemplateHeaderType = z.infer<typeof TemplateHeaderTypeSchema>;

// ─── Form de criação ──────────────────────────────────────────────────────────

export const TemplateCreateFormSchema = z
  .object({
    name: z
      .string()
      .min(1, 'Nome obrigatório')
      .max(255)
      .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e underscores'),
    category: TemplateCategorySchema,
    language: z
      .string()
      .regex(/^[a-z]{2}_[A-Z]{2}$/, 'Formato inválido (ex: pt_BR)')
      .default('pt_BR'),
    body: z
      .string()
      .min(1, 'Corpo do template obrigatório')
      .max(1024, 'Máximo 1024 caracteres')
      .superRefine(rejectPiiInTemplateBody),
    variables: z.array(z.string().min(1).max(100)).default([]),

    /**
     * F5-S15 — headerType (espelha backend F5-S12).
     * Default 'none' para compatibilidade com forms existentes.
     */
    headerType: TemplateHeaderTypeSchema.default('none'),

    /**
     * F5-S15 — headerText (obrigatório quando headerType='text').
     * Máximo 60 chars, validação DLP aplicada.
     */
    headerText: z.string().min(1).max(60, 'Máximo 60 caracteres').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.headerType === 'text') {
      if (!data.headerText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerText'],
          message: "Texto do cabeçalho é obrigatório quando o tipo é 'Texto'.",
        });
      } else {
        rejectPiiInTemplateBody(data.headerText, ctx);
      }
    } else if (data.headerText !== undefined && data.headerText !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['headerText'],
        message: "Texto do cabeçalho só é permitido quando o tipo é 'Texto'.",
      });
    }
  });
export type TemplateCreateForm = z.infer<typeof TemplateCreateFormSchema>;

// ─── Form de edição ───────────────────────────────────────────────────────────

export const TemplateUpdateFormSchema = z
  .object({
    body: z.string().min(1).max(1024).superRefine(rejectPiiInTemplateBody).optional(),
    variables: z.array(z.string().min(1).max(100)).optional(),
    category: TemplateCategorySchema.optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}_[A-Z]{2}$/, 'Formato inválido (ex: pt_BR)')
      .optional(),
    /** F5-S15 — headerType (opcional ao editar, validação cruzada no backend). */
    headerType: TemplateHeaderTypeSchema.optional(),
    /** F5-S15 — headerText (validação DLP). */
    headerText: z.string().min(1).max(60, 'Máximo 60 caracteres').optional(),
  })
  .superRefine((data, ctx) => {
    // Validação cruzada somente quando ao menos um dos dois campos for fornecido.
    if (data.headerType === undefined && data.headerText === undefined) return;

    if (data.headerType === 'text') {
      if (!data.headerText) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerText'],
          message: "Texto do cabeçalho é obrigatório quando o tipo é 'Texto'.",
        });
      } else {
        rejectPiiInTemplateBody(data.headerText, ctx);
      }
    } else if (data.headerType !== undefined) {
      if (data.headerText !== undefined && data.headerText !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['headerText'],
          message: "Texto do cabeçalho só é permitido quando o tipo é 'Texto'.",
        });
      }
    } else if (data.headerText !== undefined) {
      // headerType undefined mas headerText presente — validar DLP apenas
      rejectPiiInTemplateBody(data.headerText, ctx);
    }
  });
export type TemplateUpdateForm = z.infer<typeof TemplateUpdateFormSchema>;

// ─── Filtros ──────────────────────────────────────────────────────────────────

export interface TemplateFilters {
  page?: number;
  limit?: number;
  status?: TemplateStatus;
  category?: TemplateCategory;
  language?: string;
}

// ─── Response ─────────────────────────────────────────────────────────────────

export interface TemplateResponse {
  id: string;
  organizationId: string;
  metaTemplateId: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  variables: string[];
  status: TemplateStatus;
  /** F5-S15 — tipo do cabeçalho do template. */
  headerType: TemplateHeaderType;
  /** F5-S15 — texto do cabeçalho quando headerType='text'; null nos demais. */
  headerText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateListResponse {
  data: TemplateResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
