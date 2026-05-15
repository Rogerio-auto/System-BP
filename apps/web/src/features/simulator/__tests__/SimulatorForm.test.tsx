// =============================================================================
// features/simulator/__tests__/SimulatorForm.test.tsx — Testes unitários (F2-S06).
//
// UNIDADE MONETÁRIA: REAIS (decimal 2 casas), consistente com o backend.
// Nunca centavos neste módulo.
//
// Estratégia: testa lógica pura isolada (formatadores, parsers, validação Zod)
// sem renderizar React (JSDOM não configurado no vitest deste projeto).
//
// Cobertura:
//   1. maskBRL: máscaras progressivas de entrada (UX digit-shift)
//   2. parseBRL: conversão display → reais
//   3. formatBRL: reais → string BRL
//   4. formatRate: taxa decimal → string display
//   5. Schema de validação Zod: limites da regra ativa em reais
//   6. buildSchema: campos obrigatórios
//   7. parseBRL + maskBRL: round-trip (reais)
//   8. Contrato: rule.min_amount = 5000 reais → hint "R$ 5.000,00",
//      validação aceita 10000 / rejeita 4999
//   9. Submit: form "R$ 10.000" → requested_amount 10000 (reais, não 1000000)
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { maskBRL, parseBRL, formatBRL, formatRate } from '../../../hooks/simulator/types';
import type { CreditProduct } from '../../../hooks/simulator/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Regra com min_amount = 500 reais, max_amount = 50.000 reais.
 * Unidade: REAIS (backend numeric(14,2)).
 */
const MOCK_RULE: CreditProduct['active_rule'] = {
  id: 'rule-001',
  min_amount: 500, // R$ 500,00
  max_amount: 50000, // R$ 50.000,00
  min_term_months: 6,
  max_term_months: 60,
  interest_rate_monthly: 0.0199,
  city_id: null,
};

/**
 * Regra de contrato: min = 5.000 reais, max = 30.000 reais.
 * Usada nos testes de contrato do DoD.
 */
const CONTRACT_RULE: CreditProduct['active_rule'] = {
  id: 'rule-contract',
  min_amount: 5000, // R$ 5.000,00
  max_amount: 30000, // R$ 30.000,00
  min_term_months: 6,
  max_term_months: 60,
  interest_rate_monthly: 0.0199,
  city_id: null,
};

// Reproduz a factory do SimulatorForm (sem importar o componente)
function buildSchema(rule: CreditProduct['active_rule']) {
  return z.object({
    lead_id: z.string().min(1, 'Selecione um lead'),
    product_id: z.string().min(1, 'Selecione um produto'),
    amount_display: z
      .string()
      .min(1, 'Informe o valor solicitado')
      .refine(
        (v) => {
          if (!rule) return true;
          const reais = parseBRL(v);
          return reais >= rule.min_amount && reais <= rule.max_amount;
        },
        {
          message: rule
            ? `Valor deve estar entre ${formatBRL(rule.min_amount)} e ${formatBRL(rule.max_amount)}`
            : 'Valor inválido',
        },
      ),
    term_months: z
      .string()
      .min(1, 'Informe o prazo')
      .refine(
        (v) => {
          const n = parseInt(v, 10);
          if (!rule) return !isNaN(n) && n > 0;
          return !isNaN(n) && n >= rule.min_term_months && n <= rule.max_term_months;
        },
        {
          message: rule
            ? `Prazo deve estar entre ${rule.min_term_months} e ${rule.max_term_months} meses`
            : 'Prazo inválido',
        },
      ),
  });
}

// ─── maskBRL ──────────────────────────────────────────────────────────────────

describe('maskBRL — máscara de entrada BRL (UX digit-shift)', () => {
  it('string vazia → string vazia', () => {
    expect(maskBRL('')).toBe('');
  });

  it('apenas zeros → R$ 0,00', () => {
    expect(maskBRL('0')).toBe('R$\xa00,00');
  });

  it('"100" → R$ 1,00 (100 centavos no UX de digitação = R$ 1,00)', () => {
    const result = maskBRL('100');
    expect(result.replace(/\s/g, ' ')).toBe('R$ 1,00');
  });

  it('"1000000" → R$ 10.000,00', () => {
    const result = maskBRL('1000000');
    expect(result.replace(/\s/g, ' ')).toBe('R$ 10.000,00');
  });

  it('"500000" → R$ 5.000,00', () => {
    const result = maskBRL('500000');
    expect(result.replace(/\s/g, ' ')).toBe('R$ 5.000,00');
  });

  it('remove não-dígitos antes de processar', () => {
    const result = maskBRL('abc123def');
    expect(result.replace(/\s/g, ' ')).toBe('R$ 1,23');
  });
});

// ─── parseBRL ─────────────────────────────────────────────────────────────────

describe('parseBRL — converte display BRL para REAIS (float 2 casas)', () => {
  it('R$ 0,00 → 0', () => {
    expect(parseBRL('R$ 0,00')).toBe(0);
  });

  it('R$ 1,00 → 1', () => {
    expect(parseBRL('R$ 1,00')).toBe(1);
  });

  it('R$ 1.000,00 → 1000', () => {
    expect(parseBRL('R$ 1.000,00')).toBe(1000);
  });

  it('R$ 50.000,00 → 50000', () => {
    expect(parseBRL('R$ 50.000,00')).toBe(50000);
  });

  it('R$ 10.000,50 → 10000.5', () => {
    expect(parseBRL('R$ 10.000,50')).toBe(10000.5);
  });

  it('string inválida → 0', () => {
    expect(parseBRL('nao-eh-valor')).toBe(0);
  });

  it('string vazia → 0', () => {
    expect(parseBRL('')).toBe(0);
  });
});

// ─── formatBRL ────────────────────────────────────────────────────────────────

describe('formatBRL — reais para string BRL', () => {
  it('0 → R$ 0,00', () => {
    const result = formatBRL(0).replace(/\s/g, ' ');
    expect(result).toBe('R$ 0,00');
  });

  it('1 → R$ 1,00 (não R$ 0,01)', () => {
    const result = formatBRL(1).replace(/\s/g, ' ');
    expect(result).toBe('R$ 1,00');
  });

  it('1000 → R$ 1.000,00', () => {
    const result = formatBRL(1000).replace(/\s/g, ' ');
    expect(result).toBe('R$ 1.000,00');
  });

  it('50000 → R$ 50.000,00', () => {
    const result = formatBRL(50000).replace(/\s/g, ' ');
    expect(result).toBe('R$ 50.000,00');
  });

  it('5000 → R$ 5.000,00 (contrato: regra min_amount=5000)', () => {
    const result = formatBRL(5000).replace(/\s/g, ' ');
    expect(result).toBe('R$ 5.000,00');
  });

  it('30000 → R$ 30.000,00 (contrato: regra max_amount=30000)', () => {
    const result = formatBRL(30000).replace(/\s/g, ' ');
    expect(result).toBe('R$ 30.000,00');
  });
});

// ─── formatRate ───────────────────────────────────────────────────────────────

describe('formatRate — taxa decimal para display', () => {
  it('0.0199 → contém "1,99"', () => {
    const result = formatRate(0.0199);
    expect(result).toContain('1,99');
    expect(result).toContain('a.m.');
  });

  it('0.02 → contém "2,00"', () => {
    const result = formatRate(0.02);
    expect(result).toContain('2,00');
  });

  it('0.005 → contém "0,50"', () => {
    const result = formatRate(0.005);
    expect(result).toContain('0,50');
  });
});

// ─── Round-trip maskBRL ↔ parseBRL ───────────────────────────────────────────
// maskBRL(digits) produz string BRL formatada em reais.
// parseBRL(maskBRL(digits)) retorna reais = parseInt(digits)/100
// Exemplo: digits="1000000" → mask="R$ 10.000,00" → parse=10000 reais

describe('maskBRL + parseBRL — round-trip em reais', () => {
  const cases: Array<{ digits: string; expectedReais: number }> = [
    { digits: '5000000', expectedReais: 50000 }, // R$ 50.000,00
    { digits: '50000', expectedReais: 500 }, // R$ 500,00
    { digits: '100', expectedReais: 1 }, // R$ 1,00
    { digits: '1000000', expectedReais: 10000 }, // R$ 10.000,00
  ];

  it.each(cases)(
    'digits=$digits → mask → parse → $expectedReais reais',
    ({ digits, expectedReais }) => {
      const masked = maskBRL(digits);
      const parsed = parseBRL(masked);
      expect(parsed).toBe(expectedReais);
    },
  );
});

// ─── Schema de validação Zod ─────────────────────────────────────────────────

describe('buildSchema — validação com regra ativa (valores em reais)', () => {
  const schema = buildSchema(MOCK_RULE);

  it('dados válidos passam na validação', () => {
    // R$ 10.000,00 está entre R$ 500 e R$ 50.000
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(10000), // R$ 10.000,00
      term_months: '24',
    });
    expect(result.success).toBe(true);
  });

  it('lead_id vazio falha', () => {
    const result = schema.safeParse({
      lead_id: '',
      product_id: 'prod-001',
      amount_display: formatBRL(10000),
      term_months: '24',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.lead_id).toBeDefined();
    }
  });

  it('product_id vazio falha', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: '',
      amount_display: formatBRL(10000),
      term_months: '24',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.product_id).toBeDefined();
    }
  });

  it('valor abaixo do mínimo (R$ 100,00 < R$ 500,00) falha', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(100), // R$ 100,00
      term_months: '12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.amount_display).toBeDefined();
    }
  });

  it('valor acima do máximo (R$ 60.000,00 > R$ 50.000,00) falha', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(60000), // R$ 60.000,00
      term_months: '12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.amount_display).toBeDefined();
    }
  });

  it('prazo abaixo do mínimo (3 < 6) falha', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(10000),
      term_months: '3',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.term_months).toBeDefined();
    }
  });

  it('prazo acima do máximo (72 > 60) falha', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(10000),
      term_months: '72',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.term_months).toBeDefined();
    }
  });

  it('prazo nos limites exatos (6 e 60) passa', () => {
    const r1 = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(10000),
      term_months: '6',
    });
    expect(r1.success).toBe(true);

    const r2 = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(10000),
      term_months: '60',
    });
    expect(r2.success).toBe(true);
  });

  it('valor nos limites exatos (R$ 500,00 e R$ 50.000,00) passa', () => {
    const r1 = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(500), // R$ 500,00 = min_amount
      term_months: '12',
    });
    expect(r1.success).toBe(true);

    const r2 = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(50000), // R$ 50.000,00 = max_amount
      term_months: '12',
    });
    expect(r2.success).toBe(true);
  });
});

// ─── Schema sem regra ativa ───────────────────────────────────────────────────

describe('buildSchema — sem regra ativa (null)', () => {
  const schema = buildSchema(null);

  it('qualquer valor positivo passa (sem regra = sem limites)', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(10000),
      term_months: '999',
    });
    expect(result.success).toBe(true);
  });

  it('campos obrigatórios ainda validam', () => {
    const result = schema.safeParse({
      lead_id: '',
      product_id: '',
      amount_display: '',
      term_months: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Testes de contrato (DoD) ─────────────────────────────────────────────────

describe('CONTRATO — regra min=5000/max=30000 reais (DoD)', () => {
  const schema = buildSchema(CONTRACT_RULE);

  it('hint exibe "R$ 5.000,00" para min_amount=5000 reais', () => {
    const hint = formatBRL(CONTRACT_RULE!.min_amount);
    expect(hint.replace(/\s/g, ' ')).toBe('R$ 5.000,00');
  });

  it('hint exibe "R$ 30.000,00" para max_amount=30000 reais', () => {
    const hint = formatBRL(CONTRACT_RULE!.max_amount);
    expect(hint.replace(/\s/g, ' ')).toBe('R$ 30.000,00');
  });

  it('validação aceita 10000 reais (R$ 10.000,00)', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(10000), // R$ 10.000,00
      term_months: '12',
    });
    expect(result.success).toBe(true);
  });

  it('validação rejeita 4999 reais (R$ 4.999,00 < min 5000)', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(4999), // R$ 4.999,00
      term_months: '12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.amount_display).toBeDefined();
    }
  });

  it('submit: form R$ 10.000 → requested_amount 10000 reais (não 1000000)', () => {
    // Simula o parseBRL que handleFormSubmit chama
    const amountDisplay = formatBRL(10000); // "R$ 10.000,00"
    const requestedAmount = parseBRL(amountDisplay);
    // Deve ser 10000 reais, não 1000000 centavos
    expect(requestedAmount).toBe(10000);
  });

  it('submit: form R$ 5.000 → requested_amount 5000 reais', () => {
    const amountDisplay = formatBRL(5000); // "R$ 5.000,00"
    const requestedAmount = parseBRL(amountDisplay);
    expect(requestedAmount).toBe(5000);
  });
});
