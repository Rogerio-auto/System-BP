// =============================================================================
// customers/law-firm-referral.schemas.ts — Schemas Zod do módulo de encaminhamento
// para advocacia, canal humano e canal IA (F19-S03).
//
// Endpoints cobertos:
//   POST /api/customers/:id/law-firm-referral   (canal humano — RBAC: law_firms:referral)
//   GET  /internal/law-firm-status              (LangGraph — X-Internal-Token)
//   POST /internal/customers/:id/law-firm-referral (LangGraph — X-Internal-Token)
//
// LGPD (doc 17 §8.5):
//   Respostas de /internal NÃO expõem PII do customer — apenas dados do escritório.
//   O payload do evento outbox é definido em events/types.ts (CustomerLawFirmReferredData).
//
// docs_required: false — sem .openapi() neste slot.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Params de rota: :id (customer UUID)
// ---------------------------------------------------------------------------

export const CustomerReferralParamsSchema = z.object({
  id: z.string().uuid().describe('UUID do customer a ser encaminhado'),
});

export type CustomerReferralParams = z.infer<typeof CustomerReferralParamsSchema>;

// ---------------------------------------------------------------------------
// POST /api/customers/:id/law-firm-referral — Body
// ---------------------------------------------------------------------------

/**
 * Body do encaminhamento humano.
 * `channel` é injetado pelo service como 'human' — não vem do cliente.
 */
export const CreateReferralBodySchema = z.object({
  law_firm_id: z.string().uuid().describe('UUID do escritório de advocacia destinatário'),
  notes: z
    .string()
    .max(2000)
    .optional()
    .describe('Notas sobre o encaminhamento (motivo, acordo proposto, etc.)'),
});

export type CreateReferralBody = z.infer<typeof CreateReferralBodySchema>;

// ---------------------------------------------------------------------------
// POST /api/customers/:id/law-firm-referral — Response
// ---------------------------------------------------------------------------

export const CreateReferralResponseSchema = z.object({
  ok: z.literal(true),
  referral_id: z.string().uuid().describe('UUID do encaminhamento criado'),
  cooldown_until: z
    .string()
    .datetime({ offset: true })
    .describe('ISO 8601 de quando o cooldown de 7 dias expira'),
});

export type CreateReferralResponse = z.infer<typeof CreateReferralResponseSchema>;

// ---------------------------------------------------------------------------
// GET /internal/law-firm-status — Query
// ---------------------------------------------------------------------------

export const LawFirmStatusQuerySchema = z.object({
  customer_id: z.string().uuid().describe('UUID do customer a verificar elegibilidade'),
});

export type LawFirmStatusQuery = z.infer<typeof LawFirmStatusQuerySchema>;

// ---------------------------------------------------------------------------
// GET /internal/law-firm-status — Response
//
// LGPD (doc 17 §8.5 + §12):
//   A resposta NÃO deve conter PII do customer.
//   law_firm.contact_phone é dado público de PJ — não é PII pessoal.
//   customer_id e customer PII são deliberadamente omitidos.
// ---------------------------------------------------------------------------

const LawFirmBasicSchema = z.object({
  id: z.string().uuid().describe('UUID do escritório'),
  name: z.string().describe('Nome do escritório (dado público de PJ)'),
  contact_phone: z
    .string()
    .nullable()
    .describe('Telefone público de contato do escritório (dado de PJ, não PII pessoal)'),
});

export type LawFirmBasic = z.infer<typeof LawFirmBasicSchema>;

export const LawFirmStatusResponseSchema = z.union([
  z.object({
    eligible: z.literal(true),
    law_firm: LawFirmBasicSchema,
    cooldown_until: z.null(),
    reason: z.string().describe('Motivo do status (ex: "ok")'),
  }),
  z.object({
    eligible: z.literal(false),
    law_firm: z.null(),
    cooldown_until: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .describe('ISO 8601 de expiração do cooldown, null se razão não é cooldown'),
    reason: z
      .string()
      .describe('Motivo: cooldown_active | flag_disabled | no_coverage | no_overdue_dues'),
  }),
]);

export type LawFirmStatusResponse = z.infer<typeof LawFirmStatusResponseSchema>;

// ---------------------------------------------------------------------------
// POST /internal/customers/:id/law-firm-referral — Body (canal IA)
// ---------------------------------------------------------------------------

export const CreateAiReferralBodySchema = z.object({
  law_firm_id: z.string().uuid().describe('UUID do escritório destinatário'),
  channel: z.literal('ai').describe('Canal sempre "ai" para encaminhamentos via LangGraph'),
});

export type CreateAiReferralBody = z.infer<typeof CreateAiReferralBodySchema>;

// ---------------------------------------------------------------------------
// POST /internal/customers/:id/law-firm-referral — Response (canal IA)
// ---------------------------------------------------------------------------

export const CreateAiReferralResponseSchema = z.object({
  ok: z.literal(true),
  referral_id: z.string().uuid().describe('UUID do encaminhamento criado'),
});

export type CreateAiReferralResponse = z.infer<typeof CreateAiReferralResponseSchema>;
