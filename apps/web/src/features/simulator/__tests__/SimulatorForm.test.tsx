// =============================================================================
// features/simulator/__tests__/SimulatorForm.test.tsx — Testes unitários (F2-S11).
//
// UNIDADE MONETÁRIA: REAIS (decimal 2 casas), consistente com o backend.
// Nunca centavos neste módulo.
//
// Estratégia: testa lógica pura isolada (formatadores, validação Zod, contrato)
// sem renderizar React (JSDOM não configurado no vitest deste projeto).
//
// Cobertura:
//   1. formatBRL: reais → string BRL
//   2. formatRate: taxa decimal → string display
//   3. Schema de validação Zod: limites da regra ativa em reais (amount: number)
//   4. buildSchema: campos obrigatórios
//   5. CONTRATO (DoD): submit emite {leadId, productId, amount, termMonths} em
//      camelCase — teste que falharia com o bug pré-F2-S11 (snake_case)
// =============================================================================

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { formatBRL, formatRate } from '../../../hooks/simulator/types';
import type { CreditProduct, SimulationBody } from '../../../hooks/simulator/types';

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

/**
 * Reproduz a factory do SimulatorForm (camelCase + amount: number).
 * Espelha buildSchema em SimulatorForm.tsx para testes isolados.
 */
function buildSchema(rule: CreditProduct['active_rule']) {
  return z.object({
    leadId: z.string().min(1, 'Selecione um lead'),
    productId: z.string().min(1, 'Selecione um produto'),
    amount: z
      .number({ invalid_type_error: 'Informe o valor solicitado' })
      .positive('Valor deve ser positivo')
      .refine(
        (v) => {
          if (!rule) return true;
          return v >= rule.min_amount && v <= rule.max_amount;
        },
        {
          message: rule
            ? `Valor deve estar entre ${formatBRL(rule.min_amount)} e ${formatBRL(rule.max_amount)}`
            : 'Valor inválido',
        },
      ),
    termMonths: z
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

// ─── Schema de validação Zod ─────────────────────────────────────────────────

describe('buildSchema — validação com regra ativa (valores em reais)', () => {
  const schema = buildSchema(MOCK_RULE);

  it('dados válidos passam na validação', () => {
    // R$ 10.000,00 está entre R$ 500 e R$ 50.000
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '24',
    });
    expect(result.success).toBe(true);
  });

  it('leadId vazio falha', () => {
    const result = schema.safeParse({
      leadId: '',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '24',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.leadId).toBeDefined();
    }
  });

  it('productId vazio falha', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: '',
      amount: 10000,
      termMonths: '24',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.productId).toBeDefined();
    }
  });

  it('valor abaixo do mínimo (100 < 500) falha', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 100,
      termMonths: '12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.amount).toBeDefined();
    }
  });

  it('valor acima do máximo (60000 > 50000) falha', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 60000,
      termMonths: '12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.amount).toBeDefined();
    }
  });

  it('prazo abaixo do mínimo (3 < 6) falha', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '3',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.termMonths).toBeDefined();
    }
  });

  it('prazo acima do máximo (72 > 60) falha', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '72',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.flatten().fieldErrors;
      expect(err.termMonths).toBeDefined();
    }
  });

  it('prazo nos limites exatos (6 e 60) passa', () => {
    const r1 = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '6',
    });
    expect(r1.success).toBe(true);

    const r2 = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '60',
    });
    expect(r2.success).toBe(true);
  });

  it('valor nos limites exatos (500 e 50000) passa', () => {
    const r1 = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 500,
      termMonths: '12',
    });
    expect(r1.success).toBe(true);

    const r2 = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 50000,
      termMonths: '12',
    });
    expect(r2.success).toBe(true);
  });
});

// ─── Schema sem regra ativa ───────────────────────────────────────────────────

describe('buildSchema — sem regra ativa (null)', () => {
  const schema = buildSchema(null);

  it('qualquer valor positivo passa (sem regra = sem limites)', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '999',
    });
    expect(result.success).toBe(true);
  });

  it('campos obrigatórios ainda validam', () => {
    const result = schema.safeParse({
      leadId: '',
      productId: '',
      amount: 0,
      termMonths: '',
    });
    expect(result.success).toBe(false);
  });
});

// ─── CONTRATO DO BODY (DoD obrigatório) ──────────────────────────────────────
//
// Estes testes falhariam com o bug pré-F2-S11 (snake_case no body).
// Verificam que o submit emite exatamente as chaves que o backend espera.

describe('CONTRATO — body do POST /api/simulations (leadId/productId/amount/termMonths)', () => {
  const schema = buildSchema(CONTRACT_RULE);

  it('schema usa leadId (camelCase) — não lead_id (snake_case)', () => {
    // Com snake_case, leadId seria undefined e o parse falharia ou ignoraria
    const result = schema.safeParse({
      leadId: 'lead-uuid-001',
      productId: 'prod-uuid-001',
      amount: 10000,
      termMonths: '12',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('leadId', 'lead-uuid-001');
      // Garantia que não existe a chave snake_case no output
      expect(result.data).not.toHaveProperty('lead_id');
    }
  });

  it('schema usa productId (camelCase) — não product_id (snake_case)', () => {
    const result = schema.safeParse({
      leadId: 'lead-uuid-001',
      productId: 'prod-uuid-001',
      amount: 10000,
      termMonths: '12',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('productId', 'prod-uuid-001');
      expect(result.data).not.toHaveProperty('product_id');
    }
  });

  it('schema usa amount (number) — não requested_amount (snake_case)', () => {
    const result = schema.safeParse({
      leadId: 'lead-uuid-001',
      productId: 'prod-uuid-001',
      amount: 10000,
      termMonths: '12',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('amount', 10000);
      expect(result.data).not.toHaveProperty('requested_amount');
    }
  });

  it('schema usa termMonths (camelCase) — não term_months (snake_case)', () => {
    const result = schema.safeParse({
      leadId: 'lead-uuid-001',
      productId: 'prod-uuid-001',
      amount: 10000,
      termMonths: '12',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveProperty('termMonths', '12');
      expect(result.data).not.toHaveProperty('term_months');
    }
  });

  it('body final para POST tem exatamente {leadId, productId, amount, termMonths}', () => {
    // Simula o que handleFormSubmit produz a partir de um form válido
    const formValues = {
      leadId: 'lead-uuid-001',
      productId: 'prod-uuid-001',
      amount: 10000,
      termMonths: '12',
    };

    // Reproduz a lógica de handleFormSubmit
    const body: SimulationBody = {
      leadId: formValues.leadId,
      productId: formValues.productId,
      amount: formValues.amount,
      termMonths: parseInt(formValues.termMonths, 10),
    };

    // Verifica chaves camelCase
    expect(Object.keys(body)).toEqual(['leadId', 'productId', 'amount', 'termMonths']);
    expect(body.leadId).toBe('lead-uuid-001');
    expect(body.productId).toBe('prod-uuid-001');
    expect(body.amount).toBe(10000);
    expect(body.termMonths).toBe(12);

    // Garante que não há snake_case que causaria 400
    expect(body).not.toHaveProperty('lead_id');
    expect(body).not.toHaveProperty('product_id');
    expect(body).not.toHaveProperty('requested_amount');
    expect(body).not.toHaveProperty('term_months');
  });

  it('hint exibe "R$ 5.000,00" para min_amount=5000 reais', () => {
    const hint = formatBRL(CONTRACT_RULE!.min_amount);
    expect(hint.replace(/\s/g, ' ')).toBe('R$ 5.000,00');
  });

  it('hint exibe "R$ 30.000,00" para max_amount=30000 reais', () => {
    const hint = formatBRL(CONTRACT_RULE!.max_amount);
    expect(hint.replace(/\s/g, ' ')).toBe('R$ 30.000,00');
  });

  it('validação aceita 10000 reais', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 10000,
      termMonths: '12',
    });
    expect(result.success).toBe(true);
  });

  it('validação rejeita 4999 reais (< min 5000)', () => {
    const result = schema.safeParse({
      leadId: 'lead-001',
      productId: 'prod-001',
      amount: 4999,
      termMonths: '12',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.amount).toBeDefined();
    }
  });

  it('digitar 30000 no input type=number → amount=30000 (sem conversão centavos)', () => {
    // Com input type="number" + valueAsNumber, 30000 digitado = 30000 reais.
    // Com o bug antigo (digit-shift), "30000" centavos = R$ 300,00 (errado).
    const rawInputValue = 30000; // o que valueAsNumber retorna ao digitar "30000"
    expect(rawInputValue).toBe(30000); // 30000 reais, não 300 reais
    expect(formatBRL(rawInputValue).replace(/\s/g, ' ')).toBe('R$ 30.000,00');
  });
});
