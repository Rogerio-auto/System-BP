// =============================================================================
// history.test.ts — Testes unitários do builder de histórico do copiloto
// interno (F6-S19, memória de sessão).
// =============================================================================

import { describe, expect, it } from 'vitest';

import { ASSISTANT_HISTORY_MAX_TURNS } from '../../../hooks/assistant/useAssistantQuery';
import { buildAssistantHistory } from '../history';
import type { AssistantTurn } from '../types';

function successTurn(id: string, question: string, answer: string): AssistantTurn {
  return { id, question, status: 'success', answer, sources: [] };
}

function pendingTurn(id: string, question: string): AssistantTurn {
  return { id, question, status: 'pending' };
}

function errorTurn(id: string, question: string): AssistantTurn {
  return {
    id,
    question,
    status: 'error',
    errorKind: 'server',
    errorMessage: 'falhou',
  };
}

describe('buildAssistantHistory', () => {
  it('retorna vazio quando não há turnos anteriores', () => {
    expect(buildAssistantHistory([], 'current')).toEqual([]);
  });

  it('exclui o turno atual (excludeTurnId)', () => {
    const turns = [
      successTurn('a', 'quantos leads?', '10 leads'),
      pendingTurn('current', 'e cobranças?'),
    ];
    const history = buildAssistantHistory(turns, 'current');
    expect(history).toEqual([
      { role: 'user', content: 'quantos leads?' },
      { role: 'assistant', content: '10 leads' },
    ]);
  });

  it('alterna user/assistant em ordem cronológica para múltiplos turnos', () => {
    const turns = [
      successTurn('a', 'pergunta 1', 'resposta 1'),
      successTurn('b', 'pergunta 2', 'resposta 2'),
    ];
    const history = buildAssistantHistory(turns, 'current');
    expect(history).toEqual([
      { role: 'user', content: 'pergunta 1' },
      { role: 'assistant', content: 'resposta 1' },
      { role: 'user', content: 'pergunta 2' },
      { role: 'assistant', content: 'resposta 2' },
    ]);
  });

  it('exclui turnos de erro', () => {
    const turns = [successTurn('a', 'pergunta 1', 'resposta 1'), errorTurn('b', 'pergunta 2')];
    const history = buildAssistantHistory(turns, 'current');
    expect(history).toEqual([
      { role: 'user', content: 'pergunta 1' },
      { role: 'assistant', content: 'resposta 1' },
    ]);
  });

  it('exclui turnos pendentes/em loading', () => {
    const turns = [successTurn('a', 'pergunta 1', 'resposta 1'), pendingTurn('b', 'pergunta 2')];
    const history = buildAssistantHistory(turns, 'current');
    expect(history).toEqual([
      { role: 'user', content: 'pergunta 1' },
      { role: 'assistant', content: 'resposta 1' },
    ]);
  });

  it('nunca excede ASSISTANT_HISTORY_MAX_TURNS itens — mantém só os últimos', () => {
    const turns: AssistantTurn[] = Array.from({ length: 8 }, (_, i) =>
      successTurn(`t${i}`, `pergunta ${i}`, `resposta ${i}`),
    );
    const history = buildAssistantHistory(turns, 'current');

    expect(history.length).toBe(ASSISTANT_HISTORY_MAX_TURNS);
    // 8 turnos bem-sucedidos = 16 itens (user+assistant cada) — mantém os
    // últimos 10, ou seja, a partir do turno 3 (pergunta 3 em diante).
    expect(history[0]).toEqual({ role: 'user', content: 'pergunta 3' });
    expect(history[history.length - 1]).toEqual({ role: 'assistant', content: 'resposta 7' });
  });

  it('respeita o cap mesmo com excludeTurnId inexistente (defesa em profundidade)', () => {
    const turns: AssistantTurn[] = Array.from({ length: 6 }, (_, i) =>
      successTurn(`t${i}`, `pergunta ${i}`, `resposta ${i}`),
    );
    // 6 turnos bem-sucedidos = 12 itens, cortados para o cap de 10 mesmo sem
    // um excludeTurnId válido presente na lista.
    const history = buildAssistantHistory(turns, 'nao-existe');
    expect(history.length).toBe(ASSISTANT_HISTORY_MAX_TURNS);
  });
});
