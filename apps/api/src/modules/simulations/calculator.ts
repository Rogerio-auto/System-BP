// =============================================================================
// simulations/calculator.ts — Cálculo puro de simulações Price e SAC.
//
// IMPORTANTE: este módulo é estritamente puro — sem efeitos colaterais.
// Não importa Drizzle, Fastify, db, logger, fs nem qualquer infraestrutura.
// Testável em isolamento com Vitest sem configuração de banco ou servidor.
//
// Fórmulas (doc 05 §"Crédito"):
//   Price — PMT = P * i*(1+i)^n / ((1+i)^n - 1)  [caso i=0: PMT = P/n]
//   SAC   — principal_k = P/n (constante); juros sobre saldo devedor
//
// Arredondamento: Math.round(v * 100) / 100 em todos os campos numéricos.
// Resíduo: diferença de arredondamento acumulada é ajustada na última parcela,
//   garantindo que sum(principal) === amount exato.
// =============================================================================

import type { InstallmentRow, SimulationInput, SimulationResult } from './types.js';

// -----------------------------------------------------------------------------
// Utilitários internos
// -----------------------------------------------------------------------------

/** Arredonda para 2 casas decimais. */
function r2(value: number): number {
  return Math.round(value * 100) / 100;
}

// -----------------------------------------------------------------------------
// Gerador de tabela Price
// -----------------------------------------------------------------------------

function buildPriceTable(
  amount: number,
  termMonths: number,
  monthlyRate: number,
): InstallmentRow[] {
  // PMT = P * i*(1+i)^n / ((1+i)^n - 1)
  // Caso especial: taxa zero → PMT = P / n
  const pmt: number =
    monthlyRate === 0
      ? amount / termMonths
      : (amount * (monthlyRate * Math.pow(1 + monthlyRate, termMonths))) /
        (Math.pow(1 + monthlyRate, termMonths) - 1);

  const rows: InstallmentRow[] = [];
  let balance = amount;
  let principalAccumulated = 0;

  for (let k = 1; k <= termMonths; k++) {
    const interest = r2(balance * monthlyRate);
    let principal = r2(pmt - interest);
    let payment = r2(pmt);

    // Ajuste da última parcela: garante sum(principal) === amount exato.
    // Qualquer resíduo de arredondamento vai para a última linha.
    if (k === termMonths) {
      principal = r2(amount - principalAccumulated);
      payment = r2(principal + interest);
    }

    balance = r2(balance - principal);
    principalAccumulated = r2(principalAccumulated + principal);

    rows.push({ number: k, payment, principal, interest, balance });
  }

  return rows;
}

// -----------------------------------------------------------------------------
// Gerador de tabela SAC
// -----------------------------------------------------------------------------

function buildSacTable(amount: number, termMonths: number, monthlyRate: number): InstallmentRow[] {
  // principal_k = P / n (constante); juros = saldo_anterior * i
  const baseAmortization = r2(amount / termMonths);

  const rows: InstallmentRow[] = [];
  let balance = amount;
  let principalAccumulated = 0;

  for (let k = 1; k <= termMonths; k++) {
    const interest = r2(balance * monthlyRate);
    let principal = baseAmortization;

    // Ajuste da última parcela: garante sum(principal) === amount exato.
    if (k === termMonths) {
      principal = r2(amount - principalAccumulated);
    }

    const payment = r2(principal + interest);
    balance = r2(balance - principal);
    principalAccumulated = r2(principalAccumulated + principal);

    rows.push({ number: k, payment, principal, interest, balance });
  }

  return rows;
}

// -----------------------------------------------------------------------------
// Função pública
// -----------------------------------------------------------------------------

/**
 * Calcula uma simulação de crédito usando o método Price ou SAC.
 *
 * @throws {Error} Se `amount` <= 0 (`"amount must be positive"`)
 * @throws {Error} Se `termMonths` <= 0 (`"termMonths must be positive integer"`)
 * @throws {Error} Se `monthlyRate` < 0 (`"monthlyRate cannot be negative"`)
 */
export function calculate(input: SimulationInput): SimulationResult {
  const { amount, termMonths, monthlyRate, method } = input;

  // Validações de guarda
  if (amount <= 0) {
    throw new Error('amount must be positive');
  }
  if (!Number.isInteger(termMonths) || termMonths <= 0) {
    throw new Error('termMonths must be positive integer');
  }
  if (monthlyRate < 0) {
    throw new Error('monthlyRate cannot be negative');
  }

  const installments =
    method === 'price'
      ? buildPriceTable(amount, termMonths, monthlyRate)
      : buildSacTable(amount, termMonths, monthlyRate);

  const totalPayment = r2(installments.reduce((acc, row) => acc + row.payment, 0));
  const totalInterest = r2(installments.reduce((acc, row) => acc + row.interest, 0));

  return {
    method,
    amount,
    termMonths,
    monthlyRate,
    installments,
    totalPayment,
    totalInterest,
  };
}
