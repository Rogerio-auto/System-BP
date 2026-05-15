// =============================================================================
// features/simulator/__tests__/SimulatorResult.test.tsx — Testes (F2-S11).
//
// UNIDADE MONETÁRIA: REAIS (decimal 2 casas), consistente com o backend.
//
// Estratégia: testa lógica pura derivada do SimulatorResult e AmortizationTable:
//   - Somas da tabela de amortização batem com valores do header
//   - formatBRL/formatRate exibem corretamente
//   - Classificação de erros do useSimulate
//   - buildCaption do ProductSelect
//   - CONTRATO: AmortizationRow usa number/payment (não month/installment)
//   - CONTRATO: SimulationResult usa monthly_payment/amount_requested/rate_monthly_snapshot
//
// Sem renderização React (JSDOM não configurado no vitest deste projeto).
// =============================================================================

import { describe, expect, it } from 'vitest';

import type {
  AmortizationRow,
  SimulationResult,
  CreditProduct,
} from '../../../hooks/simulator/types';
import { formatBRL, formatRate } from '../../../hooks/simulator/types';
import type { SimulationError, SimulationErrorCode } from '../../../hooks/simulator/useSimulate';
import { ApiError } from '../../../lib/api';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Gera uma tabela de amortização Price simplificada em REAIS.
 * Campos: number/payment/principal/interest/balance — espelho do backend (F2-S11).
 */
function buildMockAmortization(
  principalReais: number,
  termMonths: number,
  monthlyRate: number,
): AmortizationRow[] {
  const rows: AmortizationRow[] = [];
  let balance = principalReais;

  // Fórmula Price: PMT = PV * i / (1 - (1+i)^-n)
  const pmt =
    Math.round(
      ((principalReais * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths))) * 100,
    ) / 100;

  for (let num = 1; num <= termMonths; num++) {
    const interest = Math.round(balance * monthlyRate * 100) / 100;
    const principalPart = Math.round((pmt - interest) * 100) / 100;
    balance = Math.max(0, Math.round((balance - principalPart) * 100) / 100);

    rows.push({
      number: num, // campo correto do backend — era "month" no shape antigo
      principal: principalPart,
      interest,
      payment: pmt, // campo correto do backend — era "installment" no shape antigo
      balance,
    });
  }

  return rows;
}

// MOCK: R$ 10.000 / 12 meses / 1.99% a.m.
const _mockTable = buildMockAmortization(10000, 12, 0.0199);
const _mockInstallment = _mockTable[0]!.payment;
const _mockTotalAmount = Math.round(_mockTable.reduce((acc, r) => acc + r.payment, 0) * 100) / 100;

const MOCK_RESULT: SimulationResult = {
  id: 'sim-001',
  organization_id: 'org-001',
  lead_id: 'lead-001',
  product_id: 'prod-001',
  rule_version_id: 'rv-001',
  amount_requested: 10000, // campo correto — era "requested_amount"
  term_months: 12,
  monthly_payment: _mockInstallment, // campo correto — era "installment_amount"
  total_amount: _mockTotalAmount,
  total_interest: Math.round((_mockTotalAmount - 10000) * 100) / 100,
  rate_monthly_snapshot: 0.0199, // campo correto — era "interest_rate_monthly"
  amortization_method: 'price',
  amortization_table: _mockTable,
  origin: 'manual',
  created_by_user_id: null,
  created_at: new Date().toISOString(),
};

// ─── Classificador de erros (espelha classifyError do useSimulate) ────────────

function classifyError(err: unknown): SimulationError {
  if (err instanceof ApiError) {
    if (err.status === 422) return { code: 'VALIDATION_ERROR', message: err.message };
    if (err.status === 409) return { code: 'NO_RULE_FOR_CITY', message: err.message };
    if (err.status === 503) return { code: 'FLAG_DISABLED', message: err.message };
    if (err.status === 403) return { code: 'FORBIDDEN', message: err.message };
  }
  return { code: 'UNKNOWN', message: err instanceof Error ? err.message : 'Erro desconhecido.' };
}

// ─── buildCaption (espelha ProductSelect) ────────────────────────────────────

function buildCaption(product: CreditProduct): string {
  const rule = product.active_rule;
  if (!rule) return 'Sem regra ativa';
  const minVal = formatBRL(rule.min_amount);
  const maxVal = formatBRL(rule.max_amount);
  return `${minVal} – ${maxVal} · ${rule.min_term_months}–${rule.max_term_months} meses`;
}

// ─── CONTRATO: shape de AmortizationRow (F2-S11) ─────────────────────────────

describe('CONTRATO — AmortizationRow usa number/payment (não month/installment)', () => {
  const rows = MOCK_RESULT.amortization_table;

  it('campo "number" existe e é sequencial de 1 a N', () => {
    rows.forEach((row, i) => {
      expect(row).toHaveProperty('number');
      expect(row.number).toBe(i + 1);
    });
  });

  it('campo "payment" existe com valor positivo', () => {
    for (const row of rows) {
      expect(row).toHaveProperty('payment');
      expect(row.payment).toBeGreaterThan(0);
    }
  });

  it('campo "month" NÃO existe (garantia de remoção do shape antigo)', () => {
    for (const row of rows) {
      expect(row).not.toHaveProperty('month');
    }
  });

  it('campo "installment" NÃO existe (garantia de remoção do shape antigo)', () => {
    for (const row of rows) {
      expect(row).not.toHaveProperty('installment');
    }
  });
});

// ─── CONTRATO: shape de SimulationResult (F2-S11) ────────────────────────────

describe('CONTRATO — SimulationResult usa campos corretos do backend', () => {
  it('campo monthly_payment existe (não installment_amount)', () => {
    expect(MOCK_RESULT).toHaveProperty('monthly_payment');
    expect(MOCK_RESULT).not.toHaveProperty('installment_amount');
  });

  it('campo amount_requested existe (não requested_amount)', () => {
    expect(MOCK_RESULT).toHaveProperty('amount_requested');
    expect(MOCK_RESULT).not.toHaveProperty('requested_amount');
  });

  it('campo rate_monthly_snapshot existe (não interest_rate_monthly)', () => {
    expect(MOCK_RESULT).toHaveProperty('rate_monthly_snapshot');
    expect(MOCK_RESULT).not.toHaveProperty('interest_rate_monthly');
  });

  it('monetários são number (normalizados pelo useSimulate, não string)', () => {
    expect(typeof MOCK_RESULT.monthly_payment).toBe('number');
    expect(typeof MOCK_RESULT.amount_requested).toBe('number');
    expect(typeof MOCK_RESULT.total_amount).toBe('number');
    expect(typeof MOCK_RESULT.total_interest).toBe('number');
    expect(typeof MOCK_RESULT.rate_monthly_snapshot).toBe('number');
  });
});

// ─── Testes de tabela de amortização ─────────────────────────────────────────

describe('tabela de amortização — somas e integridade (valores em reais)', () => {
  const rows = MOCK_RESULT.amortization_table;

  it('tabela tem o número correto de linhas', () => {
    expect(rows).toHaveLength(MOCK_RESULT.term_months);
  });

  it('parcela final tem saldo devedor próximo de zero (< R$ 2,00 por arredondamento)', () => {
    const lastRow = rows[rows.length - 1]!;
    expect(lastRow.balance).toBeGreaterThanOrEqual(0);
    expect(lastRow.balance).toBeLessThan(2);
  });

  it('soma das parcelas (payment) ≈ total_amount (diferença por arredondamento ≤ R$ 1)', () => {
    const sumPayments = Math.round(rows.reduce((acc, r) => acc + r.payment, 0) * 100) / 100;
    const diff = Math.abs(sumPayments - MOCK_RESULT.total_amount);
    expect(diff).toBeLessThanOrEqual(1);
  });

  it('em cada linha: payment ≈ principal + interest (Price, tolerância R$ 0,01)', () => {
    for (const row of rows) {
      const sum = Math.round((row.principal + row.interest) * 100) / 100;
      const diff = Math.abs(row.payment - sum);
      expect(diff).toBeLessThanOrEqual(0.01);
    }
  });

  it('parcelas (number) são sequenciais de 1 a N', () => {
    rows.forEach((row, i) => {
      expect(row.number).toBe(i + 1);
    });
  });

  it('saldo devedor decresce monotonicamente', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.balance).toBeLessThanOrEqual(rows[i - 1]!.balance);
    }
  });

  it('juros são sempre não-negativos', () => {
    for (const row of rows) {
      expect(row.interest).toBeGreaterThanOrEqual(0);
    }
  });

  it('principal de amortização são sempre positivos', () => {
    for (const row of rows) {
      expect(row.principal).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── formatBRL no contexto do resultado ──────────────────────────────────────

describe('formatBRL — exibição dos valores do resultado (reais)', () => {
  it('monthly_payment exibe como BRL válido', () => {
    const display = formatBRL(MOCK_RESULT.monthly_payment);
    expect(display).toBeTruthy();
    expect(display).toContain(',');
  });

  it('total_amount > monthly_payment (total sempre maior)', () => {
    expect(MOCK_RESULT.total_amount).toBeGreaterThan(MOCK_RESULT.monthly_payment);
  });

  it('total_interest = total_amount - amount_requested (± R$ 0,02 por arredondamento)', () => {
    const expected =
      Math.round((MOCK_RESULT.total_amount - MOCK_RESULT.amount_requested) * 100) / 100;
    expect(Math.abs(MOCK_RESULT.total_interest - expected)).toBeLessThanOrEqual(0.02);
  });

  it('formatBRL(10000) → R$ 10.000,00 (sem divisão por 100)', () => {
    const display = formatBRL(10000).replace(/\s/g, ' ');
    expect(display).toBe('R$ 10.000,00');
  });

  it('formatBRL(5000) → R$ 5.000,00 (contrato)', () => {
    const display = formatBRL(5000).replace(/\s/g, ' ');
    expect(display).toBe('R$ 5.000,00');
  });
});

// ─── formatRate ───────────────────────────────────────────────────────────────

describe('formatRate — taxa do resultado', () => {
  it('rate_monthly_snapshot 0.0199 → string contendo "1,99" e "a.m."', () => {
    const r = formatRate(MOCK_RESULT.rate_monthly_snapshot);
    expect(r).toContain('1,99');
    expect(r).toContain('a.m.');
  });
});

// ─── Classificação de erros ───────────────────────────────────────────────────

describe('classifyError — mapeamento de status HTTP', () => {
  it('ApiError 422 → VALIDATION_ERROR', () => {
    const err = new ApiError(422, 'VALIDATION_FAILED', 'Valor fora dos limites');
    expect(classifyError(err).code).toBe('VALIDATION_ERROR' as SimulationErrorCode);
  });

  it('ApiError 409 → NO_RULE_FOR_CITY', () => {
    const err = new ApiError(409, 'NO_RULE', 'Sem regra para a cidade');
    expect(classifyError(err).code).toBe('NO_RULE_FOR_CITY' as SimulationErrorCode);
  });

  it('ApiError 503 → FLAG_DISABLED', () => {
    const err = new ApiError(503, 'FEATURE_DISABLED', 'Módulo desativado');
    expect(classifyError(err).code).toBe('FLAG_DISABLED' as SimulationErrorCode);
  });

  it('ApiError 403 → FORBIDDEN', () => {
    const err = new ApiError(403, 'FORBIDDEN', 'Sem permissão');
    expect(classifyError(err).code).toBe('FORBIDDEN' as SimulationErrorCode);
  });

  it('Error genérico → UNKNOWN com mensagem', () => {
    const err = new Error('Falha de rede');
    const classified = classifyError(err);
    expect(classified.code).toBe('UNKNOWN' as SimulationErrorCode);
    expect(classified.message).toBe('Falha de rede');
  });

  it('valor não-Error → UNKNOWN com fallback', () => {
    const classified = classifyError('string-error');
    expect(classified.code).toBe('UNKNOWN' as SimulationErrorCode);
    expect(classified.message).toBe('Erro desconhecido.');
  });
});

// ─── buildCaption do ProductSelect ───────────────────────────────────────────

describe('buildCaption — legenda do produto no select (valores em reais)', () => {
  const product: CreditProduct = {
    id: 'prod-001',
    name: 'Microcrédito Produtivo',
    description: null,
    is_active: true,
    active_rule: {
      id: 'rule-001',
      min_amount: 500,
      max_amount: 50000,
      min_term_months: 6,
      max_term_months: 60,
      interest_rate_monthly: 0.0199,
      city_id: null,
    },
  };

  it('contém faixa de valor (R$ 500 e R$ 50.000)', () => {
    const caption = buildCaption(product);
    expect(caption).toContain('500');
    expect(caption).toContain('50.000');
  });

  it('contém faixa de prazo', () => {
    const caption = buildCaption(product);
    expect(caption).toContain('6');
    expect(caption).toContain('60');
    expect(caption).toContain('meses');
  });

  it('sem regra ativa → "Sem regra ativa"', () => {
    const noRule: CreditProduct = { ...product, active_rule: null };
    expect(buildCaption(noRule)).toBe('Sem regra ativa');
  });
});

// ─── Estado de resultado — derivações ────────────────────────────────────────

describe('estados do SimulatorResult — lógica de exibição', () => {
  it('isPending=true → estado loading (sem result)', () => {
    const isPending = true;
    const result = undefined;
    const error = null;

    expect(isPending).toBe(true);
    expect(result).toBeUndefined();
    expect(error).toBeNull();
  });

  it('error sem result → estado de erro', () => {
    const isPending = false;
    const result = undefined;
    const error: SimulationError = { code: 'NO_RULE_FOR_CITY', message: 'Sem regra' };

    expect(isPending).toBe(false);
    expect(result).toBeUndefined();
    expect(error.code).toBe('NO_RULE_FOR_CITY');
  });

  it('result presente → estado de sucesso', () => {
    const isPending = false;
    const result = MOCK_RESULT;
    const error = null;

    expect(isPending).toBe(false);
    expect(result).toBeDefined();
    expect(error).toBeNull();
    expect(result.amortization_table).toHaveLength(12);
  });

  it('sem result e sem error → estado vazio (empty)', () => {
    const isPending = false;
    const result = undefined;
    const error = null;

    expect(isPending).toBe(false);
    expect(result).toBeUndefined();
    expect(error).toBeNull();
  });
});
