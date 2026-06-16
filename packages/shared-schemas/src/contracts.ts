import { z } from 'zod';

// Enum de status do contrato
export const ContractStatusSchema = z.enum([
  'draft',
  'signed',
  'active',
  'settled',
  'defaulted',
  'cancelled',
]);

// Response schema completo — espelha a tabela `contracts` (F17-S01 migration 0059)
export const ContractSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  contract_reference: z.string(),
  product_id: z.string().uuid().nullable(),
  rule_version_id: z.string().uuid().nullable(),
  /**
   * FK para a análise de crédito que originou o contrato.
   * null para contratos migrados do legado (sem análise associada).
   * optional: respostas de endpoints legados que não selecionam a coluna
   * permanecem válidas enquanto a adoção do campo é incremental.
   */
  analysis_id: z.string().uuid().optional().nullable(),
  // numeric(14,2) retornado como string para evitar float drift
  principal_amount: z.string(),
  term_months: z.number().int().positive(),
  // numeric(8,6) retornado como string para evitar float drift
  monthly_rate_snapshot: z.string().nullable(),
  status: ContractStatusSchema,
  signed_at: z.string().datetime({ offset: true }).nullable(),
  // date ISO (YYYY-MM-DD)
  first_due_date: z.string().nullable(),
  last_due_date: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

// Input para criação (via importação ou assinatura — sempre pelo sistema, nunca pelo cliente direto)
export const ContractCreateSchema = z.object({
  customer_id: z.string().uuid(),
  contract_reference: z.string().min(1).max(100),
  product_id: z.string().uuid().optional().nullable(),
  rule_version_id: z.string().uuid().optional().nullable(),
  /**
   * FK para a análise de crédito que originou o contrato.
   * Omissível: contratos criados manualmente ou importados do legado não têm análise.
   */
  analysis_id: z.string().uuid().optional().nullable(),
  // Aceita inteiro ou decimal com até 2 casas (ex: "5000" ou "5000.00")
  principal_amount: z.string().regex(/^\d+(\.\d{1,2})?$/, {
    message: 'principal_amount deve ser um número com até 2 casas decimais',
  }),
  term_months: z.number().int().min(1).max(360),
  monthly_rate_snapshot: z.string().optional().nullable(),
  // date ISO (YYYY-MM-DD)
  first_due_date: z.string().optional().nullable(),
});

// Assinatura de contrato (transição draft → signed → active)
export const ContractSignSchema = z.object({
  // Se omitido, o backend usa now(). Aceita offset explícito para importações históricas.
  signed_at: z.string().datetime({ offset: true }).optional(),
});

// Saúde de boletos derivada das payment_dues do contrato
export const BoletoHealthSchema = z.object({
  contract_id: z.string().uuid(),
  total_installments: z.number().int(),
  paid_count: z.number().int(),
  overdue_count: z.number().int(),
  pending_count: z.number().int(),
  // Somatórios como string para manter precisão decimal
  paid_amount: z.string(),
  overdue_amount: z.string(),
  pending_amount: z.string(),
  // Porcentagem já paga (0–100), calculada em cima de total_installments
  percent_paid: z.number().min(0).max(100),
  // Status sintético baseado nas parcelas:
  // - settled:  todas pagas
  // - defaulted: ≥1 parcela overdue
  // - at_risk:   pending mas ainda dentro do prazo com histórico de atraso
  // - healthy:   sem pendências em atraso
  health: z.enum(['healthy', 'at_risk', 'defaulted', 'settled']),
});

// Visão consolidada do cliente — GET /api/customers/:id/overview
export const CustomerOverviewResponseSchema = z.object({
  customer: z.object({
    id: z.string().uuid(),
    organization_id: z.string().uuid(),
    name: z.string(),
    spc_status: z.enum(['none', 'pending_inclusion', 'included', 'removed']),
    spc_changed_at: z.string().datetime({ offset: true }).nullable(),
  }),
  contracts: z.array(
    ContractSchema.extend({
      boleto_health: BoletoHealthSchema.nullable(),
    }),
  ),
  recent_dues: z.array(
    z.object({
      id: z.string().uuid(),
      contract_reference: z.string(),
      installment_number: z.number().int(),
      // date ISO (YYYY-MM-DD)
      due_date: z.string(),
      amount: z.string(),
      status: z.enum(['pending', 'overdue', 'paid', 'renegotiated', 'cancelled']),
      paid_at: z.string().datetime({ offset: true }).nullable(),
    }),
  ),
});

// Tipos TypeScript derivados dos schemas acima
export type Contract = z.infer<typeof ContractSchema>;
export type ContractStatus = z.infer<typeof ContractStatusSchema>;
export type ContractCreate = z.infer<typeof ContractCreateSchema>;
export type ContractSign = z.infer<typeof ContractSignSchema>;
export type BoletoHealth = z.infer<typeof BoletoHealthSchema>;
export type CustomerOverviewResponse = z.infer<typeof CustomerOverviewResponseSchema>;
