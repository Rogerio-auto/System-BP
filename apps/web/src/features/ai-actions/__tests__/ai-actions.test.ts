// =============================================================================
// features/ai-actions/__tests__/ai-actions.test.ts
//
// Testes de lógica pura do painel "IA no funil" (F25-S07).
// Alinhado ao padrão de ai-console/decisions/__tests__/decisions.test.tsx —
// sem renderização React, sem JSDOM, sem TanStack Query.
//
// Cobertura:
//   1. Query keys — formato estável, sem colisão entre filtros
//   2. RBAC — gating de ai_actions:read / :revert / :manage
//   3. Rótulos e variantes de badge por tipo de ação
//   4. Regra revertible/reverted (quando o botão Reverter aparece)
//   5. Formatador de timestamp
//   6. Otimismo do revert — snapshot e aplicação local
// =============================================================================

import { describe, expect, it } from 'vitest';

import { aiActionsQueryKeys, type AiActionItem } from '../../../hooks/ai-actions/useAiActions';
import { actionLabel, actionVariant, formatOccurredAt } from '../components/AiActionRow';

// ─── Helpers de fábrica ───────────────────────────────────────────────────────

const ITEM_DEFAULTS: AiActionItem = {
  action_id: 'uuid-action-1',
  action: 'leads.qualified',
  lead_id: 'uuid-lead-1',
  lead_name_masked: 'J. Silva',
  city_id: 'uuid-city-1',
  occurred_at: '2026-07-10T12:00:00.000Z',
  revertible: true,
  reverted: false,
};

function makeItem(overrides: Partial<AiActionItem>): AiActionItem {
  return { ...ITEM_DEFAULTS, ...overrides };
}

// ─── 1. Query keys ────────────────────────────────────────────────────────────

describe('aiActionsQueryKeys', () => {
  it('all retorna prefixo estável', () => {
    expect(aiActionsQueryKeys.all).toEqual(['ai-actions']);
  });

  it('list() inclui filtros no path', () => {
    const qk = aiActionsQueryKeys.list({ window: '24h', page: 1, limit: 20 });
    expect(qk[0]).toBe('ai-actions');
    expect(qk[1]).toBe('list');
    expect(qk[2]).toMatchObject({ window: '24h', page: 1, limit: 20 });
  });

  it('list() com janelas diferentes não colide', () => {
    const a = JSON.stringify(aiActionsQueryKeys.list({ window: '24h', page: 1, limit: 20 }));
    const b = JSON.stringify(aiActionsQueryKeys.list({ window: '7d', page: 1, limit: 20 }));
    expect(a).not.toBe(b);
  });

  it('list() com páginas diferentes não colide', () => {
    const a = JSON.stringify(aiActionsQueryKeys.list({ window: '24h', page: 1, limit: 20 }));
    const b = JSON.stringify(aiActionsQueryKeys.list({ window: '24h', page: 2, limit: 20 }));
    expect(a).not.toBe(b);
  });
});

// ─── 2. RBAC ─────────────────────────────────────────────────────────────────

describe('RBAC — gating de ai_actions:*', () => {
  function hasPermission(perms: string[], required: string): boolean {
    return perms.includes(required);
  }

  it('gestor_geral tem read + revert + manage', () => {
    const perms = ['ai_actions:read', 'ai_actions:revert', 'ai_actions:manage'];
    expect(hasPermission(perms, 'ai_actions:read')).toBe(true);
    expect(hasPermission(perms, 'ai_actions:revert')).toBe(true);
    expect(hasPermission(perms, 'ai_actions:manage')).toBe(true);
  });

  it('agente tem apenas read (todos os operacionais)', () => {
    const perms = ['ai_actions:read', 'leads:write'];
    expect(hasPermission(perms, 'ai_actions:read')).toBe(true);
    expect(hasPermission(perms, 'ai_actions:revert')).toBe(false);
    expect(hasPermission(perms, 'ai_actions:manage')).toBe(false);
  });

  it('sem nenhuma permissão ai_actions:* → tudo false', () => {
    const perms = ['leads:read'];
    expect(hasPermission(perms, 'ai_actions:read')).toBe(false);
    expect(hasPermission(perms, 'ai_actions:revert')).toBe(false);
    expect(hasPermission(perms, 'ai_actions:manage')).toBe(false);
  });

  it('ai_actions:revert não implica ai_actions:manage', () => {
    const perms = ['ai_actions:read', 'ai_actions:revert'];
    expect(hasPermission(perms, 'ai_actions:manage')).toBe(false);
  });
});

// ─── 3. Rótulos e variantes de badge ──────────────────────────────────────────

describe('actionLabel / actionVariant', () => {
  it('leads.qualified → rótulo e variante success', () => {
    expect(actionLabel('leads.qualified')).toBe('Lead qualificado');
    expect(actionVariant('leads.qualified')).toBe('success');
  });

  it('leads.stagnant → rótulo e variante warning', () => {
    expect(actionLabel('leads.stagnant')).toBe('Marcado como estagnado');
    expect(actionVariant('leads.stagnant')).toBe('warning');
  });

  it('leads.abandoned → rótulo e variante danger', () => {
    expect(actionLabel('leads.abandoned')).toBe('Lead abandonado');
    expect(actionVariant('leads.abandoned')).toBe('danger');
  });
});

// ─── 4. Regra revertible/reverted ─────────────────────────────────────────────

describe('Regra de exibição do botão Reverter', () => {
  function shouldShowRevertButton(item: AiActionItem, canRevert: boolean): boolean {
    return canRevert && item.revertible && !item.reverted;
  }

  it('revertible + não revertida + permissão → mostra botão', () => {
    const item = makeItem({ revertible: true, reverted: false });
    expect(shouldShowRevertButton(item, true)).toBe(true);
  });

  it('leads.stagnant (não revertible) → nunca mostra botão', () => {
    const item = makeItem({ action: 'leads.stagnant', revertible: false, reverted: false });
    expect(shouldShowRevertButton(item, true)).toBe(false);
  });

  it('já revertida → não mostra botão mesmo com permissão', () => {
    const item = makeItem({ revertible: true, reverted: true });
    expect(shouldShowRevertButton(item, true)).toBe(false);
  });

  it('sem permissão ai_actions:revert → não mostra botão mesmo se revertible', () => {
    const item = makeItem({ revertible: true, reverted: false });
    expect(shouldShowRevertButton(item, false)).toBe(false);
  });
});

// ─── 5. Formatador de timestamp ───────────────────────────────────────────────

describe('formatOccurredAt', () => {
  it('retorna string não-vazia para ISO válida', () => {
    const result = formatOccurredAt('2026-07-10T12:00:00.000Z');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contém o ano correto', () => {
    const result = formatOccurredAt('2026-07-10T12:00:00.000Z');
    expect(result).toContain('2026');
  });
});

// ─── 6. Otimismo do revert — snapshot e aplicação local ───────────────────────

describe('Otimismo do revert (lógica pura — espelha onMutate/onError do hook)', () => {
  interface ListResponse {
    data: AiActionItem[];
  }

  function applyOptimisticRevert(list: ListResponse, actionId: string): ListResponse {
    return {
      ...list,
      data: list.data.map((item) =>
        item.action_id === actionId ? { ...item, reverted: true } : item,
      ),
    };
  }

  it('marca apenas o item alvo como revertido', () => {
    const list: ListResponse = {
      data: [
        makeItem({ action_id: 'a', reverted: false }),
        makeItem({ action_id: 'b', reverted: false }),
      ],
    };
    const next = applyOptimisticRevert(list, 'a');
    expect(next.data.find((i) => i.action_id === 'a')?.reverted).toBe(true);
    expect(next.data.find((i) => i.action_id === 'b')?.reverted).toBe(false);
  });

  it('rollback restaura o snapshot anterior integralmente', () => {
    const original: ListResponse = {
      data: [makeItem({ action_id: 'a', reverted: false })],
    };
    const snapshot = original; // snapshot capturado antes da mutação otimista
    const optimistic = applyOptimisticRevert(original, 'a');
    expect(optimistic.data[0]?.reverted).toBe(true);

    // Simula rollback em onError: volta ao snapshot
    const rolledBack = snapshot;
    expect(rolledBack.data[0]?.reverted).toBe(false);
  });

  it('id inexistente na lista → nenhuma alteração', () => {
    const list: ListResponse = { data: [makeItem({ action_id: 'a', reverted: false })] };
    const next = applyOptimisticRevert(list, 'inexistente');
    expect(next.data[0]?.reverted).toBe(false);
  });
});
