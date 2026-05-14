// =============================================================================
// simulations/types.ts — Tipos públicos do módulo de simulações de crédito.
//
// Este arquivo é importado por calculator.ts, e futuramente pelos routes,
// service e repository. Sem dependências externas.
// =============================================================================

/** Método de amortização suportado. */
export type AmortizationMethod = 'price' | 'sac';

/** Entrada para cálculo de simulação de crédito. */
export interface SimulationInput {
  /** Valor solicitado (deve ser > 0). */
  amount: number;
  /** Prazo em meses (deve ser inteiro > 0). */
  termMonths: number;
  /**
   * Taxa mensal decimal (deve ser >= 0).
   * Exemplo: 0.02 representa 2% ao mês.
   */
  monthlyRate: number;
  /** Método de amortização a ser utilizado. */
  method: AmortizationMethod;
}

/** Linha da tabela de amortização (uma parcela). */
export interface InstallmentRow {
  /** Número da parcela (1-based). */
  number: number;
  /** Valor total da parcela (principal + juros), arredondado a 2 casas. */
  payment: number;
  /** Valor de amortização do principal nesta parcela, arredondado a 2 casas. */
  principal: number;
  /** Valor de juros nesta parcela, arredondado a 2 casas. */
  interest: number;
  /** Saldo devedor após o pagamento desta parcela, arredondado a 2 casas. */
  balance: number;
}

/** Resultado completo de uma simulação de crédito. */
export interface SimulationResult {
  /** Método utilizado no cálculo. */
  method: AmortizationMethod;
  /** Valor financiado (igual ao `amount` do input). */
  amount: number;
  /** Prazo em meses. */
  termMonths: number;
  /** Taxa mensal decimal utilizada. */
  monthlyRate: number;
  /** Tabela de amortização com uma linha por parcela. */
  installments: InstallmentRow[];
  /** Soma total de todos os pagamentos (principal + juros). */
  totalPayment: number;
  /** Soma total dos juros pagos ao longo do contrato. */
  totalInterest: number;
}
