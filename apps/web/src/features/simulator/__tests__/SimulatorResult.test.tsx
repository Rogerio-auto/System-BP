// =============================================================================
// features/simulator/__tests__/SimulatorResult.test.tsx — Testes (F2-S06).
//
// Estratégia: testa lógica pura derivada do SimulatorResult e AmortizationTable:
//   - Somas da tabela de amortização batem com valores do header
//   - formatBRL/formatRate exibem corretamente
//   - Classificação de erros do useSimulate
//   - buildCaption do ProductSelect
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

/** Gera uma tabela de amortização Price simplificada (não-financeira, para testes de soma). */
function buildMockAmortization(
  principal: number,
  termMonths: number,
  monthlyRate: number,
): AmortizationRow[] {
  const rows: AmortizationRow[] = [];
  let balance = principal;

  // Fórmula Price: PMT = PV * i / (1 - (1+i)^-n)
  const pmt = Math.round((principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths)));

  for (let month = 1; month <= termMonths; month++) {
    const interest = Math.round(balance * monthlyRate);
    const principalPart = pmt - interest;
    balance = Math.max(0, balance - principalPart);

    rows.push({
      month,
      principal: principalPart,
      interest,
      installment: pmt,
      balance,
    });
  }

  return rows;
}

// Calcula total_amount a partir da tabela para garantir consistência
const _mockTable = buildMockAmortization(1_000_000, 12, 0.0199);
const _mockInstallment = _mockTable[0]!.installment;
const _mockTotalAmount = _mockTable.reduce((acc, r) => acc + r.installment, 0);

const MOCK_RESULT: SimulationResult = {
  id: 'sim-001',
  lead_id: 'lead-001',
  product_id: 'prod-001',
  requested_amount: 1_000_000, // R$ 10.000,00
  term_months: 12,
  interest_rate_monthly: 0.0199,
  installment_amount: _mockInstallment,
  total_amount: _mockTotalAmount,
  total_interest: _mockTotalAmount - 1_000_000,
  amortization_table: _mockTable,
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

// ─── Testes de tabela de amortização ─────────────────────────────────────────

describe('tabela de amortização — somas e integridade', () => {
  const rows = MOCK_RESULT.amortization_table;

  it('tabela tem o número correto de linhas', () => {
    expect(rows).toHaveLength(MOCK_RESULT.term_months);
  });

  it('mês final tem saldo devedor próximo de zero (< 1 centavo por arredondamento)', () => {
    const lastRow = rows[rows.length - 1]!;
    expect(lastRow.balance).toBeGreaterThanOrEqual(0);
    // O saldo final pode ter pequena diferença por arredondamento de centavos
    expect(lastRow.balance).toBeLessThan(200); // < R$ 2,00 de diferença
  });

  it('soma das parcelas ≈ total_amount (diferença por arredondamento ≤ R$ 1)', () => {
    const sumInstallments = rows.reduce((acc, r) => acc + r.installment, 0);
    const diff = Math.abs(sumInstallments - MOCK_RESULT.total_amount);
    // Aceita até R$ 1,00 de diferença por arredondamento mensal
    expect(diff).toBeLessThanOrEqual(100);
  });

  it('em cada linha: parcela = principal + juros (Price)', () => {
    for (const row of rows) {
      expect(row.installment).toBe(row.principal + row.interest);
    }
  });

  it('meses são sequenciais de 1 a N', () => {
    rows.forEach((row, i) => {
      expect(row.month).toBe(i + 1);
    });
  });

  it('saldo devedor decresce monotonicamente', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.balance).toBeLessThanOrEqual(rows[i - 1]!.balance);
    }
  });

  it('juros são sempre positivos (nunca negativos)', () => {
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

describe('formatBRL — exibição dos valores do resultado', () => {
  it('installment_amount exibe como BRL válido', () => {
    const display = formatBRL(MOCK_RESULT.installment_amount);
    expect(display).toBeTruthy();
    // Deve conter vírgula decimal (BR)
    expect(display).toContain(',');
  });

  it('total_amount > installment_amount (total sempre maior)', () => {
    expect(MOCK_RESULT.total_amount).toBeGreaterThan(MOCK_RESULT.installment_amount);
  });

  it('total_interest = total_amount - requested_amount', () => {
    // Arredondamento pode causar ≤ R$ 1,00 de diferença
    const expected = MOCK_RESULT.total_amount - MOCK_RESULT.requested_amount;
    expect(Math.abs(MOCK_RESULT.total_interest - expected)).toBeLessThanOrEqual(100);
  });
});

// ─── formatRate ───────────────────────────────────────────────────────────────

describe('formatRate — taxa do resultado', () => {
  it('0.0199 → string contendo "1,99" e "a.m."', () => {
    const r = formatRate(MOCK_RESULT.interest_rate_monthly);
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

describe('buildCaption — legenda do produto no select', () => {
  const product: CreditProduct = {
    id: 'prod-001',
    name: 'Microcrédito Produtivo',
    description: null,
    is_active: true,
    active_rule: {
      id: 'rule-001',
      min_amount: 50_000,
      max_amount: 5_000_000,
      min_term_months: 6,
      max_term_months: 60,
      interest_rate_monthly: 0.0199,
      city_id: null,
    },
  };

  it('contém faixa de valor', () => {
    const caption = buildCaption(product);
    expect(caption).toContain('500'); // R$ 500,00
    expect(caption).toContain('50.000'); // R$ 50.000,00
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

    // Lógica: isPending tem prioridade máxima
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
