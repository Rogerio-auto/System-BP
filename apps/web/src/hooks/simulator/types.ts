// =============================================================================
// hooks/simulator/types.ts — Tipos do módulo de simulação de crédito (F2-S06).
//
// Alinhados com POST /api/simulations (F2-S04) e GET /api/credit-products (F2-S03).
// Amortização: tabela Price (parcelas constantes) calculada via resposta do backend.
//
// UNIDADE MONETÁRIA: tudo em REAIS (decimal com 2 casas), consistente com o
// backend (numeric(14,2)). Nunca centavos neste módulo.
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

// ─── Simulação ────────────────────────────────────────────────────────────────

/**
 * Linha da tabela de amortização Price (Price/SAC).
 * Vinda do backend na response de POST /api/simulations.
 */
export interface AmortizationRow {
  month: number;
  principal: number; // reais
  interest: number; // reais
  installment: number; // reais
  balance: number; // reais (saldo devedor ao final do mês)
}

/**
 * Resultado de simulação retornado pelo backend.
 */
export interface SimulationResult {
  id: string;
  lead_id: string;
  product_id: string;
  requested_amount: number; // reais
  term_months: number;
  interest_rate_monthly: number;
  installment_amount: number; // reais — parcela mensal
  total_amount: number; // reais — total a pagar
  total_interest: number; // reais — total de juros
  amortization_table: AmortizationRow[];
  created_at: string;
}

/**
 * Body do POST /api/simulations.
 */
export interface SimulationBody {
  lead_id: string;
  product_id: string;
  requested_amount: number; // reais
  term_months: number;
}

// ─── Formulário (estado interno) ──────────────────────────────────────────────

/**
 * Valores do formulário React Hook Form.
 * amount_display é a string formatada (R$ 1.000,00) para UX.
 * O valor exposto ao submit é reais via parseBRL(amount_display).
 */
export interface SimulatorFormValues {
  lead_id: string;
  product_id: string;
  amount_display: string; // formatado BR — convertido para reais no submit via parseBRL
  term_months: string; // string → number na validação
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
 * Converte string BRL formatada de volta para reais (float com 2 casas).
 *
 * "R$ 1.000,50" → 1000.50 (reais)
 */
export function parseBRL(display: string): number {
  // Remove símbolo R$, espaços, pontos de milhar; substitui vírgula decimal por ponto
  const clean = display.replace(/[R$\s.]/g, '').replace(',', '.');
  const value = parseFloat(clean);
  if (isNaN(value)) return 0;
  // Arredonda a 2 casas decimais para evitar floating-point noise
  return Math.round(value * 100) / 100;
}

/**
 * Aplica máscara BRL em tempo real para campos de entrada.
 *
 * Comportamento: os dígitos digitados são interpretados como centavos durante
 * a digitação (UX de "cada dígito desloca a vírgula"), mas a string resultante
 * é BRL formatado em reais. Ao ser lida por parseBRL, retorna REAIS.
 *
 * Ex: usuário digita "1000000" → exibe "R$ 10.000,00" → parseBRL retorna 10000.00
 *
 * Aceita apenas dígitos; não-dígitos são ignorados.
 */
export function maskBRL(raw: string): string {
  // Mantém apenas dígitos
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const centsInt = parseInt(digits, 10);
  if (isNaN(centsInt)) return '';
  // Interpreta dígitos como centavos para a UX de digitação progressiva,
  // depois converte para reais para formatar como BRL
  const reais = centsInt / 100;
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
