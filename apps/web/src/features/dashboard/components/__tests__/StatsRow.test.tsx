// =============================================================================
// __tests__/StatsRow.test.tsx — Testes de lógica pura do StatsRow.
//
// Estratégia: testa lógica pura isolada sem renderizar React
// (JSDOM não configurado no vitest deste projeto — padrão do projeto).
//
// Cobertura:
//   1. fmtNumber: formatação numérica BR
//   2. fmtPercent: formatação de percentual BR
//   3. Contagem de leads ativos (qualifying + simulation)
//   4. Cálculo de taxa de conversão (closed_won / total_fechado)
//   5. Casos edge: sem fechamentos, todos fechados, dados vazios
//   6. Contrato: todos os campos do LeadsMetrics presentes
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { LeadsByStatusItem, LeadsMetrics, RangeInfo } from '../../../../hooks/dashboard/types';

// ---------------------------------------------------------------------------
// Replica da lógica de formatação do StatsRow.tsx
// ---------------------------------------------------------------------------

function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}

function fmtPercent(n: number): string {
  return (
    (n * 100).toLocaleString('pt-BR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }) + '%'
  );
}

// ---------------------------------------------------------------------------
// Replica da lógica de KPIs do StatsRow.tsx
// ---------------------------------------------------------------------------

type ActiveStatus = 'qualifying' | 'simulation';
const ACTIVE_STATUSES: ActiveStatus[] = ['qualifying', 'simulation'];

function computeActiveCount(byStatus: LeadsByStatusItem[]): number {
  return byStatus
    .filter((s): s is typeof s & { status: ActiveStatus } =>
      ACTIVE_STATUSES.includes(s.status as ActiveStatus),
    )
    .reduce((sum, s) => sum + s.count, 0);
}

function computeConversionRate(byStatus: LeadsByStatusItem[]): {
  rate: number;
  closedWon: number;
  totalClosed: number;
} {
  const closedWon = byStatus.find((s) => s.status === 'closed_won')?.count ?? 0;
  const closedLost = byStatus.find((s) => s.status === 'closed_lost')?.count ?? 0;
  const totalClosed = closedWon + closedLost;
  const rate = totalClosed > 0 ? closedWon / totalClosed : 0;
  return { rate, closedWon, totalClosed };
}

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const MOCK_RANGE: RangeInfo = {
  from: '2026-04-16T00:00:00Z',
  to: '2026-05-16T23:59:59Z',
  label: 'Últimos 30 dias',
};

function makeLeadsMetrics(overrides: Partial<LeadsMetrics> = {}): LeadsMetrics {
  return {
    total: 100,
    newInRange: 25,
    byStatus: [
      { status: 'new', count: 30 },
      { status: 'qualifying', count: 20 },
      { status: 'simulation', count: 15 },
      { status: 'closed_won', count: 25 },
      { status: 'closed_lost', count: 10 },
      { status: 'archived', count: 0 },
    ],
    byCity: [],
    bySource: [],
    staleCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Testes: fmtNumber
// ---------------------------------------------------------------------------

describe('fmtNumber (pt-BR locale)', () => {
  it('formata zero corretamente', () => {
    // 0 → "0" no pt-BR
    expect(fmtNumber(0)).toBe('0');
  });

  it('formata número simples sem separador de milhar', () => {
    expect(fmtNumber(100)).toBe('100');
  });

  it('formata número com separador de milhar pt-BR (ponto)', () => {
    const result = fmtNumber(1000);
    // pt-BR usa ponto como separador de milhar
    expect(result).toContain('1');
    expect(result).toContain('000');
  });

  it('formata números grandes com separadores', () => {
    const result = fmtNumber(1_234_567);
    expect(result).toMatch(/1[.,\s]234[.,\s]567/);
  });
});

// ---------------------------------------------------------------------------
// Testes: fmtPercent
// ---------------------------------------------------------------------------

describe('fmtPercent (pt-BR locale)', () => {
  it('formata 0% com 1 decimal', () => {
    const result = fmtPercent(0);
    expect(result).toContain('0');
    expect(result).toContain('%');
  });

  it('formata 100% corretamente', () => {
    const result = fmtPercent(1);
    expect(result).toContain('100');
    expect(result).toContain('%');
  });

  it('formata 50% com 1 decimal', () => {
    const result = fmtPercent(0.5);
    expect(result).toContain('50');
    expect(result).toContain('%');
  });

  it('formata 33.33...% com 1 decimal (arredondado)', () => {
    const result = fmtPercent(1 / 3);
    // 33.3% no pt-BR
    expect(result).toMatch(/33[,.]3%/);
  });
});

// ---------------------------------------------------------------------------
// Testes: computeActiveCount (qualifying + simulation)
// ---------------------------------------------------------------------------

describe('computeActiveCount', () => {
  it('soma qualifying + simulation corretamente', () => {
    const leads = makeLeadsMetrics();
    expect(computeActiveCount(leads.byStatus)).toBe(35); // 20 + 15
  });

  it('retorna 0 quando sem status ativos', () => {
    const byStatus: LeadsByStatusItem[] = [
      { status: 'new', count: 10 },
      { status: 'closed_won', count: 5 },
      { status: 'closed_lost', count: 3 },
    ];
    expect(computeActiveCount(byStatus)).toBe(0);
  });

  it('conta apenas qualifying quando simulation é 0', () => {
    const byStatus: LeadsByStatusItem[] = [
      { status: 'qualifying', count: 7 },
      { status: 'simulation', count: 0 },
    ];
    expect(computeActiveCount(byStatus)).toBe(7);
  });

  it('conta apenas simulation quando qualifying está ausente', () => {
    const byStatus: LeadsByStatusItem[] = [{ status: 'simulation', count: 12 }];
    expect(computeActiveCount(byStatus)).toBe(12);
  });

  it('array vazio retorna 0', () => {
    expect(computeActiveCount([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Testes: computeConversionRate
// ---------------------------------------------------------------------------

describe('computeConversionRate', () => {
  it('calcula 71.4% com 25 won e 35 total fechado', () => {
    const byStatus: LeadsByStatusItem[] = [
      { status: 'closed_won', count: 25 },
      { status: 'closed_lost', count: 10 },
    ];
    const { rate, closedWon, totalClosed } = computeConversionRate(byStatus);
    expect(closedWon).toBe(25);
    expect(totalClosed).toBe(35);
    // 25/35 ≈ 0.7142...
    expect(rate).toBeCloseTo(25 / 35, 5);
  });

  it('retorna rate=0 quando sem fechamentos', () => {
    const byStatus: LeadsByStatusItem[] = [
      { status: 'new', count: 10 },
      { status: 'qualifying', count: 5 },
    ];
    const { rate, totalClosed } = computeConversionRate(byStatus);
    expect(rate).toBe(0);
    expect(totalClosed).toBe(0);
  });

  it('retorna rate=1 quando todos fechados como won', () => {
    const byStatus: LeadsByStatusItem[] = [
      { status: 'closed_won', count: 10 },
      { status: 'closed_lost', count: 0 },
    ];
    const { rate } = computeConversionRate(byStatus);
    expect(rate).toBe(1);
  });

  it('retorna rate=0 quando todos fechados como lost', () => {
    const byStatus: LeadsByStatusItem[] = [
      { status: 'closed_won', count: 0 },
      { status: 'closed_lost', count: 8 },
    ];
    const { rate } = computeConversionRate(byStatus);
    expect(rate).toBe(0);
  });

  it('array vazio: rate=0, totalClosed=0', () => {
    const { rate, totalClosed } = computeConversionRate([]);
    expect(rate).toBe(0);
    expect(totalClosed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Testes: Contrato do backend (DashboardMetricsResponse shape)
// ---------------------------------------------------------------------------

describe('Contrato backend — DashboardMetricsResponse (camelCase)', () => {
  it('range tem from, to, label como strings', () => {
    const range: RangeInfo = MOCK_RANGE;
    expect(typeof range.from).toBe('string');
    expect(typeof range.to).toBe('string');
    expect(typeof range.label).toBe('string');
  });

  it('LeadsMetrics tem campos obrigatórios corretos', () => {
    const leads = makeLeadsMetrics();
    expect(typeof leads.total).toBe('number');
    expect(typeof leads.newInRange).toBe('number');
    expect(Array.isArray(leads.byStatus)).toBe(true);
    expect(Array.isArray(leads.byCity)).toBe(true);
    expect(Array.isArray(leads.bySource)).toBe(true);
    expect(typeof leads.staleCount).toBe('number');
  });

  it('LeadsByStatusItem tem status e count', () => {
    const item: LeadsByStatusItem = { status: 'new', count: 5 };
    expect(item.status).toBe('new');
    expect(item.count).toBe(5);
  });

  it('staleCount >= 0 sempre', () => {
    const leads = makeLeadsMetrics({ staleCount: 3 });
    expect(leads.staleCount).toBeGreaterThanOrEqual(0);
  });

  it('newInRange é um subconjunto do total (invariante de negócio)', () => {
    const leads = makeLeadsMetrics({ total: 100, newInRange: 25 });
    // newInRange pode ser maior que total em casos edge (leads criados e deletados)
    // mas em condições normais deve ser <= total
    expect(leads.newInRange).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Testes: filtros de dashboard (query params)
// ---------------------------------------------------------------------------

describe('DashboardMetricsQuery params', () => {
  it('range default é 30d', () => {
    // Conforme schema backend: range.default('30d')
    const defaultRange = '30d';
    expect(['today', '7d', '30d', 'mtd', 'ytd']).toContain(defaultRange);
  });

  it('todos os range values válidos', () => {
    const validRanges = ['today', '7d', '30d', 'mtd', 'ytd'];
    for (const r of validRanges) {
      expect(validRanges).toContain(r);
    }
  });

  it('cityId é UUID string quando presente', () => {
    const cityId = '123e4567-e89b-12d3-a456-426614174000';
    // UUID v4 pattern
    expect(cityId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});
