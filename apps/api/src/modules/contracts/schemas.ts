// =============================================================================
// contracts/schemas.ts — Zod schemas do módulo de contratos (F17-S03 / F17-S04).
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
  /** UUID da análise de crédito que originou o contrato; null para contratos criados manualmente. */
  analysis_id: z.string().uuid().optional().nullable(),
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
  /** Filtrar contratos por análise de crédito que os originou (F17-S13). */
  analysis_id: z
    .string()
    .uuid()
    .optional()
    .describe('Filtrar por UUID da análise de crédito vinculada'),
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
    /** UUID da análise de crédito que originou este contrato (preenchido pelo handler de auto-contrato). */
    analysis_id: z.string().uuid().optional().nullable(),
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

// ---------------------------------------------------------------------------
// GET /api/contracts/:id/health — resposta de saúde de boletos (F17-S04)
//
// Espelha BoletoHealthSchema de @elemento/shared-schemas/contracts.ts,
// mas definido localmente para que a rota seja completamente auto-contida
// e não dependa do pacote shared-schemas em tempo de execução da API.
//
// Lógica de `health`:
//   settled:   total > 0 && percent_paid == 100 (todas pagas)
//   defaulted: overdue há >= 15 dias (overdue_15d_count > 0)
//   at_risk:   overdue mas < 15 dias (overdue_count > 0 && overdue_15d_count == 0)
//   healthy:   sem overdue (tudo paid ou pending)
// ---------------------------------------------------------------------------

export const BoletoHealthResponseSchema = z
  .object({
    contract_id: z.string().uuid().describe('UUID do contrato'),
    total_installments: z
      .number()
      .int()
      .min(0)
      .describe('Total de parcelas vinculadas ao contrato'),
    paid_count: z.number().int().min(0).describe('Parcelas pagas'),
    overdue_count: z.number().int().min(0).describe('Parcelas vencidas (qualquer prazo)'),
    pending_count: z.number().int().min(0).describe('Parcelas pendentes (dentro do prazo)'),
    /** Somatório dos valores pagos — string numérica para preservar precisão decimal. */
    paid_amount: z.string().describe('Somatório dos valores pagos (string numérica)'),
    overdue_amount: z.string().describe('Somatório dos valores vencidos (string numérica)'),
    pending_amount: z.string().describe('Somatório dos valores pendentes (string numérica)'),
    percent_paid: z
      .number()
      .min(0)
      .max(100)
      .describe('Percentual de parcelas pagas em relação ao total (0–100)'),
    health: z
      .enum(['healthy', 'at_risk', 'defaulted', 'settled'])
      .describe(
        'Indicador sintético: settled=todas pagas; defaulted=vencida ≥15d; ' +
          'at_risk=vencida <15d; healthy=sem vencimento',
      ),
  })
  .openapi({
    example: {
      contract_id: 'a0000001-0000-0000-0000-000000000001',
      total_installments: 24,
      paid_count: 12,
      overdue_count: 1,
      pending_count: 11,
      paid_amount: '7500.00',
      overdue_amount: '625.00',
      pending_amount: '6875.00',
      percent_paid: 50,
      health: 'at_risk',
    },
  });

export type BoletoHealthResponse = z.infer<typeof BoletoHealthResponseSchema>;

// ---------------------------------------------------------------------------
// AutoContractDraftInput — input tipado para o handler de auto-contrato (F17-S13)
//
// Não é um schema Zod exposto via HTTP — é um tipo interno do handler/repository.
// Os campos refletem os dados que chegam da análise de crédito aprovada.
// ---------------------------------------------------------------------------

/**
 * Input interno para criação de contrato draft automático a partir de análise aprovada.
 * Usado pelo handler auto-contract-from-analysis e pelo repository.
 * LGPD: nenhum campo contém PII bruta — apenas IDs opacos e dados financeiros operacionais.
 */
export interface AutoContractDraftInput {
  organizationId: string;
  /** UUID do cliente titular — ID opaco, não PII direta. */
  customerId: string;
  /** Referência textual gerada automaticamente — formato ANA-{ano}-{analysisId-prefix}. */
  contractReference: string;
  /** Valor aprovado em string numérica (numeric do DB) — dado financeiro operacional. */
  principalAmount: string;
  /** Prazo aprovado em meses. */
  termMonths: number;
  /** Taxa mensal aprovada (string numérica) ou null se não informada. */
  monthlyRateSnapshot: string | null;
  /** UUID da análise de crédito que originou este contrato. */
  analysisId: string;
}
