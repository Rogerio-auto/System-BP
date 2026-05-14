// =============================================================================
// features/simulator/__tests__/SimulatorForm.test.tsx — Testes unitários (F2-S06).
//
// Estratégia: testa lógica pura isolada (formatadores, parsers, validação Zod)
// sem renderizar React (JSDOM não configurado no vitest deste projeto).
//
// Cobertura:
//   1. maskBRL: máscaras progressivas de entrada
//   2. parseBRL: conversão display → centavos
//   3. formatBRL: centavos → string BRL
//   4. formatRate: taxa decimal → string display
//   5. Schema de validação Zod: limites da regra ativa
//   6. buildSchema: campos obrigatórios
//   7. parseBRL + maskBRL: round-trip
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { maskBRL, parseBRL, formatBRL, formatRate } from '../../../hooks/simulator/types';
import type { CreditProduct } from '../../../hooks/simulator/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_RULE: CreditProduct['active_rule'] = {
  id: 'rule-001',
  min_amount: 50000, // R$ 500,00
  max_amount: 5000000, // R$ 50.000,00
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
          const cents = parseBRL(v);
          return cents >= rule.min_amount && cents <= rule.max_amount;
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

describe('maskBRL — máscara de entrada BRL', () => {
  it('string vazia → string vazia', () => {
    expect(maskBRL('')).toBe('');
  });

  it('apenas zeros → R$ 0,00', () => {
    expect(maskBRL('0')).toBe('R$\xa00,00');
  });

  it('"100" → R$ 1,00', () => {
    const result = maskBRL('100');
    // Aceita NBSP (non-breaking space) que pt-BR usa no símbolo R$
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

describe('parseBRL — converte display BRL para centavos', () => {
  it('R$ 0,00 → 0', () => {
    expect(parseBRL('R$ 0,00')).toBe(0);
  });

  it('R$ 1,00 → 100', () => {
    expect(parseBRL('R$ 1,00')).toBe(100);
  });

  it('R$ 1.000,00 → 100000', () => {
    expect(parseBRL('R$ 1.000,00')).toBe(100_000);
  });

  it('R$ 50.000,00 → 5000000', () => {
    expect(parseBRL('R$ 50.000,00')).toBe(5_000_000);
  });

  it('string inválida → 0', () => {
    expect(parseBRL('nao-eh-valor')).toBe(0);
  });

  it('string vazia → 0', () => {
    expect(parseBRL('')).toBe(0);
  });
});

// ─── formatBRL ────────────────────────────────────────────────────────────────

describe('formatBRL — centavos para string BRL', () => {
  it('0 → R$ 0,00', () => {
    const result = formatBRL(0).replace(/\s/g, ' ');
    expect(result).toBe('R$ 0,00');
  });

  it('100 → R$ 1,00', () => {
    const result = formatBRL(100).replace(/\s/g, ' ');
    expect(result).toBe('R$ 1,00');
  });

  it('100000 → R$ 1.000,00', () => {
    const result = formatBRL(100_000).replace(/\s/g, ' ');
    expect(result).toBe('R$ 1.000,00');
  });

  it('5000000 → R$ 50.000,00', () => {
    const result = formatBRL(5_000_000).replace(/\s/g, ' ');
    expect(result).toBe('R$ 50.000,00');
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
// maskBRL recebe uma string de dígitos e interpreta como centavos:
//   '100' → 100 centavos (int) → R$ 1,00
//   '5000000' → 5.000.000 centavos → R$ 50.000,00
//   parseBRL(maskBRL(digits)) = parseInt(digits)

describe('maskBRL + parseBRL — round-trip', () => {
  const cases: Array<{ digits: string; expectedCents: number }> = [
    { digits: '5000000', expectedCents: 5_000_000 }, // R$ 50.000,00
    { digits: '50000', expectedCents: 50_000 }, // R$ 500,00
    { digits: '100', expectedCents: 100 }, // R$ 1,00
    { digits: '1234567', expectedCents: 1_234_567 }, // R$ 12.345,67
  ];

  it.each(cases)(
    'digits=$digits → mask → parse → $expectedCents centavos',
    ({ digits, expectedCents }) => {
      const masked = maskBRL(digits);
      const parsed = parseBRL(masked);
      expect(parsed).toBe(expectedCents);
    },
  );
});

// ─── Schema de validação Zod ─────────────────────────────────────────────────

describe('buildSchema — validação com regra ativa', () => {
  const schema = buildSchema(MOCK_RULE);

  it('dados válidos passam na validação', () => {
    const result = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(1_000_000), // R$ 10.000,00
      term_months: '24',
    });
    expect(result.success).toBe(true);
  });

  it('lead_id vazio falha', () => {
    const result = schema.safeParse({
      lead_id: '',
      product_id: 'prod-001',
      amount_display: formatBRL(1_000_000),
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
      amount_display: formatBRL(1_000_000),
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
      amount_display: formatBRL(10_000), // R$ 100,00
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
      amount_display: formatBRL(6_000_000), // R$ 60.000,00
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
      amount_display: formatBRL(1_000_000),
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
      amount_display: formatBRL(1_000_000),
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
      amount_display: formatBRL(1_000_000),
      term_months: '6',
    });
    expect(r1.success).toBe(true);

    const r2 = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(1_000_000),
      term_months: '60',
    });
    expect(r2.success).toBe(true);
  });

  it('valor nos limites exatos (R$ 500,00 e R$ 50.000,00) passa', () => {
    const r1 = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(50_000), // R$ 500,00
      term_months: '12',
    });
    expect(r1.success).toBe(true);

    const r2 = schema.safeParse({
      lead_id: 'lead-001',
      product_id: 'prod-001',
      amount_display: formatBRL(5_000_000), // R$ 50.000,00
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
      amount_display: formatBRL(1_000_000),
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
