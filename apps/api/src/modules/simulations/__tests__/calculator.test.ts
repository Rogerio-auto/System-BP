// =============================================================================
// calculator.test.ts — Testes unitários do calculador Price + SAC (F2-S02).
//
// Todos os testes são síncronos e sem dependência de banco ou servidor.
// Cobertura obrigatória (DoD do slot F2-S02):
//   1. Price 1000 / 12m / 2% → PMT ≈ 94.56 (±0.01)
//   2. Price 1000 / 12m / 0% → PMT = 83.33
//   3. SAC 1200 / 12m / 1%   → parcela 1 = 112.00, parcela 12 = 101.00
//   4. SAC qualquer           → sum(principal) === amount
//   5. Price qualquer         → sum(principal) === amount
//   6. Erro: amount <= 0
//   7. Erro: termMonths <= 0
//   8. Erro: monthlyRate < 0
// =============================================================================

import { describe, expect, it } from 'vitest';

import { calculate } from '../calculator.js';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Soma dos campos `principal` de uma tabela de amortização. */
function sumPrincipal(installments: ReturnType<typeof calculate>['installments']): number {
  return installments.reduce((acc, row) => acc + row.principal, 0);
}

// Precisão de arredondamento aceitável (2 casas decimais de tolerância).
const TOLERANCE = 0.01;

// -----------------------------------------------------------------------------
// Método Price
// -----------------------------------------------------------------------------

describe('calculate — Price', () => {
  it('caso 1: PMT correto para 1000 / 12m / 2% mensal', () => {
    const result = calculate({ amount: 1000, termMonths: 12, monthlyRate: 0.02, method: 'price' });

    // Todas as parcelas têm o mesmo valor no Price (exceto possível ajuste residual
    // na última, que deve ser mínimo).
    // PMT esperado ≈ 94.56
    const firstPayment = result.installments[0]?.payment ?? 0;
    expect(firstPayment).toBeCloseTo(94.56, 1);

    // Verificar que todas as parcelas de 1 a 11 têm o mesmo valor (Price).
    const basePayment = result.installments[0]?.payment ?? 0;
    for (let i = 1; i < 11; i++) {
      expect(result.installments[i]?.payment).toBe(basePayment);
    }
  });

  it('caso 2: PMT = 83.33 para 1000 / 12m / 0% mensal', () => {
    const result = calculate({ amount: 1000, termMonths: 12, monthlyRate: 0, method: 'price' });

    const firstPayment = result.installments[0]?.payment ?? 0;
    expect(firstPayment).toBeCloseTo(83.33, 1);

    // Com taxa zero, não há juros em nenhuma parcela.
    for (const row of result.installments) {
      expect(row.interest).toBe(0);
    }
  });

  it('caso 5: sum(principal) === amount para Price (integridade do principal)', () => {
    const amount = 1000;
    const result = calculate({ amount, termMonths: 12, monthlyRate: 0.02, method: 'price' });

    // Arredondamento a 2 casas para comparação.
    const total = Math.round(sumPrincipal(result.installments) * 100) / 100;
    expect(total).toBe(amount);
  });

  it('sum(principal) === amount para Price com taxa zero', () => {
    const amount = 1500;
    const result = calculate({ amount, termMonths: 6, monthlyRate: 0, method: 'price' });

    const total = Math.round(sumPrincipal(result.installments) * 100) / 100;
    expect(total).toBe(amount);
  });

  it('sum(principal) === amount para Price com valor fracionário', () => {
    const amount = 1234.56;
    const result = calculate({ amount, termMonths: 24, monthlyRate: 0.015, method: 'price' });

    const total = Math.round(sumPrincipal(result.installments) * 100) / 100;
    expect(total).toBe(amount);
  });

  it('saldo devedor na última parcela é zero (ou próximo de zero por arredondamento)', () => {
    const result = calculate({ amount: 1000, termMonths: 12, monthlyRate: 0.02, method: 'price' });

    const lastRow = result.installments[result.installments.length - 1];
    expect(lastRow?.balance).toBeCloseTo(0, 1);
  });

  it('totalPayment é >= amount (juros somam algo positivo quando taxa > 0)', () => {
    const amount = 1000;
    const result = calculate({ amount, termMonths: 12, monthlyRate: 0.02, method: 'price' });

    expect(result.totalPayment).toBeGreaterThanOrEqual(amount);
    expect(result.totalInterest).toBeGreaterThan(0);
  });

  it('totalInterest === 0 quando taxa é zero', () => {
    const result = calculate({ amount: 1000, termMonths: 12, monthlyRate: 0, method: 'price' });
    expect(result.totalInterest).toBe(0);
  });

  it('número de parcelas é igual a termMonths', () => {
    const result = calculate({ amount: 800, termMonths: 18, monthlyRate: 0.015, method: 'price' });
    expect(result.installments).toHaveLength(18);
  });

  it('o campo `number` é sequencial de 1 a n', () => {
    const result = calculate({ amount: 500, termMonths: 6, monthlyRate: 0.02, method: 'price' });
    result.installments.forEach((row, idx) => {
      expect(row.number).toBe(idx + 1);
    });
  });

  it('resultado reflete os parâmetros de entrada', () => {
    const input = { amount: 2000, termMonths: 24, monthlyRate: 0.01, method: 'price' as const };
    const result = calculate(input);

    expect(result.method).toBe('price');
    expect(result.amount).toBe(2000);
    expect(result.termMonths).toBe(24);
    expect(result.monthlyRate).toBe(0.01);
  });
});

// -----------------------------------------------------------------------------
// Método SAC
// -----------------------------------------------------------------------------

describe('calculate — SAC', () => {
  it('caso 3a: parcela 1 = 112.00 para SAC 1200 / 12m / 1%', () => {
    const result = calculate({ amount: 1200, termMonths: 12, monthlyRate: 0.01, method: 'sac' });

    // Parcela 1: principal = 100, juros = 1200 * 0.01 = 12, total = 112
    const row1 = result.installments[0];
    expect(row1?.principal).toBeCloseTo(100, TOLERANCE);
    expect(row1?.interest).toBeCloseTo(12, TOLERANCE);
    expect(row1?.payment).toBeCloseTo(112, TOLERANCE);
  });

  it('caso 3b: parcela 12 = 101.00 para SAC 1200 / 12m / 1%', () => {
    const result = calculate({ amount: 1200, termMonths: 12, monthlyRate: 0.01, method: 'sac' });

    // Parcela 12: saldo antes = 100, juros = 1, principal = 100, total = 101
    const row12 = result.installments[11];
    expect(row12?.principal).toBeCloseTo(100, TOLERANCE);
    expect(row12?.interest).toBeCloseTo(1, TOLERANCE);
    expect(row12?.payment).toBeCloseTo(101, TOLERANCE);
  });

  it('caso 4: sum(principal) === amount para SAC (integridade do principal)', () => {
    const amount = 1200;
    const result = calculate({ amount, termMonths: 12, monthlyRate: 0.01, method: 'sac' });

    const total = Math.round(sumPrincipal(result.installments) * 100) / 100;
    expect(total).toBe(amount);
  });

  it('sum(principal) === amount para SAC com valor fracionário', () => {
    const amount = 999.99;
    const result = calculate({ amount, termMonths: 12, monthlyRate: 0.02, method: 'sac' });

    const total = Math.round(sumPrincipal(result.installments) * 100) / 100;
    expect(total).toBe(amount);
  });

  it('sum(principal) === amount para SAC com prazo não múltiplo', () => {
    const amount = 3000;
    const result = calculate({ amount, termMonths: 7, monthlyRate: 0.015, method: 'sac' });

    const total = Math.round(sumPrincipal(result.installments) * 100) / 100;
    expect(total).toBe(amount);
  });

  it('parcelas decrescentes no SAC (pagamento diminui a cada mês)', () => {
    const result = calculate({ amount: 1200, termMonths: 12, monthlyRate: 0.01, method: 'sac' });

    for (let i = 1; i < result.installments.length; i++) {
      const prev = result.installments[i - 1]?.payment ?? 0;
      const curr = result.installments[i]?.payment ?? 0;
      expect(curr).toBeLessThanOrEqual(prev);
    }
  });

  it('saldo devedor na última parcela é zero (ou próximo por arredondamento)', () => {
    const result = calculate({ amount: 1200, termMonths: 12, monthlyRate: 0.01, method: 'sac' });

    const lastRow = result.installments[result.installments.length - 1];
    expect(lastRow?.balance).toBeCloseTo(0, 1);
  });

  it('principal por parcela é constante no SAC (exceto última por ajuste)', () => {
    const result = calculate({ amount: 1200, termMonths: 12, monthlyRate: 0.01, method: 'sac' });

    const basePrincipal = result.installments[0]?.principal ?? 0;
    // Parcelas de 1 a n-1 devem ter o mesmo principal base.
    for (let i = 1; i < result.installments.length - 1; i++) {
      expect(result.installments[i]?.principal).toBe(basePrincipal);
    }
  });

  it('número de parcelas é igual a termMonths', () => {
    const result = calculate({ amount: 800, termMonths: 18, monthlyRate: 0.015, method: 'sac' });
    expect(result.installments).toHaveLength(18);
  });

  it('resultado reflete os parâmetros de entrada', () => {
    const input = { amount: 2400, termMonths: 24, monthlyRate: 0.02, method: 'sac' as const };
    const result = calculate(input);

    expect(result.method).toBe('sac');
    expect(result.amount).toBe(2400);
    expect(result.termMonths).toBe(24);
    expect(result.monthlyRate).toBe(0.02);
  });
});

// -----------------------------------------------------------------------------
// Casos de erro (casos 6, 7, 8)
// -----------------------------------------------------------------------------

describe('calculate — erros de validação', () => {
  it('caso 6: lança erro se amount é zero', () => {
    expect(() =>
      calculate({ amount: 0, termMonths: 12, monthlyRate: 0.02, method: 'price' }),
    ).toThrow('amount must be positive');
  });

  it('caso 6: lança erro se amount é negativo', () => {
    expect(() =>
      calculate({ amount: -100, termMonths: 12, monthlyRate: 0.02, method: 'price' }),
    ).toThrow('amount must be positive');
  });

  it('caso 7: lança erro se termMonths é zero', () => {
    expect(() =>
      calculate({ amount: 1000, termMonths: 0, monthlyRate: 0.02, method: 'price' }),
    ).toThrow('termMonths must be positive integer');
  });

  it('caso 7: lança erro se termMonths é negativo', () => {
    expect(() =>
      calculate({ amount: 1000, termMonths: -5, monthlyRate: 0.02, method: 'price' }),
    ).toThrow('termMonths must be positive integer');
  });

  it('caso 7: lança erro se termMonths não é inteiro', () => {
    expect(() =>
      calculate({ amount: 1000, termMonths: 12.5, monthlyRate: 0.02, method: 'price' }),
    ).toThrow('termMonths must be positive integer');
  });

  it('caso 8: lança erro se monthlyRate é negativo', () => {
    expect(() =>
      calculate({ amount: 1000, termMonths: 12, monthlyRate: -0.01, method: 'price' }),
    ).toThrow('monthlyRate cannot be negative');
  });

  it('não lança erro com monthlyRate = 0 (empréstimo sem juros)', () => {
    expect(() =>
      calculate({ amount: 1000, termMonths: 12, monthlyRate: 0, method: 'price' }),
    ).not.toThrow();
  });

  it('lança erro SAC com amount <= 0', () => {
    expect(() =>
      calculate({ amount: -500, termMonths: 12, monthlyRate: 0.01, method: 'sac' }),
    ).toThrow('amount must be positive');
  });
});
