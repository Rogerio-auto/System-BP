// =============================================================================
// hydrate.test.ts — Testes unitários (mocados) de hydrate.ts (F6-S27).
//
// Complementa hydration.integration.test.ts (DB real): aqui isolamos o
// dispatch por `type`/`ref.kind` e o mapeamento de erro -> `value: null`,
// sem depender de Postgres — roda sempre, mesmo sem DB local.
// =============================================================================
import { describe, expect, it, vi } from 'vitest';

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
}));

import { db } from '../../../db/client.js';
import { ForbiddenError, NotFoundError } from '../../../shared/errors.js';
import { getAnalysisStatus, getLeadConversation } from '../../internal/assistant/service.js';
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
