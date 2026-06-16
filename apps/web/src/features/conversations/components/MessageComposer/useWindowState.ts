// =============================================================================
// MessageComposer/useWindowState.ts — Verifica se a janela 24h está aberta.
//
// Usa o ComposerWindowState retornado por useConversation(id).
// A janela está "aberta" quando:
//   - composerState.window === 'open' OU 'human_agent_tag'
//
// staleTime: 60s para não sobrecarregar a API com polls frequentes.
// =============================================================================

import { useConversation } from '../../queries';
import type { ComposerWindowKind } from '../../types';

export interface WindowStateResult {
  /** true se o atendente pode enviar texto livre */
  windowOpen: boolean;
  /** Estado exato da janela (para exibir mensagem contextual) */
  windowKind: ComposerWindowKind | null;
  /** Milissegundos restantes (null = sem janela ou provider WAHA) */
  remainingMs: number | null;
  /** Query ainda carregando */
  isLoading: boolean;
}

/**
 * useWindowState — verifica se a janela de 24h da conversa está aberta.
 *
 * Depende de useConversation que retorna composerState.
 * staleTime herdado do QueryClient global (30s),
 * re-fetch no refocus (evita exibir janela expirada para atendente ativo).
 *
 * A decisão de abrir/fechar é feita no BACKEND. O frontend apenas exibe.
 */
export function useWindowState(conversationId: string): WindowStateResult {
  const { data, isLoading } = useConversation(conversationId);

  if (!data) {
    return {
      windowOpen: false,
      windowKind: null,
      remainingMs: null,
      isLoading,
    };
  }

  const { composerState } = data;
  const windowOpen = composerState.window === 'open' || composerState.window === 'human_agent_tag';

  return {
    windowOpen,
    windowKind: composerState.window,
    remainingMs: composerState.remainingMs,
    isLoading,
  };
}
