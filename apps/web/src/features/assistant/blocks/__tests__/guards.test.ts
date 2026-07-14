// =============================================================================
// blocks/__tests__/guards.test.ts — Testes unitários dos type guards de
// `value` (unknown) dos blocos do copiloto interno (F6-S22).
// =============================================================================

import { describe, expect, it } from 'vitest';

import {
  isAnalysisStatusValue,
  isBillingValue,
  isFunnelMetricsValue,
  isLeadCountValue,
  isLeadSummaryValue,
  isRecord,
} from '../guards';

describe('isRecord', () => {
  it('aceita objeto plano', () => {
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('rejeita null, array e primitivos', () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe('isFunnelMetricsValue', () => {
  const stage = {
    stageId: 's1',
    stageName: 'Novo',
    stageOrder: 1,
    cardCount: 5,
    staleCardCount: 1,
    avgDwellHours: 12.5,
  };

  const valid = {
    source: 'assistant.funnel-metrics',
    stages: [stage],
    overview: {
      total: 10,
      newInPeriod: 3,
      closedWon: 2,
      closedLost: 1,
      conversionRate: 66.67,
      rangeLabel: 'Últimos 30 dias',
    },
  };

  it('aceita a forma completa', () => {
    expect(isFunnelMetricsValue(valid)).toBe(true);
  });

  it('aceita avgDwellHours null (estágio sem dwell calculável)', () => {
    const withNullDwell = {
      ...valid,
      stages: [{ ...stage, avgDwellHours: null }],
    };
    expect(isFunnelMetricsValue(withNullDwell)).toBe(true);
  });

  it('rejeita overview ausente', () => {
    const { overview: _overview, ...rest } = valid;
    expect(isFunnelMetricsValue(rest)).toBe(false);
  });

  it('rejeita stages não-array', () => {
    expect(isFunnelMetricsValue({ ...valid, stages: 'nope' })).toBe(false);
  });

  it('rejeita null, undefined e tipos primitivos', () => {
    expect(isFunnelMetricsValue(null)).toBe(false);
    expect(isFunnelMetricsValue(undefined)).toBe(false);
    expect(isFunnelMetricsValue('texto')).toBe(false);
  });
});

describe('isLeadCountValue', () => {
  it('aceita a forma completa', () => {
    expect(
      isLeadCountValue({
        source: 'assistant.lead-count',
        total: 10,
        newInPeriod: 3,
        conversionRate: 30,
        rangeLabel: 'Este mês',
      }),
    ).toBe(true);
  });

  it('rejeita campo numérico faltando', () => {
    expect(isLeadCountValue({ source: 'assistant.lead-count', total: 10, rangeLabel: 'x' })).toBe(
      false,
    );
  });
});

describe('isAnalysisStatusValue', () => {
  it('aceita leadNameMasked null e lista de análises', () => {
    expect(
      isAnalysisStatusValue({
        source: 'assistant.analysis-status',
        leadNameMasked: null,
        analyses: [
          {
            id: 'a1',
            status: 'aprovado',
            approvedAmountBrl: 5000,
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBe(true);
  });

  it('rejeita entrada de análise malformada (status ausente)', () => {
    expect(
      isAnalysisStatusValue({
        source: 'assistant.analysis-status',
        leadNameMasked: 'J. Silva',
        analyses: [{ id: 'a1', approvedAmountBrl: null, createdAt: '2026-01-01T00:00:00Z' }],
      }),
    ).toBe(false);
  });
});

describe('isBillingValue', () => {
  it('aceita snapshot completo', () => {
    expect(
      isBillingValue({
        source: 'assistant.billing-upcoming',
        totalDues: 12,
        overdueCount: 4,
        upcomingCount: 8,
        totalAmountBrl: 15000.5,
        snapshotLabel: 'Carteira atual',
      }),
    ).toBe(true);
  });

  it('rejeita totalAmountBrl não-numérico', () => {
    expect(
      isBillingValue({
        source: 'assistant.billing-upcoming',
        totalDues: 12,
        overdueCount: 4,
        upcomingCount: 8,
        totalAmountBrl: '15000',
        snapshotLabel: 'Carteira atual',
      }),
    ).toBe(false);
  });
});

describe('isLeadSummaryValue', () => {
  it('aceita mensagens com content null (mídia)', () => {
    expect(
      isLeadSummaryValue({
        source: 'assistant.lead-conversation',
        lead_id: '11111111-1111-1111-1111-111111111111',
        messages: [
          { direction: 'in', content: null, created_at: '2026-01-01T00:00:00Z' },
          { direction: 'out', content: 'olá', created_at: '2026-01-01T00:01:00Z' },
        ],
        truncated: false,
      }),
    ).toBe(true);
  });

  it('rejeita direction fora de in/out', () => {
    expect(
      isLeadSummaryValue({
        source: 'assistant.lead-conversation',
        lead_id: 'x',
        messages: [{ direction: 'sideways', content: 'oi', created_at: '2026-01-01T00:00:00Z' }],
        truncated: false,
      }),
    ).toBe(false);
  });
});
