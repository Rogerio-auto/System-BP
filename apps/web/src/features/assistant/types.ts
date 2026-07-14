// =============================================================================
// features/assistant/types.ts — Tipos do chat do copiloto interno (F6-S09/F6-S12).
//
// Histórico vive apenas em memória (React state) enquanto o workspace está
// aberto — nunca em localStorage/sessionStorage (LGPD doc 17).
//
// Contrato estruturado (F6-S21/F6-S22): a resposta de sucesso carrega
// `narrative` (texto, sem PII) + `blocks` (dados de cliente tipados por
// entidade) — é o que a UI renderiza. `answer` é mantido no turno só como
// (a) fallback de UI quando narrative e blocks vêm vazios e (b) fonte do
// `history` de sessão enviado ao backend (buildAssistantHistory) — nunca
// exibido diretamente quando narrative/blocks estão presentes.
// =============================================================================

import type { AssistantBlock, AssistantErrorKind } from '../../hooks/assistant/useAssistantQuery';

/** Um turno de conversa: a pergunta do usuário + o ciclo de vida da resposta. */
export interface AssistantTurn {
  id: string;
  question: string;
  status: 'pending' | 'success' | 'error';
  narrative?: string;
  blocks?: AssistantBlock[];
  sources?: string[];
  /** [Legado] texto plano — ver nota de contrato estruturado acima. */
  answer?: string;
  errorKind?: AssistantErrorKind;
  errorMessage?: string;
}
