// =============================================================================
// features/assistant/types.ts — Tipos do chat do copiloto interno (F6-S09).
//
// Histórico vive apenas em memória (React state) enquanto o drawer está
// aberto — nunca em localStorage/sessionStorage (LGPD doc 17).
// =============================================================================

import type { AssistantErrorKind } from '../../hooks/assistant/useAssistantQuery';

/** Um turno de conversa: a pergunta do usuário + o ciclo de vida da resposta. */
export interface AssistantTurn {
  id: string;
  question: string;
  status: 'pending' | 'success' | 'error';
  answer?: string;
  sources?: string[];
  errorKind?: AssistantErrorKind;
  errorMessage?: string;
}
