// =============================================================================
// features/assistant/history.ts — Monta o `history` enviado ao copiloto
// interno a partir dos turnos do chat (F6-S19, memória de sessão).
//
// Regras (doc 22 + apps/api/src/modules/internal-assistant/schemas.ts):
//   - Só turnos com status 'success' entram (erro/loading são excluídos).
//   - O turno atual (excludeTurnId) nunca entra — ele ainda não tem resposta
//     no momento em que o history é montado para a request em andamento.
//   - Ordem cronológica, alternando 'user' (pergunta) e 'assistant' (resposta)
//     por turno.
//   - Cap rígido de ASSISTANT_HISTORY_MAX_TURNS itens (backend rejeita com 400
//     acima disso) — sempre os últimos, nunca os primeiros.
//
// Função pura, sem I/O — nada aqui persiste em localStorage/sessionStorage
// (LGPD doc 17): o histórico vive só no useState do AssistantWorkspaceModal e
// desaparece ao fechar/desmontar o modal.
// =============================================================================

import {
  ASSISTANT_HISTORY_MAX_TURNS,
  type AssistantHistoryTurn,
} from '../../hooks/assistant/useAssistantQuery';

import type { AssistantTurn } from './types';

/**
 * Constrói o `history` a enviar ao backend a partir dos turnos anteriores do
 * chat, excluindo o turno atual (`excludeTurnId`) e qualquer turno que não
 * tenha terminado com sucesso.
 */
export function buildAssistantHistory(
  turns: AssistantTurn[],
  excludeTurnId: string,
): AssistantHistoryTurn[] {
  const items: AssistantHistoryTurn[] = [];

  for (const turn of turns) {
    if (turn.id === excludeTurnId) continue;
    if (turn.status !== 'success' || !turn.answer) continue;

    items.push({ role: 'user', content: turn.question });
    items.push({ role: 'assistant', content: turn.answer });
  }

  return items.slice(-ASSISTANT_HISTORY_MAX_TURNS);
}
