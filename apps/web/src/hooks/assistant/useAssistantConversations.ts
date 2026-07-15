// =============================================================================
// hooks/assistant/useAssistantConversations.ts — TanStack Query para listar
// as conversas salvas do histórico do copiloto interno (F6-S29, barra
// lateral). Consome F6-S25 (CRUD) — GET /api/assistant/conversations.
//
// Contrato real (apps/api/src/modules/assistant-history/schemas.ts
// ConversationListResponseSchema): `{ data: ConversationSummary[] }`, mais
// recentes primeiro, escopo estritamente privado (só as conversas do
// usuário autenticado).
//
// Flag `assistant.history.enabled` desligada (estado atual em produção —
// gate do DPO): a rota SEMPRE responde 200 com lista vazia, nunca erro —
// o caller trata isso como "ainda não há histórico" (estado vazio), não
// como falha.
//
// LGPD (doc 17): título já vem higienizado do backend (derivado por
// intenção — nunca nome de titular) — a lista vive só no cache do TanStack
// Query (memória), nunca em localStorage/sessionStorage.
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api } from '../../lib/api';

import { assistantConversationKeys } from './useAssistantConversation';

/** Espelha ConversationSummarySchema (assistant-history/schemas.ts). */
export interface AssistantConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface AssistantConversationListResponse {
  data: AssistantConversationSummary[];
}

function fetchAssistantConversations(): Promise<AssistantConversationSummary[]> {
  return api
    .get<AssistantConversationListResponse>('/api/assistant/conversations')
    .then((res) => res.data);
}

export interface UseAssistantConversationsResult {
  data: AssistantConversationSummary[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

/**
 * Lista as conversas do usuário no copiloto interno, para a barra lateral
 * de histórico (F6-S29). Sempre habilitada enquanto o hook estiver montado
 * — o caller (AssistantHistorySidebar) só monta dentro do workspace aberto,
 * já gated por `ai_assistant:use` (InternalAssistantButton).
 */
export function useAssistantConversations(): UseAssistantConversationsResult {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: assistantConversationKeys.list(),
    queryFn: fetchAssistantConversations,
  });

  return {
    data: data ?? [],
    isLoading,
    isError,
    refetch,
  };
}
