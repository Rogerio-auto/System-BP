// =============================================================================
// conversationTurns.test.ts — Testes unitários da conversão de turnos de uma
// conversa salva do histórico do copiloto (F6-S28) para o formato de turno
// da UI do workspace.
// =============================================================================

import { describe, expect, it } from 'vitest';

import type { AssistantConversationTurn } from '../../../hooks/assistant/useAssistantConversation';
import { ASSISTANT_HISTORY_MAX_TURNS } from '../../../hooks/assistant/useAssistantQuery';
import { toAssistantTurn, toAssistantTurns } from '../conversationTurns';
import { buildAssistantHistory } from '../history';

function storedTurn(overrides: Partial<AssistantConversationTurn> = {}): AssistantConversationTurn {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    question_sanitized: 'Quantos leads temos em Ariquemes?',
    narrative: 'Há 42 leads ativos em Ariquemes.',
    blocks: [
      {
        type: 'funnel_metrics',
        ref: { kind: 'none', lead_id: null },
        value: null,
      },
    ],
    sources: ['funnel_metrics'],
    created_at: '2026-07-14T12:00:05.000Z',
    ...overrides,
  };
}

describe('toAssistantTurn', () => {
  it('converte um turno persistido para o formato de UI já como success', () => {
    const turn = toAssistantTurn(storedTurn());

    expect(turn).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      question: 'Quantos leads temos em Ariquemes?',
      status: 'success',
      narrative: 'Há 42 leads ativos em Ariquemes.',
      blocks: [{ type: 'funnel_metrics', ref: { kind: 'none', lead_id: null }, value: null }],
      sources: ['funnel_metrics'],
      answer: 'Há 42 leads ativos em Ariquemes.',
    });
  });

  it('preserva blocos com value: null (dado indisponível) sem alterar a forma', () => {
    const turn = toAssistantTurn(
      storedTurn({
        blocks: [{ type: 'lead_summary', ref: { kind: 'lead', lead_id: 'abc' }, value: null }],
      }),
    );

    expect(turn.blocks).toEqual([
      { type: 'lead_summary', ref: { kind: 'lead', lead_id: 'abc' }, value: null },
    ]);
  });

  it('usa a narrativa como `answer` legado — sem isso a memória de sessão descartaria o turno', () => {
    const turn = toAssistantTurn(storedTurn({ narrative: 'Resposta reaberta.' }));
    expect(turn.answer).toBe('Resposta reaberta.');
  });
});

describe('toAssistantTurns', () => {
  it('converte a lista preservando a ordem', () => {
    const turns = toAssistantTurns([
      storedTurn({ id: 'a', question_sanitized: 'pergunta 1' }),
      storedTurn({ id: 'b', question_sanitized: 'pergunta 2' }),
    ]);

    expect(turns.map((t) => t.id)).toEqual(['a', 'b']);
    expect(turns.map((t) => t.question)).toEqual(['pergunta 1', 'pergunta 2']);
  });

  it('retorna vazio para conversa sem turnos', () => {
    expect(toAssistantTurns([])).toEqual([]);
  });
});

describe('integração com buildAssistantHistory (continuar uma conversa reaberta)', () => {
  it('turnos reabertos alimentam a memória de sessão ao enviar uma nova pergunta', () => {
    const turns = toAssistantTurns([
      storedTurn({ id: 'a', question_sanitized: 'pergunta 1', narrative: 'resposta 1' }),
      storedTurn({ id: 'b', question_sanitized: 'pergunta 2', narrative: 'resposta 2' }),
    ]);

    const history = buildAssistantHistory(turns, 'novo-turno-em-andamento');

    expect(history).toEqual([
      { role: 'user', content: 'pergunta 1' },
      { role: 'assistant', content: 'resposta 1' },
      { role: 'user', content: 'pergunta 2' },
      { role: 'assistant', content: 'resposta 2' },
    ]);
  });

  it('respeita o cap de ASSISTANT_HISTORY_MAX_TURNS mesmo com muitos turnos reabertos', () => {
    const stored = Array.from({ length: 8 }, (_, i) =>
      storedTurn({ id: `t${i}`, question_sanitized: `pergunta ${i}`, narrative: `resposta ${i}` }),
    );
    const history = buildAssistantHistory(toAssistantTurns(stored), 'atual');

    expect(history.length).toBe(ASSISTANT_HISTORY_MAX_TURNS);
  });
});
