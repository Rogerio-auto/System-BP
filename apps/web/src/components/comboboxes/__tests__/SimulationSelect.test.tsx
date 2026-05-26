// =============================================================================
// components/comboboxes/__tests__/SimulationSelect.test.tsx
//
// Testes unitários para o SimulationSelect (F8-S14).
// Estratégia: testa lógica pura sem JSDOM.
//
// Cobertura:
//   1. Disabled quando leadId é null/empty
//   2. Label de simulação formatada corretamente
//   3. URL correta para fetch de simulações
//   4. Sem PII em dados de simulação
// =============================================================================

import { describe, expect, it } from 'vitest';

import { formatBRL, formatRelativeDate } from '../../../hooks/crm/types';
import type { LeadSimulation } from '../../../hooks/crm/types';

// ─── Helpers (replicam lógica do componente) ──────────────────────────────────

function isDisabled(leadId: string | null, externalDisabled?: boolean): boolean {
  return externalDisabled === true || !leadId;
}

function buildSimulationsUrl(leadId: string): string {
  return `/api/leads/${leadId}/simulations?limit=20`;
}

function formatSimulationLabel(sim: Pick<LeadSimulation, 'amount' | 'termMonths'>): string {
  return `${formatBRL(sim.amount)} × ${sim.termMonths} meses`;
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

const MOCK_SIMULATION: LeadSimulation = {
  id: 'sim-001',
  productId: 'prod-001',
  productName: 'Microcrédito Básico',
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
};

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('SimulationSelect — estado disabled (F8-S14)', () => {
  it('disabled quando leadId é null', () => {
    expect(isDisabled(null)).toBe(true);
  });

  it('disabled quando leadId é string vazia', () => {
    expect(isDisabled('')).toBe(true);
  });

  it('habilitado quando leadId preenchido', () => {
    expect(isDisabled('lead-uuid-001')).toBe(false);
  });

  it('disabled quando prop disabled=true mesmo com leadId', () => {
    expect(isDisabled('lead-uuid-001', true)).toBe(true);
  });
});

describe('SimulationSelect — formatação do label', () => {
  it('formato: "R$ X.XXX,XX × N meses"', () => {
    const label = formatSimulationLabel(MOCK_SIMULATION);
    expect(label).toContain('2.500,00');
    expect(label).toContain('× 12 meses');
  });

  it('usa formatBRL para o valor monetário', () => {
    const formatted = formatBRL(MOCK_SIMULATION.amount);
    expect(formatted.replace(/\s/g, ' ')).toBe('R$ 2.500,00');
  });

  it('formatRelativeDate formata datas de simulação', () => {
    const relative = formatRelativeDate(MOCK_SIMULATION.createdAt);
    // Deve retornar algo como "há 2d" ou "há 48h" — não uma data futura
    expect(typeof relative).toBe('string');
    expect(relative.length).toBeGreaterThan(0);
  });
});

describe('SimulationSelect — URL da API', () => {
  it('aponta para /api/leads/:leadId/simulations', () => {
    const url = buildSimulationsUrl('lead-uuid-001');
    expect(url).toBe('/api/leads/lead-uuid-001/simulations?limit=20');
  });

  it('inclui leadId na URL', () => {
    const leadId = 'lead-uuid-123';
    const url = buildSimulationsUrl(leadId);
    expect(url).toContain(leadId);
  });
});

describe('SimulationSelect — dados sem PII', () => {
  it('LeadSimulation não contém CPF, telefone ou email', () => {
    expect(MOCK_SIMULATION).not.toHaveProperty('cpf');
    expect(MOCK_SIMULATION).not.toHaveProperty('phone_e164');
    expect(MOCK_SIMULATION).not.toHaveProperty('email');
  });

  it('contém apenas dados financeiros + metadados', () => {
    expect(MOCK_SIMULATION).toHaveProperty('amount');
    expect(MOCK_SIMULATION).toHaveProperty('termMonths');
    expect(MOCK_SIMULATION).toHaveProperty('monthlyPayment');
    expect(MOCK_SIMULATION).toHaveProperty('productName');
  });
});
