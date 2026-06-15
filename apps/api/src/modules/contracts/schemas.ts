// =============================================================================
// contracts/schemas.ts — Zod schemas do módulo de contratos (F17-S03).
//
// Valida todas as bordas HTTP (query, params, body, response).
//
// LGPD: nenhum schema contém CPF, telefone ou nome completo —
//   dados de PII são acessíveis via /internal/customers/:id
//   com escopo correto. contract_reference não é PII (identificador operacional).
// =============================================================================
import 'zod-openapi/extend';

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status válidos do contrato (espelha o schema Drizzle)
// ---------------------------------------------------------------------------

export const ContractStatusSchema = z.enum([
  'draft',
  'signed',
  'active',
  'settled',
  'defaulted',
  'cancelled',
]);

export type ContractStatus = z.infer<typeof ContractStatusSchema>;

// ---------------------------------------------------------------------------
// Response — contrato completo (retornado em listagem e detalhe)
// ---------------------------------------------------------------------------

export const ContractResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  contract_reference: z.string(),
  product_id: z.string().uuid().nullable(),
  rule_version_id: z.string().uuid().nullable(),
  /** Valor principal em reais (string numérica, precisão exata). */
  principal_amount: z.string(),
  term_months: z.number().int().positive(),
  /** Taxa mensal snapshot (string numérica) ou null para contratos legados. */
  monthly_rate_snapshot: z.string().nullable(),
  status: ContractStatusSchema,
  signed_at: z
    .string()
    .nullable()
    .describe('ISO 8601 do momento da assinatura; null enquanto draft'),
  first_due_date: z.string().nullable(),
  last_due_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ContractResponse = z.infer<typeof ContractResponseSchema>;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const contractIdParamSchema = z.object({
  id: z.string().uuid().describe('UUID do contrato'),
});

export type ContractIdParam = z.infer<typeof contractIdParamSchema>;

// ---------------------------------------------------------------------------
// GET /api/contracts — query de listagem
// ---------------------------------------------------------------------------

export const ContractsListQuerySchema = z.object({
  status: ContractStatusSchema.optional().describe('Filtrar por status do contrato'),
  customer_id: z.string().uuid().optional().describe('Filtrar por cliente (UUID)'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ContractsListQuery = z.infer<typeof ContractsListQuerySchema>;

// ---------------------------------------------------------------------------
// GET /api/contracts — response de listagem
// ---------------------------------------------------------------------------

export const ContractsListResponseSchema = z.object({
  data: z.array(ContractResponseSchema),
  pagination: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export type ContractsListResponse = z.infer<typeof ContractsListResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/contracts — body de criação
// ---------------------------------------------------------------------------

export const ContractCreateBodySchema = z
  .object({
    customer_id: z.string().uuid().describe('UUID do cliente titular do contrato'),
    contract_reference: z
      .string()
      .min(1)
      .max(64)
      .describe('Referência textual do contrato — chave de negócio, não pode ser CPF'),
    product_id: z.string().uuid().optional().describe('UUID do produto de crédito (opcional)'),
    rule_version_id: z
      .string()
      .uuid()
      .optional()
      .describe('UUID da versão de regra snapshot (opcional)'),
    principal_amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Valor principal deve ser numérico com até 2 casas decimais')
      .describe('Valor principal em reais (ex: "15000.00")'),
    term_months: z
      .number()
      .int()
      .positive()
      .describe('Prazo do contrato em meses (número de parcelas)'),
    monthly_rate_snapshot: z
      .string()
      .regex(/^\d+(\.\d{1,6})?$/, 'Taxa mensal deve ser numérica com até 6 casas decimais')
      .optional()
      .describe(
        'Taxa mensal acordada, ex: "0.024500" = 2,45% a.m. (opcional para contratos legados)',
      ),
    first_due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Deve ser data no formato YYYY-MM-DD')
      .optional()
      .describe('Data de vencimento da primeira parcela (YYYY-MM-DD)'),
    last_due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Deve ser data no formato YYYY-MM-DD')
      .optional()
      .describe('Data de vencimento da última parcela (YYYY-MM-DD)'),
  })
  .openapi({
    example: {
      customer_id: 'a0000001-0000-0000-0000-000000000001',
      contract_reference: 'BP-2026-00123',
      principal_amount: '15000.00',
      term_months: 24,
      monthly_rate_snapshot: '0.024500',
    },
  });

export type ContractCreateBody = z.infer<typeof ContractCreateBodySchema>;
