// =============================================================================
// hydrate.test.ts — Testes unitários (mocados) de hydrate.ts (F6-S27).
//
// Complementa hydration.integration.test.ts (DB real): aqui isolamos o
// dispatch por `type`/`ref.kind` e o mapeamento de erro -> `value: null`,
// sem depender de Postgres — roda sempre, mesmo sem DB local.
// =============================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const MockPool = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({ query: mockQuery, release: vi.fn() }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  }));
  return { Pool: MockPool, default: { Pool: MockPool } };
});

vi.mock('../../internal/assistant/service.js', () => ({
  getAnalysisStatus: vi.fn(),
  getLeadConversation: vi.fn(),
  getFunnelMetrics: vi.fn(),
  getLeadCount: vi.fn(),
  getBillingUpcoming: vi.fn(),
}));

import { db } from '../../../db/client.js';
import { AppError, ForbiddenError, NotFoundError } from '../../../shared/errors.js';
import {
  getAnalysisStatus,
  getBillingUpcoming,
  getFunnelMetrics,
  getLeadConversation,
  getLeadCount,
} from '../../internal/assistant/service.js';
import { hydrateBlocks } from '../hydrate.js';
import type { HydrationActor } from '../hydrate.js';
import type { StoredBlock } from '../schemas.js';

const LEAD_ID = '11111111-1111-1111-1111-111111111111';

const ACTOR: HydrationActor = {
  userId: '22222222-2222-2222-2222-222222222222',
  organizationId: '33333333-3333-3333-3333-333333333333',
  permissions: ['analyses:read', 'livechat:conversation:read'],
  cityScopeIds: null,
};

function block(type: string, ref: StoredBlock['ref']): StoredBlock {
  return { type, ref };
}

describe('hydrateBlocks (F6-S27)', () => {
  // Zera o histórico de chamadas entre os casos — as asserções de
  // `not.toHaveBeenCalled()`/`toHaveBeenCalledWith` dependem de mock limpo;
  // sem isso, chamadas de casos anteriores acumulam e o diff de falha tenta
  // serializar o objeto `db` inteiro (RangeError: Invalid string length).
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ref.kind="none" -> value null, nunca chama nenhum hidratador', async () => {
    const [result] = await hydrateBlocks(db, ACTOR, [
      block('funnel_metrics', { kind: 'none', lead_id: null }),
    ]);
    expect(result).toEqual({
      type: 'funnel_metrics',
      ref: { kind: 'none', lead_id: null },
      value: null,
    });
    expect(getAnalysisStatus).not.toHaveBeenCalled();
    expect(getLeadConversation).not.toHaveBeenCalled();
  });

  it('kind="lead" mas lead_id null -> value null, nunca chama nenhum hidratador', async () => {
    const [result] = await hydrateBlocks(db, ACTOR, [
      block('analysis_status', { kind: 'lead', lead_id: null }),
    ]);
    expect(result?.value).toBeNull();
    expect(getAnalysisStatus).not.toHaveBeenCalled();
  });

  it('type sem hidratador mapeado (forward-compat) -> value null, nunca fabrica forma incompatível', async () => {
    const [result] = await hydrateBlocks(db, ACTOR, [
      block('a_brand_new_block_type', { kind: 'lead', lead_id: LEAD_ID }),
    ]);
    expect(result?.value).toBeNull();
    expect(getAnalysisStatus).not.toHaveBeenCalled();
    expect(getLeadConversation).not.toHaveBeenCalled();
  });

  it('type="analysis_status" com acesso -> value = retorno de getAnalysisStatus, com principal derivado do actor', async () => {
    const mockValue = {
      source: 'assistant.analysis-status' as const,
      leadNameMasked: 'F. Tal',
      analyses: [],
    };
    vi.mocked(getAnalysisStatus).mockResolvedValueOnce(mockValue);

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('analysis_status', { kind: 'lead', lead_id: LEAD_ID }),
    ]);

    expect(result?.value).toEqual(mockValue);
    expect(getAnalysisStatus).toHaveBeenCalledWith(
      db,
      {
        user_id: ACTOR.userId,
        organization_id: ACTOR.organizationId,
        permissions: ACTOR.permissions,
        city_scope_ids: ACTOR.cityScopeIds,
      },
      LEAD_ID,
    );
  });

  it('type="lead_summary" com acesso -> value = retorno de getLeadConversation', async () => {
    const mockValue = {
      source: 'assistant.lead-conversation' as const,
      lead_id: LEAD_ID,
      messages: [],
      truncated: false,
    };
    vi.mocked(getLeadConversation).mockResolvedValueOnce(mockValue);

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('lead_summary', { kind: 'lead', lead_id: LEAD_ID }),
    ]);

    expect(result?.value).toEqual(mockValue);
  });

  it('ForbiddenError (permissão insuficiente hoje) -> value null, nunca lança', async () => {
    vi.mocked(getAnalysisStatus).mockRejectedValueOnce(new ForbiddenError('sem permissao'));

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('analysis_status', { kind: 'lead', lead_id: LEAD_ID }),
    ]);

    expect(result?.value).toBeNull();
  });

  it('NotFoundError (fora de escopo/apagado) -> value null, nunca lança', async () => {
    vi.mocked(getLeadConversation).mockRejectedValueOnce(new NotFoundError('lead nao encontrado'));

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('lead_summary', { kind: 'lead', lead_id: LEAD_ID }),
    ]);

    expect(result?.value).toBeNull();
  });

  it('erro de infraestrutura (não Forbidden/NotFound) propaga -- nunca mascarado como "sem acesso"', async () => {
    vi.mocked(getAnalysisStatus).mockRejectedValueOnce(new Error('db connection lost'));

    await expect(
      hydrateBlocks(db, ACTOR, [block('analysis_status', { kind: 'lead', lead_id: LEAD_ID })]),
    ).rejects.toThrow('db connection lost');
  });

  // ── Agregados re-hidratados ao vivo (kind='aggregate') ──────────────────────

  it('kind="aggregate" funnel_metrics -> re-executa getFunnelMetrics com range + city_ids do ref e principal do actor', async () => {
    const mockValue = {
      source: 'assistant.funnel-metrics' as const,
      stages: [],
      overview: {
        total: 10,
        newInPeriod: 3,
        closedWon: 1,
        closedLost: 0,
        conversionRate: 100,
        rangeLabel: 'Ultimos 30 dias',
      },
    };
    vi.mocked(getFunnelMetrics).mockResolvedValueOnce(mockValue);

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('funnel_metrics', {
        kind: 'aggregate',
        lead_id: null,
        range: 'last30d',
        city_ids: null,
      }),
    ]);

    expect(result?.value).toEqual(mockValue);
    expect(getFunnelMetrics).toHaveBeenCalledWith(
      db,
      {
        user_id: ACTOR.userId,
        organization_id: ACTOR.organizationId,
        permissions: ACTOR.permissions,
        city_scope_ids: ACTOR.cityScopeIds,
      },
      { range: 'last30d', cityIds: undefined },
    );
  });

  it('kind="aggregate" lead_count -> re-executa getLeadCount repassando city_ids do ref', async () => {
    const CITY = '44444444-4444-4444-4444-444444444444';
    vi.mocked(getLeadCount).mockResolvedValueOnce({
      source: 'assistant.lead-count',
      total: 5,
      newInPeriod: 2,
      conversionRate: 0,
      rangeLabel: 'Hoje',
    });

    await hydrateBlocks(db, ACTOR, [
      block('lead_count', { kind: 'aggregate', lead_id: null, range: 'today', city_ids: [CITY] }),
    ]);

    expect(getLeadCount).toHaveBeenCalledWith(db, expect.anything(), {
      range: 'today',
      cityIds: [CITY],
    });
  });

  it('kind="aggregate" billing -> re-executa getBillingUpcoming (sem range, é snapshot)', async () => {
    vi.mocked(getBillingUpcoming).mockResolvedValueOnce({
      source: 'assistant.billing-upcoming',
      totalDues: 0,
      overdueCount: 0,
      upcomingCount: 0,
      totalAmountBrl: 0,
      snapshotLabel: 'Carteira atual',
    });

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('billing', { kind: 'aggregate', lead_id: null, city_ids: null }),
    ]);

    expect(result?.value).not.toBeNull();
    expect(getBillingUpcoming).toHaveBeenCalledWith(db, expect.anything(), undefined);
    expect(getFunnelMetrics).not.toHaveBeenCalled();
  });

  it('kind="aggregate" ForbiddenError (perdeu permissão/escopo) -> value null', async () => {
    vi.mocked(getFunnelMetrics).mockRejectedValueOnce(new ForbiddenError('sem dashboard:read'));

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('funnel_metrics', {
        kind: 'aggregate',
        lead_id: null,
        range: 'last30d',
        city_ids: null,
      }),
    ]);

    expect(result?.value).toBeNull();
  });

  it('kind="aggregate" range não reconstruível ("custom") -> value null, nunca chama o serviço', async () => {
    const [result] = await hydrateBlocks(db, ACTOR, [
      block('funnel_metrics', {
        kind: 'aggregate',
        lead_id: null,
        range: 'custom',
        city_ids: null,
      }),
    ]);

    expect(result?.value).toBeNull();
    expect(getFunnelMetrics).not.toHaveBeenCalled();
  });

  it('kind="aggregate" AppError 400 (range inválido no serviço) -> value null, nunca lança', async () => {
    vi.mocked(getLeadCount).mockRejectedValueOnce(
      new AppError(400, 'VALIDATION_ERROR', 'range invalido'),
    );

    const [result] = await hydrateBlocks(db, ACTOR, [
      block('lead_count', { kind: 'aggregate', lead_id: null, range: 'last7d', city_ids: null }),
    ]);

    expect(result?.value).toBeNull();
  });

  it('kind="aggregate" erro de infraestrutura propaga -- nunca mascarado', async () => {
    vi.mocked(getFunnelMetrics).mockRejectedValueOnce(new Error('db connection lost'));

    await expect(
      hydrateBlocks(db, ACTOR, [
        block('funnel_metrics', {
          kind: 'aggregate',
          lead_id: null,
          range: 'last30d',
          city_ids: null,
        }),
      ]),
    ).rejects.toThrow('db connection lost');
  });

  it('hidrata múltiplos blocos preservando a ordem', async () => {
    vi.mocked(getAnalysisStatus).mockResolvedValueOnce({
      source: 'assistant.analysis-status',
      leadNameMasked: null,
      analyses: [],
    });

    const result = await hydrateBlocks(db, ACTOR, [
      block('funnel_metrics', { kind: 'none', lead_id: null }),
      block('analysis_status', { kind: 'lead', lead_id: LEAD_ID }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('funnel_metrics');
    expect(result[0]?.value).toBeNull();
    expect(result[1]?.type).toBe('analysis_status');
    expect(result[1]?.value).not.toBeNull();
  });
});
