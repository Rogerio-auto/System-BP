// =============================================================================
// features/assistant/hooks/useAssistantWorkspaceTurns.ts — Gerencia o estado
// dos turnos de conversa do workspace do copiloto interno (F6-S12/F6-S19),
// incluindo os turnos reabertos de uma conversa salva do histórico (F6-S28).
//
// Extraído de AssistantWorkspaceModal.tsx para manter o componente de UI
// abaixo de 200 linhas — este hook concentra toda a lógica de envio/retry/
// memória de sessão, sem nenhum JSX.
//
// Histórico de turnos vive só em React state (useState) — nunca em
// localStorage/sessionStorage (LGPD doc 17). Desmonta com o componente que
// usa o hook.
// =============================================================================

import * as React from 'react';

import type { AssistantConversationDetail } from '../../../hooks/assistant/useAssistantConversation';
import {
  classifyAssistantError,
  useAssistantQuery,
  type AssistantErrorKind,
} from '../../../hooks/assistant/useAssistantQuery';
import { toAssistantTurns } from '../conversationTurns';
import { buildAssistantHistory } from '../history';
import type { AssistantTurn } from '../types';

export interface UseAssistantWorkspaceTurnsResult {
  turns: AssistantTurn[];
  /** true enquanto aguarda resposta do copiloto para a pergunta em andamento. */
  isPending: boolean;
  /** Envia uma nova pergunta (chat novo ou continuação de uma conversa reaberta). */
  sendQuestion: (question: string) => void;
  /** Reenvia um turno que terminou em erro. */
  retry: (turn: AssistantTurn) => void;
}

/**
 * @param conversation Conversa salva já carregada pelo caller (F6-S28,
 * useAssistantConversation). Os turnos são semeados uma única vez quando ela
 * chega — refetches subsequentes do TanStack Query nunca sobrescrevem
 * turnos novos enviados pelo usuário depois.
 */
export function useAssistantWorkspaceTurns(
  conversation: AssistantConversationDetail | undefined,
): UseAssistantWorkspaceTurnsResult {
  const [turns, setTurns] = React.useState<AssistantTurn[]>([]);
  const { ask, isPending } = useAssistantQuery();
  const isMountedRef = React.useRef(true);
  const seededRef = React.useRef(false);

  React.useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  React.useEffect(() => {
    if (conversation && !seededRef.current) {
      seededRef.current = true;
      setTurns(toAssistantTurns(conversation.turns));
    }
  }, [conversation]);

  function runTurn(id: string, question: string): void {
    // `turns` aqui é o estado ANTES deste turno ser adicionado (sendQuestion)
    // ou o estado com este turno ainda em 'error'/'pending' (retry) — em
    // ambos os casos buildAssistantHistory exclui o turno atual e qualquer
    // turno que não tenha terminado com sucesso.
    const history = buildAssistantHistory(turns, id);
    ask(question, history)
      .then((res) => {
        if (!isMountedRef.current) return;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'success',
                  narrative: res.narrative,
                  blocks: res.blocks,
                  sources: res.sources,
                  answer: res.answer,
                }
              : t,
          ),
        );
      })
      .catch((err: unknown) => {
        if (!isMountedRef.current) return;
        const classified = classifyAssistantError(err);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'error',
                  errorKind: classified.kind as AssistantErrorKind,
                  errorMessage: classified.message,
                }
              : t,
          ),
        );
      });
  }

  function sendQuestion(question: string): void {
    const trimmed = question.trim();
    if (!trimmed || isPending) return;

    const id = crypto.randomUUID();
    setTurns((prev) => [...prev, { id, question: trimmed, status: 'pending' }]);
    runTurn(id, trimmed);
  }

  function retry(turn: AssistantTurn): void {
    if (isPending) return;
    setTurns((prev) => prev.map((t) => (t.id === turn.id ? { ...t, status: 'pending' } : t)));
    runTurn(turn.id, turn.question);
  }

  return { turns, isPending, sendQuestion, retry };
}
