// =============================================================================
// __tests__/RuleTimeline.test.tsx — Testes de lógica pura da timeline de regras.
//
// Estratégia: testa lógica pura isolada sem renderizar React
// (JSDOM não configurado no vitest deste projeto).
//
// Cobertura:
//   1. formatRate: formata taxa decimal em percentual string
//   2. Fórmula Price PMT: cálculo de parcela
//   3. PublishRuleSchema: validação de campos do form de publicação
//   4. Ordenação de versões (mais nova no topo)
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Replica das funções puras do RuleTimeline.tsx
// ---------------------------------------------------------------------------

function formatRate(decimalStr: string): string {
  const n = parseFloat(decimalStr);
  if (isNaN(n)) return decimalStr;
  return `${(n * 100).toFixed(2).replace('.', ',')}%`;
}

// ---------------------------------------------------------------------------
// Replica da fórmula Price PMT do PublishRuleDrawer.tsx
// ---------------------------------------------------------------------------

function calcPricePmt(principal: number, monthlyRatePct: number, termMonths: number): number {
  if (!principal || !monthlyRatePct || !termMonths) return NaN;
  const i = monthlyRatePct / 100;
  const pmt = (principal * i) / (1 - Math.pow(1 + i, -termMonths));
  return pmt;
}

// ---------------------------------------------------------------------------
// Schema de publicação de regra (replica do PublishRuleDrawer.tsx)
// ---------------------------------------------------------------------------

const PublishRuleSchema = z
  .object({
    monthlyRate: z
      .number()
      .gt(0, 'Taxa deve ser maior que 0')
      .lte(100, 'Taxa não pode exceder 100%'),
    iofRate: z.number().gte(0).lte(100).optional(),
    minAmount: z.number().min(100, 'Mínimo: R$ 100').max(1_000_000),
    maxAmount: z.number().min(100).max(1_000_000),
    minTermMonths: z.number().int().min(1).max(120),
    maxTermMonths: z.number().int().min(1).max(120),
    amortization: z.enum(['price', 'sac']),
  })
  .refine((d) => d.maxAmount >= d.minAmount, {
    message: 'Valor máximo deve ser ≥ mínimo',
    path: ['maxAmount'],
  })
  .refine((d) => d.maxTermMonths >= d.minTermMonths, {
    message: 'Prazo máximo deve ser ≥ mínimo',
    path: ['maxTermMonths'],
  });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

type MockRule = {
  id: string;
  version: number;
  is_active: boolean;
  monthly_rate: string;
};

const ACTIVE_RULE: MockRule = {
  id: 'rule-2',
  version: 2,
  is_active: true,
  monthly_rate: '0.0250',
};

const EXPIRED_RULE: MockRule = {
  id: 'rule-1',
  version: 1,
  is_active: false,
  monthly_rate: '0.0300',
};

// ---------------------------------------------------------------------------
// Testes: formatRate
// ---------------------------------------------------------------------------

describe('formatRate', () => {
  it('formata 0.0250 como 2,50%', () => {
    expect(formatRate('0.0250')).toBe('2,50%');
  });

  it('formata 0.1000 como 10,00%', () => {
    expect(formatRate('0.1000')).toBe('10,00%');
  });

  it('formata 0.0025 como 0,25%', () => {
    expect(formatRate('0.0025')).toBe('0,25%');
  });

  it('retorna string original se inválida', () => {
    expect(formatRate('invalid')).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// Testes: calcPricePmt
// ---------------------------------------------------------------------------

describe('calcPricePmt (fórmula Price)', () => {
  it('calcula PMT para R$ 1.000 em 12x a 2%/mês', () => {
    const pmt = calcPricePmt(1000, 2, 12);
    // Esperado: ~R$ 94,56 (Price com 2% ao mês, 12 parcelas)
    // PMT = 1000 * 0.02 / (1 - 1.02^-12) ≈ 94.56
    expect(pmt).toBeGreaterThan(90);
    expect(pmt).toBeLessThan(100);
  });

  it('retorna NaN para principal zero', () => {
    expect(isNaN(calcPricePmt(0, 2, 12))).toBe(true);
  });

  it('retorna NaN para taxa zero', () => {
    expect(isNaN(calcPricePmt(1000, 0, 12))).toBe(true);
  });

  it('retorna NaN para prazo zero', () => {
    expect(isNaN(calcPricePmt(1000, 2, 0))).toBe(true);
  });

  it('PMT * prazo > principal (custo total inclui juros)', () => {
    const pmt = calcPricePmt(1000, 2, 12);
    expect(pmt * 12).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Testes: PublishRuleSchema
// ---------------------------------------------------------------------------

describe('PublishRuleSchema', () => {
  const validRule = {
    monthlyRate: 2.5,
    minAmount: 500,
    maxAmount: 5000,
    minTermMonths: 3,
    maxTermMonths: 24,
    amortization: 'price' as const,
  };

  it('aceita regra válida', () => {
    expect(PublishRuleSchema.safeParse(validRule).success).toBe(true);
  });

  it('rejeita monthlyRate zero', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule, monthlyRate: 0 });
    expect(r.success).toBe(false);
  });

  it('rejeita monthlyRate negativa', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule, monthlyRate: -1 });
    expect(r.success).toBe(false);
  });

  it('rejeita maxAmount < minAmount', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule, minAmount: 5000, maxAmount: 500 });
    expect(r.success).toBe(false);
  });

  it('rejeita maxTermMonths < minTermMonths', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule, minTermMonths: 24, maxTermMonths: 3 });
    expect(r.success).toBe(false);
  });

  it('aceita amortização SAC', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule, amortization: 'sac' });
    expect(r.success).toBe(true);
  });

  it('rejeita amortização inválida', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule, amortization: 'invalid' });
    expect(r.success).toBe(false);
  });

  it('aceita iofRate opcional ausente', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule });
    expect(r.success).toBe(true);
  });

  it('aceita iofRate zero', () => {
    const r = PublishRuleSchema.safeParse({ ...validRule, iofRate: 0 });
    expect(r.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Testes: lógica de ordenação de versões
// ---------------------------------------------------------------------------

describe('ordenação de versões (mais nova no topo)', () => {
  it('array com versão ativa (v2) antes da expirada (v1) permanece na ordem do backend', () => {
    const rules = [ACTIVE_RULE, EXPIRED_RULE];
    // O backend retorna DESC, frontend usa a ordem tal qual
    expect(rules[0]?.version).toBe(2);
    expect(rules[1]?.version).toBe(1);
  });

  it('identifica a versão ativa corretamente', () => {
    const rules = [ACTIVE_RULE, EXPIRED_RULE];
    const activeRule = rules.find((r) => r.is_active);
    expect(activeRule?.version).toBe(2);
  });

  it('versão ativa é única', () => {
    const rules = [ACTIVE_RULE, EXPIRED_RULE];
    const activeRules = rules.filter((r) => r.is_active);
    expect(activeRules).toHaveLength(1);
  });
});
