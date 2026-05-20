// =============================================================================
// ai-console/decisions/__tests__/decisions.test.tsx
//
// Testes de lógica pura do módulo de decisões do agente de IA.
//
// Estratégia: lógica pura sem renderização React — alinhado ao padrão do
// prompts.test.tsx. Não depende de JSDOM nem de TanStack Query.
//
// Cobertura:
//   1. Query keys — formato estável, sem colisão
//   2. RBAC — gating de ai_decisions:read
//   3. Formatadores — custo, latência, data
//   4. Construção de query string dos filtros
//   5. Lógica de summary bar (agregação de custo/tokens/duração)
//   6. Ordenação cronológica da timeline
//   7. Filtragem de decisões por erro
// =============================================================================

import { describe, expect, it } from 'vitest';

import { decisionsQueryKeys } from '../../../../../hooks/ai-console/useDecisions';

// ─── Helpers de fábrica ───────────────────────────────────────────────────────

// Usa spread de defaults + overrides para que null seja preservado
// (o operador ?? trataria null como "ausente", o que quebraria os testes de custo nulo).
const DECISION_DEFAULTS = {
  id: 'uuid-decision-1',
  conversation_id: 'conv_abc123' as string | null,
  lead_id: null as string | null,
  node_name: 'router',
  intent: 'qualificação' as string | null,
  model: 'claude-3-haiku' as string | null,
  prompt_version: 2 as number | null,
  tokens_in: 500 as number | null,
  tokens_out: 250 as number | null,
  cost_usd: 0.0012 as number | null,
  cost_brl: 0.006 as number | null,
  latency_ms: 850 as number | null,
  decision: { masked: true } as unknown,
  error: null as string | null,
  chatwoot_conversation_id: null as number | null,
  created_at: '2025-05-19T10:00:00.000Z',
};

function makeDecision(overrides: Partial<typeof DECISION_DEFAULTS>) {
  return { ...DECISION_DEFAULTS, ...overrides };
}

// ─── 1. Query keys ────────────────────────────────────────────────────────────

describe('decisionsQueryKeys', () => {
  it('all retorna prefixo estável', () => {
    expect(decisionsQueryKeys.all).toEqual(['ai-console', 'decisions']);
  });

  it('list() inclui filtros no path', () => {
    const qk = decisionsQueryKeys.list({ intent: 'qualificação' });
    expect(qk[0]).toBe('ai-console');
    expect(qk[1]).toBe('decisions');
    expect(qk[2]).toBe('list');
    expect(qk[3]).toMatchObject({ intent: 'qualificação' });
  });

  it('list() com filtros diferentes não colide', () => {
    const a = JSON.stringify(decisionsQueryKeys.list({ intent: 'a' }));
    const b = JSON.stringify(decisionsQueryKeys.list({ intent: 'b' }));
    expect(a).not.toBe(b);
  });

  it('timeline() inclui conversationId', () => {
    const qk = decisionsQueryKeys.timeline('conv_abc123');
    expect(qk).toEqual(['ai-console', 'decisions', 'timeline', 'conv_abc123']);
  });

  it('timelines de conversas diferentes não colidem', () => {
    const a = JSON.stringify(decisionsQueryKeys.timeline('conv_1'));
    const b = JSON.stringify(decisionsQueryKeys.timeline('conv_2'));
    expect(a).not.toBe(b);
  });
});

// ─── 2. RBAC ─────────────────────────────────────────────────────────────────

describe('RBAC — gating de ai_decisions:read', () => {
  const PERMISSION = 'ai_decisions:read';

  function hasPermission(perms: string[], required: string): boolean {
    return perms.includes(required);
  }

  it('admin tem ai_decisions:read', () => {
    const perms = ['ai_decisions:read', 'ai_prompts:read', 'leads:write'];
    expect(hasPermission(perms, PERMISSION)).toBe(true);
  });

  it('agente não tem ai_decisions:read', () => {
    const perms = ['leads:read', 'crm:write'];
    expect(hasPermission(perms, PERMISSION)).toBe(false);
  });

  it('sem permissões → false', () => {
    expect(hasPermission([], PERMISSION)).toBe(false);
  });

  it('ai_prompts:read não implica ai_decisions:read', () => {
    const perms = ['ai_prompts:read', 'ai_prompts:write'];
    expect(hasPermission(perms, PERMISSION)).toBe(false);
  });
});

// ─── 3. Formatadores ──────────────────────────────────────────────────────────

describe('formatCost', () => {
  function formatCost(value: number | null | undefined, currency: 'USD' | 'BRL'): string {
    if (value === null || value === undefined) return '—';
    if (currency === 'USD') return `$${value.toFixed(4)}`;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    }).format(value);
  }

  it('null → "—"', () => {
    expect(formatCost(null, 'USD')).toBe('—');
    expect(formatCost(null, 'BRL')).toBe('—');
  });

  it('undefined → "—"', () => {
    expect(formatCost(undefined, 'USD')).toBe('—');
  });

  it('USD formata com 4 casas decimais', () => {
    expect(formatCost(0.0012, 'USD')).toBe('$0.0012');
  });

  it('zero custo → exibido (não "—")', () => {
    expect(formatCost(0, 'USD')).toBe('$0.0000');
  });
});

describe('formatLatency', () => {
  function formatLatency(ms: number | null | undefined): string {
    if (ms === null || ms === undefined) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  it('null → "—"', () => {
    expect(formatLatency(null)).toBe('—');
  });

  it('ms < 1000 → exibe em ms', () => {
    expect(formatLatency(850)).toBe('850ms');
    expect(formatLatency(0)).toBe('0ms');
  });

  it('ms >= 1000 → exibe em segundos com 1 decimal', () => {
    expect(formatLatency(1500)).toBe('1.5s');
    expect(formatLatency(2000)).toBe('2.0s');
  });

  it('999ms ainda é ms', () => {
    expect(formatLatency(999)).toBe('999ms');
  });
});

describe('formatDateTime', () => {
  function formatDateTime(iso: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(iso));
  }

  it('retorna string não-vazia para ISO válida', () => {
    const result = formatDateTime('2025-05-19T10:30:00.000Z');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contém o ano correto', () => {
    const result = formatDateTime('2025-05-19T10:30:00.000Z');
    expect(result).toContain('2025');
  });
});

// ─── 4. Query string de filtros ───────────────────────────────────────────────

describe('buildListQs — construção de query string', () => {
  function buildListQs(filters: {
    date_from?: string;
    date_to?: string;
    conversation_id?: string;
    lead_id?: string;
    intent?: string;
    node?: string;
    model?: string;
    cursor?: string;
    limit?: number;
  }): string {
    const params = new URLSearchParams();
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);
    if (filters.conversation_id) params.set('conversation_id', filters.conversation_id);
    if (filters.lead_id) params.set('lead_id', filters.lead_id);
    if (filters.intent) params.set('intent', filters.intent);
    if (filters.node) params.set('node', filters.node);
    if (filters.model) params.set('model', filters.model);
    if (filters.cursor) params.set('cursor', filters.cursor);
    if (filters.limit) params.set('limit', String(filters.limit));
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  it('filtros vazios → string vazia', () => {
    expect(buildListQs({})).toBe('');
  });

  it('filtros parciais → apenas campos preenchidos', () => {
    const qs = buildListQs({ intent: 'qualificação', model: 'claude-3' });
    expect(qs).toContain('intent=');
    expect(qs).toContain('model=');
    expect(qs).not.toContain('date_from');
    expect(qs).not.toContain('lead_id');
  });

  it('cursor é incluído quando presente', () => {
    const qs = buildListQs({ cursor: 'abc123' });
    expect(qs).toContain('cursor=abc123');
  });

  it('limit é incluído quando presente', () => {
    const qs = buildListQs({ limit: 50 });
    expect(qs).toContain('limit=50');
  });

  it('todos os filtros são incluídos', () => {
    const qs = buildListQs({
      date_from: '2025-01-01',
      date_to: '2025-05-31',
      conversation_id: 'conv_abc',
      lead_id: 'uuid-lead',
      intent: 'analise',
      node: 'router',
      model: 'claude-3-haiku',
      limit: 25,
    });
    expect(qs).toContain('date_from=2025-01-01');
    expect(qs).toContain('date_to=2025-05-31');
    expect(qs).toContain('conversation_id=conv_abc');
    expect(qs).toContain('lead_id=uuid-lead');
    expect(qs).toContain('intent=analise');
    expect(qs).toContain('node=router');
    expect(qs).toContain('model=claude-3-haiku');
    expect(qs).toContain('limit=25');
  });
});

// ─── 5. Lógica de summary bar ─────────────────────────────────────────────────

describe('Summary bar — agregação de custo e tokens', () => {
  type Decision = ReturnType<typeof makeDecision>;

  function computeSummary(decisions: Decision[]) {
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCostUsd: number | null = null;
    let totalCostBrl: number | null = null;

    for (const d of decisions) {
      totalTokensIn += d.tokens_in ?? 0;
      totalTokensOut += d.tokens_out ?? 0;
      if (d.cost_usd !== null) {
        totalCostUsd = (totalCostUsd ?? 0) + d.cost_usd;
      }
      if (d.cost_brl !== null) {
        totalCostBrl = (totalCostBrl ?? 0) + d.cost_brl;
      }
    }

    const sorted = [...decisions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const durationMs =
      first && last
        ? new Date(last.created_at).getTime() - new Date(first.created_at).getTime()
        : null;

    return { totalTokensIn, totalTokensOut, totalCostUsd, totalCostBrl, durationMs };
  }

  it('soma tokens de múltiplas decisões', () => {
    const decisions = [
      makeDecision({ tokens_in: 100, tokens_out: 50 }),
      makeDecision({ id: '2', tokens_in: 200, tokens_out: 80 }),
    ];
    const { totalTokensIn, totalTokensOut } = computeSummary(decisions);
    expect(totalTokensIn).toBe(300);
    expect(totalTokensOut).toBe(130);
  });

  it('custo null em todas → totalCostUsd null', () => {
    // tokens_in/out também zerados para evitar interferência de defaults
    const decisions = [
      makeDecision({ id: '1', cost_usd: null, cost_brl: null, tokens_in: 0, tokens_out: 0 }),
      makeDecision({ id: '2', cost_usd: null, cost_brl: null, tokens_in: 0, tokens_out: 0 }),
    ];
    const { totalCostUsd, totalCostBrl } = computeSummary(decisions);
    expect(totalCostUsd).toBeNull();
    expect(totalCostBrl).toBeNull();
  });

  it('custo parcial: apenas decisões com valor contribuem', () => {
    const decisions = [
      // tem custo
      makeDecision({ id: '1', cost_usd: 0.001, cost_brl: 0.005, tokens_in: 100, tokens_out: 50 }),
      // sem custo — não deve contribuir
      makeDecision({ id: '2', cost_usd: null, cost_brl: null, tokens_in: 0, tokens_out: 0 }),
      // tem custo
      makeDecision({ id: '3', cost_usd: 0.002, cost_brl: 0.01, tokens_in: 100, tokens_out: 50 }),
    ];
    const { totalCostUsd, totalCostBrl } = computeSummary(decisions);
    // 0.001 + 0.002 = 0.003 | 0.005 + 0.01 = 0.015
    expect(totalCostUsd).toBeCloseTo(0.003);
    expect(totalCostBrl).toBeCloseTo(0.015);
  });

  it('duração calculada corretamente entre primeira e última', () => {
    const decisions = [
      makeDecision({ created_at: '2025-05-19T10:00:00.000Z' }),
      makeDecision({ id: '2', created_at: '2025-05-19T10:00:05.000Z' }),
      makeDecision({ id: '3', created_at: '2025-05-19T10:00:03.000Z' }),
    ];
    const { durationMs } = computeSummary(decisions);
    expect(durationMs).toBe(5000);
  });

  it('decisão única → durationMs = 0', () => {
    const decisions = [makeDecision({ created_at: '2025-05-19T10:00:00.000Z' })];
    const { durationMs } = computeSummary(decisions);
    expect(durationMs).toBe(0);
  });
});

// ─── 6. Ordenação cronológica ─────────────────────────────────────────────────

describe('Ordenação cronológica da timeline (ascendente)', () => {
  it('ordena do mais antigo para o mais recente', () => {
    const decisions = [
      makeDecision({ id: 'c', created_at: '2025-05-19T10:00:03.000Z', node_name: 'c' }),
      makeDecision({ id: 'a', created_at: '2025-05-19T10:00:01.000Z', node_name: 'a' }),
      makeDecision({ id: 'b', created_at: '2025-05-19T10:00:02.000Z', node_name: 'b' }),
    ];
    const sorted = [...decisions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    expect(sorted.map((d) => d.node_name)).toEqual(['a', 'b', 'c']);
  });
});

// ─── 7. Filtragem por erro ────────────────────────────────────────────────────

describe('Detecção de erro nas decisões', () => {
  it('decision com error não-null é considerado erro', () => {
    const d = makeDecision({ error: 'LLM timeout após 30s' });
    const hasError = Boolean(d.error);
    expect(hasError).toBe(true);
  });

  it('decision com error null → sem erro', () => {
    const d = makeDecision({ error: null });
    expect(Boolean(d.error)).toBe(false);
  });

  it('string vazia de error → sem erro (falsy)', () => {
    const d = makeDecision({ error: '' });
    expect(Boolean(d.error)).toBe(false);
  });

  it('contagem de erros em lista', () => {
    const decisions = [
      makeDecision({ error: 'timeout' }),
      makeDecision({ id: '2', error: null }),
      makeDecision({ id: '3', error: 'rate limit' }),
      makeDecision({ id: '4', error: null }),
    ];
    const errorCount = decisions.filter((d) => Boolean(d.error)).length;
    expect(errorCount).toBe(2);
  });
});
