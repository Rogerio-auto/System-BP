// =============================================================================
// features/assistant/conversationTurns.ts — Converte os turnos de uma
// conversa salva do histórico do copiloto (GET /api/assistant/conversations/
// :id, F6-S27) para o formato de turno da UI do workspace (AssistantTurn,
// F6-S28).
//
// Função pura, sem I/O — nada aqui persiste em localStorage/sessionStorage
// (LGPD doc 17). Os cards por bloco (F6-S22) já tratam `value: null` como
// "dado indisponível" (BlockCardUnavailable via guards.ts) — nenhuma
// conversão adicional de bloco é necessária aqui, só o envelope do turno.
// =============================================================================

import type { AssistantConversationTurn } from '../../hooks/assistant/useAssistantConversation';

import type { AssistantTurn } from './types';

/**
 * Converte um turno hidratado (backend) para o turno de UI. Status é sempre
 * 'success' — um turno persistido sempre tem resposta.
 *
 * `answer` (campo legado da UI, usado por `buildAssistantHistory` para
 * montar a memória de sessão ao continuar a conversa — F6-S19) não existe no
 * contrato persistido. `narrative` é a representação textual mais próxima
 * (já sanitizada, sem PII) e é o que alimenta a continuidade da conversa
 * quando o usuário reabre uma conversa salva e envia uma nova pergunta.
 */
export function toAssistantTurn(turn: AssistantConversationTurn): AssistantTurn {
  return {
    id: turn.id,
    question: turn.question_sanitized,
    status: 'success',
    narrative: turn.narrative,
    blocks: turn.blocks,
    sources: turn.sources,
    answer: turn.narrative,
  };
}

/** Converte todos os turnos de uma conversa, preservando a ordem cronológica. */
export function toAssistantTurns(turns: AssistantConversationTurn[]): AssistantTurn[] {
  return turns.map(toAssistantTurn);
}
