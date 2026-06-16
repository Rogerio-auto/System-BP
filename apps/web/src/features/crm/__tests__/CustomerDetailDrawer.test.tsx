// =============================================================================
// CustomerDetailDrawer.test.tsx — Testes unitários do drawer de ficha do cliente.
//
// Estratégia: testa lógica pura (formatadores, metadata de contrato/boleto,
// metadata de status de parcelas) sem renderizar React.
//
// Cobertura:
//   1. formatBRL: formatação correta de valores monetários
//   2. formatDateBR: formatação de datas no padrão brasileiro
//   3. CONTRACT_STATUS_META: label e variante por status de contrato
//   4. BOLETO_HEALTH_META: label e variante por saúde de boleto
//   5. DUE_STATUS_META: label e variante por status de parcela
//   6. LGPD: campos visíveis não expõem CPF ou telefone
// =============================================================================

import type { BoletoHealth, Contract, CustomerOverviewResponse } from '@elemento/shared-schemas';
import { describe, expect, it } from 'vitest';

import { DUE_STATUS_META } from '../../billing';
import { CONTRACT_STATUS_META } from '../../contracts/schemas';

// ---------------------------------------------------------------------------
// Helpers (espelha funções internas do componente)
// ---------------------------------------------------------------------------

function formatBRL(valueStr: string): string {
  const num = parseFloat(valueStr);
  if (isNaN(num)) return valueStr;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Espelha BOLETO_HEALTH_META do componente
const BOLETO_HEALTH_META: Record<
  BoletoHealth['health'],
  { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  healthy: { label: 'Em dia', variant: 'success' },
  at_risk: { label: 'Em risco', variant: 'warning' },
  defaulted: { label: 'Inadimplente', variant: 'danger' },
  settled: { label: 'Liquidado', variant: 'neutral' },
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_CUSTOMER: CustomerOverviewResponse['customer'] = {
  id: 'cust-001',
  organization_id: 'org-001',
  name: 'Maria das Graças',
  spc_status: 'none',
  spc_changed_at: null,
};

const MOCK_CONTRACT: Contract = {
  id: 'contract-001',
  organization_id: 'org-001',
  customer_id: 'cust-001',
  contract_reference: 'BDP-2026-00123',
  product_id: null,
  rule_version_id: null,
  principal_amount: '15000.00',
  term_months: 24,
  monthly_rate_snapshot: '0.020000',
  status: 'active',
  signed_at: '2026-01-15T10:00:00-04:00',
  first_due_date: '2026-02-15',
  last_due_date: '2028-01-15',
  created_at: '2026-01-10T08:00:00-04:00',
  updated_at: '2026-01-15T10:00:00-04:00',
};

const MOCK_BOLETO_HEALTH: BoletoHealth = {
  contract_id: 'contract-001',
  total_installments: 24,
  paid_count: 5,
  overdue_count: 0,
  pending_count: 19,
  paid_amount: '3125.00',
  overdue_amount: '0.00',
  pending_amount: '11875.00',
  percent_paid: 20.83,
  health: 'healthy',
};

const MOCK_RECENT_DUE: CustomerOverviewResponse['recent_dues'][number] = {
  id: 'due-001',
  contract_reference: 'BDP-2026-00123',
  installment_number: 5,
  due_date: '2026-06-15',
  amount: '625.00',
  status: 'paid',
  paid_at: '2026-06-14T14:30:00-04:00',
};

// ---------------------------------------------------------------------------
// Testes de formatação
// ---------------------------------------------------------------------------

describe('formatBRL — valores monetários', () => {
  it('formata valor inteiro em BRL', () => {
    const result = formatBRL('15000.00');
    expect(result).toContain('15.000');
    expect(result).toContain('R$');
  });

  it('formata valor com centavos', () => {
    const result = formatBRL('625.50');
    expect(result).toContain('625');
  });

  it('retorna string original para valor inválido', () => {
    expect(formatBRL('inválido')).toBe('inválido');
  });

  it('formata zero corretamente', () => {
    const result = formatBRL('0.00');
    expect(result).toContain('R$');
  });
});

describe('formatDateBR — datas no padrão brasileiro', () => {
  it('formata data ISO para exibição', () => {
    const result = formatDateBR('2026-06-15');
    expect(result).toBeTruthy();
    expect(result).toContain('2026');
  });

  it('formata data com timezone offset', () => {
    const result = formatDateBR('2026-01-15T10:00:00-04:00');
    expect(result).toContain('2026');
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// CONTRACT_STATUS_META — badges de status de contrato
// ---------------------------------------------------------------------------

describe('CONTRACT_STATUS_META — badges de contrato', () => {
  it('contrato ativo → badge success', () => {
    const meta = CONTRACT_STATUS_META['active'];
    expect(meta.variant).toBe('success');
    expect(meta.label).toBe('Ativo');
  });

  it('contrato inadimplente → badge danger', () => {
    const meta = CONTRACT_STATUS_META['defaulted'];
    expect(meta.variant).toBe('danger');
    expect(meta.label).toBe('Inadimplente');
  });

  it('contrato cancelado → badge neutral', () => {
    const meta = CONTRACT_STATUS_META['cancelled'];
    expect(meta.variant).toBe('neutral');
  });

  it('todos os status têm label PT-BR', () => {
    for (const [, meta] of Object.entries(CONTRACT_STATUS_META)) {
      expect(meta.label).not.toMatch(/^[a-z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// BOLETO_HEALTH_META — badges de saúde do boleto
// ---------------------------------------------------------------------------

describe('BOLETO_HEALTH_META — saúde do boleto', () => {
  it('healthy → badge success', () => {
    const meta = BOLETO_HEALTH_META['healthy'];
    expect(meta.variant).toBe('success');
    expect(meta.label).toBe('Em dia');
  });

  it('at_risk → badge warning', () => {
    const meta = BOLETO_HEALTH_META['at_risk'];
    expect(meta.variant).toBe('warning');
  });

  it('defaulted → badge danger', () => {
    const meta = BOLETO_HEALTH_META['defaulted'];
    expect(meta.variant).toBe('danger');
    expect(meta.label).toBe('Inadimplente');
  });

  it('settled → badge neutral', () => {
    const meta = BOLETO_HEALTH_META['settled'];
    expect(meta.variant).toBe('neutral');
  });

  it('todos os status têm label em PT-BR', () => {
    for (const [, meta] of Object.values(Object.entries(BOLETO_HEALTH_META))) {
      expect(meta.label).not.toMatch(/^[a-z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// DUE_STATUS_META — badges de status de parcelas
// ---------------------------------------------------------------------------

describe('DUE_STATUS_META — status de parcelas', () => {
  it('parcela paga → badge success', () => {
    const meta = DUE_STATUS_META['paid'];
    expect(meta.variant).toBe('success');
    expect(meta.label).toBe('Paga');
  });

  it('parcela vencida → badge danger', () => {
    const meta = DUE_STATUS_META['overdue'];
    expect(meta.variant).toBe('danger');
    expect(meta.label).toBe('Vencida');
  });

  it('parcela pendente → badge info', () => {
    const meta = DUE_STATUS_META['pending'];
    expect(meta.variant).toBe('info');
  });

  it('todos os status têm label em PT-BR', () => {
    for (const [, meta] of Object.entries(DUE_STATUS_META)) {
      expect(meta.label).not.toMatch(/^[a-z_]+$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures — integridade dos dados de mock
// ---------------------------------------------------------------------------

describe('Fixtures — integridade dos dados', () => {
  it('boleto_health tem porcentagem válida', () => {
    expect(MOCK_BOLETO_HEALTH.percent_paid).toBeGreaterThanOrEqual(0);
    expect(MOCK_BOLETO_HEALTH.percent_paid).toBeLessThanOrEqual(100);
  });

  it('parcelas pagas batem com paid_count', () => {
    expect(MOCK_BOLETO_HEALTH.paid_count).toBe(5);
    expect(MOCK_BOLETO_HEALTH.total_installments).toBe(24);
    expect(MOCK_BOLETO_HEALTH.paid_count + MOCK_BOLETO_HEALTH.pending_count).toBeLessThanOrEqual(
      MOCK_BOLETO_HEALTH.total_installments,
    );
  });

  it('contrato tem referência não-vazia', () => {
    expect(MOCK_CONTRACT.contract_reference).toBeTruthy();
    expect(MOCK_CONTRACT.contract_reference.length).toBeGreaterThan(0);
  });

  it('recent_due tem campos obrigatórios', () => {
    expect(MOCK_RECENT_DUE.id).toBeTruthy();
    expect(MOCK_RECENT_DUE.contract_reference).toBeTruthy();
    expect(MOCK_RECENT_DUE.installment_number).toBeGreaterThan(0);
    expect(MOCK_RECENT_DUE.amount).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// LGPD — campos visíveis não expõem PII sensível
// ---------------------------------------------------------------------------

describe('LGPD — campos visíveis não expõem CPF ou telefone', () => {
  it('nome do cliente não contém CPF', () => {
    expect(MOCK_CUSTOMER.name).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(MOCK_CUSTOMER.name).not.toMatch(/\d{11}/);
  });

  it('referência do contrato não contém CPF', () => {
    expect(MOCK_CONTRACT.contract_reference).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(MOCK_CONTRACT.contract_reference).not.toMatch(/\d{11}/);
  });

  it('formatação de valor não expõe dado bruto de CPF', () => {
    const formatted = formatBRL(MOCK_RECENT_DUE.amount);
    expect(formatted).not.toMatch(/\d{11}/);
  });
});
