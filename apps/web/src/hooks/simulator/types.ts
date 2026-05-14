// =============================================================================
// hooks/simulator/types.ts — Tipos do módulo de simulação de crédito (F2-S06).
//
// Alinhados com POST /api/simulations (F2-S04) e GET /api/credit-products (F2-S03).
// Amortização: tabela Price (parcelas constantes) calculada via resposta do backend.
// =============================================================================

// ─── Produto de Crédito ───────────────────────────────────────────────────────

/**
 * Regra ativa de um produto de crédito.
 * Vinda do backend via GET /api/credit-products.
 */
export interface ProductRule {
  id: string;
  min_amount: number; // centavos
  max_amount: number; // centavos
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

// ─── Simulação ────────────────────────────────────────────────────────────────

/**
 * Linha da tabela de amortização Price (Price/SAC).
 * Vinda do backend na response de POST /api/simulations.
 */
export interface AmortizationRow {
  month: number;
  principal: number; // centavos
  interest: number; // centavos
  installment: number; // centavos
  balance: number; // centavos (saldo devedor ao final do mês)
}

/**
 * Resultado de simulação retornado pelo backend.
 */
export interface SimulationResult {
  id: string;
  lead_id: string;
  product_id: string;
  requested_amount: number; // centavos
  term_months: number;
  interest_rate_monthly: number;
  installment_amount: number; // centavos — parcela mensal
  total_amount: number; // centavos — total a pagar
  total_interest: number; // centavos — total de juros
  amortization_table: AmortizationRow[];
  created_at: string;
}

/**
 * Body do POST /api/simulations.
 */
export interface SimulationBody {
  lead_id: string;
  product_id: string;
  requested_amount: number; // centavos
  term_months: number;
}

// ─── Formulário (estado interno) ──────────────────────────────────────────────

/**
 * Valores do formulário React Hook Form.
 * amount está como string formatada (R$ 1.000,00) para UX.
 */
export interface SimulatorFormValues {
  lead_id: string;
  product_id: string;
  amount_display: string; // formatado BR — convertido para centavos no submit
  term_months: string; // string → number na validação
}

// ─── Formatadores ─────────────────────────────────────────────────────────────

/**
 * Converte centavos para string BRL formatada: R$ 1.000,00
 */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

/**
 * Converte string BRL formatada de volta para centavos inteiros.
 * "R$ 1.000,50" → 100050
 */
export function parseBRL(display: string): number {
  // Remove símbolo, pontos de milhar, substitui vírgula decimal
  const clean = display.replace(/[R$\s.]/g, '').replace(',', '.');
  const value = parseFloat(clean);
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}

/**
 * Aplica máscara BRL em tempo real: "1000050" → "R$ 10.000,50"
 * Aceita dígitos apenas e formata como moeda.
 */
export function maskBRL(raw: string): string {
  // Mantém apenas dígitos
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const cents = parseInt(digits, 10);
  if (isNaN(cents)) return '';
  return (cents / 100).toLocaleString('pt-BR', {
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
