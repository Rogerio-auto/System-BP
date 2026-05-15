// =============================================================================
// hooks/simulator/types.ts — Tipos do módulo de simulação de crédito (F2-S06).
//
// Alinhados com POST /api/simulations (F2-S04) e GET /api/credit-products (F2-S03).
// Amortização: tabela Price (parcelas constantes) calculada via resposta do backend.
//
// UNIDADE MONETÁRIA: tudo em REAIS (decimal com 2 casas), consistente com o
// backend (numeric(14,2)). Nunca centavos neste módulo.
//
// CONTRATO (F2-S11):
//   Request  → camelCase (leadId/productId/amount/termMonths)
//   Response → snake_case top-level; monetários como string; tabela usa number/payment
// =============================================================================

// ─── Produto de Crédito ───────────────────────────────────────────────────────

/**
 * Regra ativa de um produto de crédito.
 * Vinda do backend via GET /api/credit-products.
 */
export interface ProductRule {
  id: string;
  min_amount: number; // reais — ex: 5000.00 = R$ 5.000,00
  max_amount: number; // reais — ex: 30000.00 = R$ 30.000,00
  min_term_months: number;
  max_term_months: number;
  interest_rate_monthly: number; // ex: 0.0199 = 1.99%/mês
  city_id: string | null; // null = global
}

export interface CreditProduct {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  active_rule: ProductRule | null;
}

export interface CreditProductListResponse {
  data: CreditProduct[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ─── Simulação — Request ──────────────────────────────────────────────────────

/**
 * Body do POST /api/simulations.
 * camelCase — espelha SimulationCreateSchema do backend (F2-S11).
 */
export interface SimulationBody {
  leadId: string;
  productId: string;
  amount: number; // reais
  termMonths: number;
}

// ─── Simulação — Response ─────────────────────────────────────────────────────

/**
 * Linha da tabela de amortização Price/SAC.
 * Vinda do backend no campo amortization_table[].
 * Campos espelham InstallmentRowSchema do backend: number/payment/principal/interest/balance.
 */
export interface AmortizationRow {
  number: number; // número da parcela
  principal: number; // reais
  interest: number; // reais
  payment: number; // reais — parcela total (era "installment" no shape antigo)
  balance: number; // reais — saldo devedor ao final do mês
}

/**
 * Resultado de simulação retornado pelo backend, após normalização de strings→number.
 *
 * O backend retorna monetários como string ("5000.00") — o useSimulate normaliza
 * para number uma vez, e toda a UI trabalha com number.
 *
 * Campos snake_case espelham SimulationResponseSchema do backend (F2-S11).
 */
export interface SimulationResult {
  id: string;
  organization_id: string;
  lead_id: string;
  product_id: string;
  rule_version_id: string;
  amount_requested: number; // reais (normalizado de string pelo useSimulate)
  term_months: number;
  monthly_payment: number; // reais (normalizado de string — parcela mensal)
  total_amount: number; // reais (normalizado de string)
  total_interest: number; // reais (normalizado de string)
  rate_monthly_snapshot: number; // ex: 0.0199 (normalizado de string)
  amortization_method: 'price' | 'sac';
  amortization_table: AmortizationRow[];
  origin: 'manual' | 'ai' | 'import';
  created_by_user_id: string | null;
  created_at: string;
}

// ─── Formulário (estado interno) ──────────────────────────────────────────────

/**
 * Valores do formulário React Hook Form.
 * amount é number (input type="number" com valueAsNumber).
 */
export interface SimulatorFormValues {
  leadId: string;
  productId: string;
  amount: number; // reais — input type="number", digitar 30000 = R$ 30.000
  termMonths: string; // string → number na validação
}

// ─── Formatadores ─────────────────────────────────────────────────────────────

/**
 * Converte reais (float com 2 casas) para string BRL formatada: R$ 1.000,00
 *
 * Unidade: REAIS. Ex: formatBRL(5000) → "R$ 5.000,00"
 */
export function formatBRL(reais: number): string {
  return reais.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

/**
 * Formata taxa mensal para exibição: 0.0199 → "1,99% a.m."
 */
export function formatRate(rate: number): string {
  return `${(rate * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}% a.m.`;
}
