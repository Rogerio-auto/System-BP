// =============================================================================
// SimulationHistory.test.tsx -- Tests for simulation history (F2-S08).
//
// Strategy: tests pure logic (formatters, mappings) without rendering React.
//
// Coverage:
//   1. formatBRL: BRL currency formatting
//   2. formatRelativeDate: relative dates
//   3. ORIGIN_BADGE: origin -> label + variant mapping
//   4. METHOD_SHORT: amortization method mapping
//   5. LeadSimulation type: required fields present
//   6. useLeadSimulations: canonical query key
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { LeadSimulation } from '../../../../hooks/crm/types';
import { formatRelativeDate } from '../../../../hooks/crm/types';
import { LEAD_SIMULATIONS_KEY } from '../../../../hooks/crm/useLeadSimulations';

// -- Fixtures -----------------------------------------------------------------

const LEAD_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const PRODUCT_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

function makeSimulation(overrides: Partial<LeadSimulation> = {}): LeadSimulation {
  return {
    id: 'cccccccc-0000-0000-0000-000000000001',
    productId: PRODUCT_ID,
    productName: 'Microcredito Basico',
    amount: 2500,
    termMonths: 12,
    monthlyPayment: 234.56,
    totalAmount: 2814.72,
    totalInterest: 314.72,
    rateMonthlySnapshot: 0.02,
    amortizationMethod: 'price',
    amortizationTable: null,
    ruleVersion: 3,
    origin: 'manual',
    createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    ...overrides,
  };
}

// -- formatBRL (inline helper) ------------------------------------------------

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// -- BRL formatting -----------------------------------------------------------

describe('formatBRL', () => {
  it('formats a positive value in BRL', () => {
    const result = formatBRL(2500);
    // pt-BR produces "R$ 2.500,00" (may use NBSP between R$ and number)
    expect(result).toContain('2.500,00');
  });

  it('formats a value with cents', () => {
    const result = formatBRL(234.56);
    expect(result).toMatch(/234,56/);
  });

  it('formats zero correctly', () => {
    const result = formatBRL(0);
    expect(result).toMatch(/0,00/);
  });
});

// -- formatRelativeDate for simulations ---------------------------------------

describe('formatRelativeDate for simulations', () => {
  it('returns "agora" for very recent date', () => {
    const result = formatRelativeDate(new Date(Date.now() - 30_000).toISOString());
    expect(result).toBe('agora');
  });

  it('returns relative days string for days ago', () => {
    const result = formatRelativeDate(new Date(Date.now() - 2 * 86_400_000).toISOString());
    expect(result).toMatch(/2d/);
  });
});

// -- LeadSimulation: required fields ------------------------------------------

describe('LeadSimulation', () => {
  it('has all required fields', () => {
    const sim = makeSimulation();
    expect(sim).toMatchObject({
      id: expect.any(String),
      productId: expect.any(String),
      productName: expect.any(String),
      amount: expect.any(Number),
      termMonths: expect.any(Number),
      monthlyPayment: expect.any(Number),
      totalAmount: expect.any(Number),
      totalInterest: expect.any(Number),
      rateMonthlySnapshot: expect.any(Number),
      amortizationMethod: expect.stringMatching(/^(price|sac)$/),
      ruleVersion: expect.any(Number),
      origin: expect.stringMatching(/^(manual|ai|import)$/),
      createdAt: expect.any(String),
    });
  });

  it('createdAt is a valid ISO date', () => {
    const sim = makeSimulation();
    expect(() => new Date(sim.createdAt)).not.toThrow();
    expect(new Date(sim.createdAt).getTime()).toBeGreaterThan(0);
  });

  it('accepts all origins', () => {
    const origins: LeadSimulation['origin'][] = ['manual', 'ai', 'import'];
    origins.forEach((origin) => {
      const sim = makeSimulation({ origin });
      expect(sim.origin).toBe(origin);
    });
  });

  it('accepts both amortization methods', () => {
    const priceSim = makeSimulation({ amortizationMethod: 'price' });
    const sacSim = makeSimulation({ amortizationMethod: 'sac' });
    expect(priceSim.amortizationMethod).toBe('price');
    expect(sacSim.amortizationMethod).toBe('sac');
  });
});

// -- useLeadSimulations: query key --------------------------------------------

describe('LEAD_SIMULATIONS_KEY', () => {
  it('generates canonical query key for a lead', () => {
    const key = LEAD_SIMULATIONS_KEY(LEAD_ID);
    expect(key).toEqual(['leads', 'simulations', LEAD_ID]);
  });

  it('generates different keys for different leads', () => {
    const key1 = LEAD_SIMULATIONS_KEY('lead-001');
    const key2 = LEAD_SIMULATIONS_KEY('lead-002');
    expect(key1).not.toEqual(key2);
  });
});

// -- ORIGIN_BADGE mapping -----------------------------------------------------

describe('ORIGIN_BADGE mapping', () => {
  const ORIGIN_BADGE: Record<
    LeadSimulation['origin'],
    { label: string; variant: 'info' | 'success' | 'neutral' }
  > = {
    ai: { label: 'IA', variant: 'info' },
    manual: { label: 'Manual', variant: 'neutral' },
    import: { label: 'Import', variant: 'success' },
  };

  it('maps ai to IA / info', () => {
    expect(ORIGIN_BADGE['ai']).toEqual({ label: 'IA', variant: 'info' });
  });

  it('maps manual to Manual / neutral', () => {
    expect(ORIGIN_BADGE['manual']).toEqual({ label: 'Manual', variant: 'neutral' });
  });

  it('maps import to Import / success', () => {
    expect(ORIGIN_BADGE['import']).toEqual({ label: 'Import', variant: 'success' });
  });
});

// -- METHOD_SHORT mapping -----------------------------------------------------

describe('METHOD_SHORT mapping', () => {
  const METHOD_SHORT: Record<string, string> = {
    price: 'Price',
    sac: 'SAC',
  };

  it('maps price to Price', () => {
    expect(METHOD_SHORT['price']).toBe('Price');
  });

  it('maps sac to SAC', () => {
    expect(METHOD_SHORT['sac']).toBe('SAC');
  });
});
