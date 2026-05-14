// =============================================================================
// simulations/schemas.ts — Schemas Zod para o módulo de simulações de crédito.
//
// Endpoint: POST /api/simulations (UI — F2-S04).
// Reutilizado por: POST /internal/simulations (IA — F2-S05).
//
// Validações críticas:
//   - leadId: UUID obrigatório.
//   - productId: UUID obrigatório.
//   - amount: número > 0 (limites reais validados contra regra ativa).
//   - termMonths: inteiro > 0 (limites reais validados contra regra ativa).
//
// LGPD: nenhum campo contém PII — apenas IDs opacos e números financeiros.
//
// Nota: amortization NÃO é input — é determinada pela regra ativa do produto.
// =============================================================================
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Input: corpo do POST /api/simulations
// ---------------------------------------------------------------------------

export const SimulationCreateSchema = z.object({
  /** UUID do lead para o qual a simulação é criada. */
  leadId: z.string().uuid('leadId deve ser UUID'),
  /** UUID do produto de crédito ativo. */
  productId: z.string().uuid('productId deve ser UUID'),
  /**
   * Valor solicitado em R$.
   * Validação de limites (min/max da regra) ocorre na service layer.
   */
  amount: z
    .number()
    .positive('amount deve ser positivo')
    .max(10_000_000, 'amount excede o máximo suportado'),
  /**
   * Prazo em meses.
   * Validação de limites (min/max da regra) ocorre na service layer.
   */
  termMonths: z
    .number()
    .int('termMonths deve ser inteiro')
    .positive('termMonths deve ser positivo')
    .max(600, 'termMonths excede o máximo suportado'),
});

export type SimulationCreate = z.infer<typeof SimulationCreateSchema>;

// ---------------------------------------------------------------------------
// Linha de parcela (espelho de InstallmentRow do calculator)
// ---------------------------------------------------------------------------

const InstallmentRowSchema = z.object({
  number: z.number(),
  payment: z.number(),
  principal: z.number(),
  interest: z.number(),
  balance: z.number(),
});

// ---------------------------------------------------------------------------
// Response: simulação completa
// ---------------------------------------------------------------------------

export const SimulationResponseSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  product_id: z.string().uuid(),
  rule_version_id: z.string().uuid(),
  amount_requested: z.string(),
  term_months: z.number(),
  monthly_payment: z.string(),
  total_amount: z.string(),
  total_interest: z.string(),
  rate_monthly_snapshot: z.string(),
  amortization_method: z.enum(['price', 'sac']),
  /** Tabela de amortização completa (uma linha por parcela). */
  amortization_table: z.array(InstallmentRowSchema),
  origin: z.enum(['manual', 'ai', 'import']),
  created_by_user_id: z.string().uuid().nullable(),
  created_at: z.string().datetime(),
});

export type SimulationResponse = z.infer<typeof SimulationResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/leads/:id/simulations — query params + list response (F2-S08)
// ---------------------------------------------------------------------------

export const SimulationListQuerySchema = z.object({
  cursor: z.string().uuid('cursor deve ser UUID').optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v !== undefined ? parseInt(v, 10) : undefined))
    .pipe(z.number().int().positive().max(100).optional()),
});

export type SimulationListQuery = z.infer<typeof SimulationListQuerySchema>;

/**
 * Um item da lista de simulações de um lead.
 * Sem PII de lead — apenas dados financeiros + metadados de produto/regra.
 */
export const SimulationListItemSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string(),
  amount: z.number(),
  termMonths: z.number(),
  monthlyPayment: z.number(),
  totalAmount: z.number(),
  totalInterest: z.number(),
  rateMonthlySnapshot: z.number(),
  amortizationMethod: z.enum(['price', 'sac']),
  amortizationTable: z.unknown(),
  ruleVersion: z.number(),
  origin: z.enum(['manual', 'ai', 'import']),
  createdAt: z.string().datetime(),
});

export type SimulationListItem = z.infer<typeof SimulationListItemSchema>;

export const SimulationListResponseSchema = z.object({
  data: z.array(SimulationListItemSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type SimulationListResponse = z.infer<typeof SimulationListResponseSchema>;

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

/**
 * Resultado completo de uma simulação armazenado no JSONB amortization_table.
 * Inclui o método de amortização para que o consumer saiba interpretar a tabela.
 */
export interface AmortizationTableJsonb {
  method: 'price' | 'sac';
  amount: number;
  termMonths: number;
  monthlyRate: number;
  installments: Array<{
    number: number;
    payment: number;
    principal: number;
    interest: number;
    balance: number;
  }>;
  totalPayment: number;
  totalInterest: number;
}
