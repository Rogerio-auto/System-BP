// =============================================================================
// leads.ts — Schemas Zod públicos do domínio de leads.
//
// Compartilhados entre frontend (React Hook Form / listagem / validação) e
// backend (routes + service). Nenhum campo de segurança interna (cpf_hash,
// cpf_encrypted, etc.) está exposto aqui.
//
// LGPD (doc 17 §8.1):
//   phone_e164 e email são PII — cobertos por pino.redact na API.
//   cpf bruto NUNCA é armazenado em texto puro — apenas cpf_hash (HMAC).
//
// Enums canônicos definidos aqui para evitar duplicação entre api e web.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const LeadSourceSchema = z.enum(['whatsapp', 'manual', 'import', 'chatwoot', 'api'], {
  errorMap: () => ({ message: 'source inválido' }),
});
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const LeadStatusSchema = z.enum(
  ['new', 'qualifying', 'simulation', 'closed_won', 'closed_lost', 'archived'],
  { errorMap: () => ({ message: 'status inválido' }) },
);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

// ---------------------------------------------------------------------------
// phone helpers
// ---------------------------------------------------------------------------

/** E.164 — +5511999999999 (10-15 dígitos após o +). */
const phoneE164Schema = z
  .string({ required_error: 'phone_e164 é obrigatório' })
  .regex(/^\+\d{10,15}$/, 'Telefone deve estar no formato E.164 (ex: +5511999999999)');

/**
 * Deriva phone_normalized a partir de phone_e164: strip do '+' inicial.
 * Resultado: somente dígitos, 10-15 chars.
 */
export function normalizePhone(phoneE164: string): string {
  return phoneE164.replace(/^\+/, '');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const LeadCreateSchema = z.object({
  /** Nome completo do lead. LGPD: PII. */
  name: z.string({ required_error: 'name é obrigatório' }).min(1).max(255),

  /** Telefone E.164. LGPD: PII. Derivado → phone_normalized no service. */
  phone_e164: phoneE164Schema,

  /** Cidade onde o lead será atendido. */
  city_id: z.string({ required_error: 'city_id é obrigatório' }).uuid('city_id deve ser UUID'),

  /** Canal de origem. */
  source: LeadSourceSchema.default('manual'),

  /** Status inicial. Default: new. */
  status: LeadStatusSchema.optional().default('new'),

  /** Email opcional. LGPD: PII. */
  email: z
    .string()
    .email('Email inválido')
    .max(255)
    .optional()
    .transform((v) => v ?? null)
    .nullable(),

  /**
   * CPF bruto (apenas dígitos ou com máscara) — opcional.
   * LGPD: NUNCA armazenado em texto puro.
   * O service deriva cpf_hash via hashDocument() e NÃO persiste o bruto.
   * Aceita "000.000.000-00" ou "00000000000".
   */
  cpf: z
    .string()
    .regex(/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/, 'CPF inválido')
    .optional()
    .nullable(),

  /** Notas livres do agente. */
  notes: z.string().max(4096).optional().nullable(),

  /**
   * Metadados livres (sem PII bruta).
   * Ex: { utm_source: "google", chatwoot_contact_id: "123" }.
   */
  metadata: z.record(z.unknown()).optional().default({}),

  /** Agente responsável pelo atendimento. Opcional no create. */
  agent_id: z.string().uuid('agent_id deve ser UUID').optional().nullable(),
});

export type LeadCreate = z.infer<typeof LeadCreateSchema>;

// ---------------------------------------------------------------------------
// Update (partial)
// ---------------------------------------------------------------------------

export const LeadUpdateSchema = LeadCreateSchema.omit({
  // phone_e164 não muda após criação — muda através de dedupe
  phone_e164: true,
  // city_id pode ser atualizado (transferência de cidade)
})
  .partial()
  .extend({
    city_id: z.string().uuid('city_id deve ser UUID').optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Pelo menos um campo deve ser fornecido para update',
  });

export type LeadUpdate = z.infer<typeof LeadUpdateSchema>;

// ---------------------------------------------------------------------------
// Response (sem PII interna, sem campos de segurança)
// ---------------------------------------------------------------------------

export const LeadResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  city_id: z.string().uuid(),
  agent_id: z.string().uuid().nullable(),
  name: z.string(),
  /** LGPD: PII — sempre presente para uso do frontend. Coberto por pino.redact. */
  phone_e164: z.string(),
  source: LeadSourceSchema,
  status: LeadStatusSchema,
  email: z.string().nullable(),
  notes: z.string().nullable(),
  metadata: z.record(z.unknown()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable(),
});

export type LeadResponse = z.infer<typeof LeadResponseSchema>;

// ---------------------------------------------------------------------------
// List / query
// ---------------------------------------------------------------------------

export const LeadListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: LeadStatusSchema.optional(),
  city_id: z.string().uuid().optional(),
  agent_id: z.string().uuid().optional(),
  source: LeadSourceSchema.optional(),
});

export type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

export const LeadListResponseSchema = z.object({
  data: z.array(LeadResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type LeadListResponse = z.infer<typeof LeadListResponseSchema>;
