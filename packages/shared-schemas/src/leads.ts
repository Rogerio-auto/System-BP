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
//   cnpj é dado de PJ — texto claro, tratado com cuidado em logs (F14-S01 D1).
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

/**
 * Schema base de create — objeto Zod puro sem refinamentos.
 * Exportado para permitir que LeadUpdateSchema reutilize via .omit().partial()
 * sem herdar o superRefine de email-obrigatório-no-manual (que não se aplica
 * a updates parciais, onde source pode não ser informado).
 */
export const LeadCreateBaseSchema = z.object({
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

  /** Email opcional na maioria das origens. Obrigatório quando source='manual'. LGPD: PII. */
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

  /**
   * CNPJ da empresa (lead pessoa jurídica).
   * Aceita formato com máscara (00.000.000/0000-00) ou somente dígitos (14).
   * Validação de dígito verificador não é realizada (D1: texto claro no DB).
   * null = lead pessoa física ou CNPJ não informado.
   */
  cnpj: z
    .string()
    .regex(
      /^(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})$/,
      'CNPJ inválido — use 14 dígitos ou formato 00.000.000/0000-00',
    )
    .optional()
    .nullable(),

  /**
   * Razão social da empresa (lead pessoa jurídica).
   * null = lead pessoa física ou razão social não informada.
   */
  legal_name: z.string().min(1).max(255).optional().nullable(),
});

/**
 * Schema de create com regras de negócio cross-field.
 * Adiciona superRefine: email obrigatório quando source='manual' (D2 F14-S02).
 *
 * Canal interno (getOrCreateLead / LangGraph) NÃO usa este schema — opera via
 * GetOrCreateLeadInput (service.ts), que nunca tem source='manual'. O superRefine
 * não o afeta mesmo que alguém tentasse construir um LeadCreate manual para ele.
 */
export const LeadCreateSchema = LeadCreateBaseSchema.superRefine((data, ctx) => {
  // Email obrigatório no cadastro manual (D2 F14-S02).
  // Origens automáticas (whatsapp, import, chatwoot, api) coletam o email
  // progressivamente ao longo do atendimento — pode ser null no primeiro contato.
  if (data.source === 'manual' && (data.email === null || data.email === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['email'],
      message: 'Email é obrigatório para cadastro manual',
    });
  }
});

export type LeadCreate = z.infer<typeof LeadCreateSchema>;

// ---------------------------------------------------------------------------
// Update (partial)
// ---------------------------------------------------------------------------

export const LeadUpdateSchema = LeadCreateBaseSchema.omit({
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
  /**
   * Nullable desde F3-S01: o agente IA cria leads antes de identificar a cidade.
   * O nó identify_city preenche posteriormente via PATCH /internal/leads/:id.
   */
  city_id: z.string().uuid().nullable(),
  /** Nome da cidade (derivado via join no service). null = sem cidade. (F13-S03) */
  city_name: z.string().nullable(),
  /** ID do card no Kanban — permite mudar o estágio pelo CRM. null = sem card. (F13-S03) */
  kanban_card_id: z.string().uuid().nullable(),
  /** Estágio atual no Kanban (gestão interna). null = sem card no board. (F13-S03) */
  kanban_stage: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /**
   * ID do customer associado a este lead (F17-S08).
   * Não-null apenas quando o lead está em status 'closed_won' e foi convertido
   * em cliente. Deriva de customers.primary_lead_id via LEFT JOIN.
   * O frontend usa este campo para navegar à ficha do cliente (GET /customers/:id/overview).
   */
  customer_id: z
    .string()
    .uuid()
    .nullable()
    .describe('ID do customer convertido; null quando lead ainda não foi fechado'),
  agent_id: z.string().uuid().nullable(),
  name: z.string(),
  /** LGPD: PII — sempre presente para uso do frontend. Coberto por pino.redact. */
  phone_e164: z.string(),
  source: LeadSourceSchema,
  status: LeadStatusSchema,
  email: z.string().nullable(),
  notes: z.string().nullable(),
  metadata: z.record(z.unknown()),
  /** CNPJ da empresa (lead PJ). null = lead PF ou CNPJ não informado. */
  cnpj: z.string().nullable(),
  /** Razão social da empresa (lead PJ). null = lead PF ou não informada. */
  legal_name: z.string().nullable(),
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
