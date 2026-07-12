// =============================================================================
// chips.test.ts — Testes unitários dos chips de sugestão do copiloto (F6-S12).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { ASSISTANT_SUGGESTION_CHIPS, getAvailableAssistantChips } from '../chips';

describe('ASSISTANT_SUGGESTION_CHIPS', () => {
  it('cobre as 5 permissões do doc 22 com pergunta pronta e emoji', () => {
    expect(ASSISTANT_SUGGESTION_CHIPS).toHaveLength(5);
    const permissions = ASSISTANT_SUGGESTION_CHIPS.map((c) => c.permission);
    expect(permissions).toEqual([
      'dashboard:read',
      'leads:read',
      'analyses:read',
      'billing:read',
      'livechat:conversation:read',
    ]);
    for (const chip of ASSISTANT_SUGGESTION_CHIPS) {
      expect(chip.emoji.length).toBeGreaterThan(0);
      expect(chip.question.length).toBeGreaterThan(0);
    }
  });

  it('perguntas espelham exatamente o texto do slot F6-S12', () => {
    const byId = Object.fromEntries(ASSISTANT_SUGGESTION_CHIPS.map((c) => [c.id, c.question]));
    expect(byId.dashboard).toBe('Métricas do funil dos últimos 30 dias');
    expect(byId.leads).toBe('Quantos leads novos entraram esta semana?');
    expect(byId.analyses).toBe('Qual o status de análise de crédito de um lead?');
    expect(byId.billing).toBe('Quais as próximas cobranças?');
    expect(byId.livechat).toBe('Resuma a conversa de um lead');
  });
});

describe('getAvailableAssistantChips', () => {
  it('sem nenhuma permissão → lista vazia (mensagem honesta, sem chips)', () => {
    const result = getAvailableAssistantChips(() => false);
    expect(result).toEqual([]);
  });

  it('com todas as permissões → todos os chips, na ordem do catálogo', () => {
    const result = getAvailableAssistantChips(() => true);
    expect(result).toHaveLength(5);
    expect(result.map((c) => c.id)).toEqual(ASSISTANT_SUGGESTION_CHIPS.map((c) => c.id));
  });

  it('só retorna o chip cuja permissão específica o usuário tem', () => {
    const result = getAvailableAssistantChips((perm) => perm === 'billing:read');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('billing');
  });

  it('respeita múltiplas permissões parciais, preservando a ordem do catálogo', () => {
    const granted = new Set(['livechat:conversation:read', 'dashboard:read']);
    const result = getAvailableAssistantChips((perm) => granted.has(perm));
    expect(result.map((c) => c.id)).toEqual(['dashboard', 'livechat']);
  });
});
