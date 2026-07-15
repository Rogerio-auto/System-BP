// =============================================================================
// hooks/assistant/useAssistantConversation.ts — TanStack Query para abrir uma
// conversa salva do histórico do copiloto interno (F6-S28).
//
// GET /api/assistant/conversations/:id — contrato real (apps/api/src/modules/
// assistant-history/schemas.ts ConversationDetailResponseSchema): a conversa
// (id, title, timestamps) + turns[], cada turno já com os blocos HIDRATADOS
// AO VIVO pelo backend (F6-S27) com a permissão/escopo de cidade ATUAIS do
// usuário. O frontend NUNCA re-hidrata nada — só renderiza `value` (ou
// `value: null` → "dado indisponível", já tratado pelos cards do F6-S22 via
// guards.ts/BlockCardUnavailable).
//
// Owner-scoped no backend: conversa de outro usuário, inexistente ou
// soft-deletada retorna 404 (nunca 403, para não vazar a existência do
// recurso) — exposto aqui como `isNotFound` para o caller renderizar
// "conversa indisponível", nunca um erro genérico.
//
// LGPD (doc 17): a resposta não é persistida em localStorage/sessionStorage —
// vive só no cache do TanStack Query (memória), igual ao restante do
// copiloto (useAssistantQuery.ts). Retry de 4xx já é suprimido pela
// configuração global do QueryClient (App.tsx).
// =============================================================================

import { useQuery } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api';

import type { AssistantBlock } from './useAssistantQuery';

// ---------------------------------------------------------------------------
// Tipos — espelham apps/api/src/modules/assistant-history/schemas.ts
// ---------------------------------------------------------------------------

/**
 * Turno persistido de uma conversa, com blocos hidratados ao vivo pelo
 * backend. Espelha AssistantTurnSchema (assistant-history/schemas.ts).
 */
export interface AssistantConversationTurn {
  id: string;
  question_sanitized: string;
  narrative: string;
  blocks: AssistantBlock[];
  sources: string[];
  created_at: string;
}

/** Espelha ConversationDetailResponseSchema (assistant-history/schemas.ts). */
export interface AssistantConversationDetail {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  turns: AssistantConversationTurn[];
}

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

export const assistantConversationKeys = {
  all: ['assistant', 'conversations'] as const,
  /** Lista das conversas do usuário (barra lateral, F6-S29). */
  list: () => [...assistantConversationKeys.all, 'list'] as const,
  detail: (id: string) => [...assistantConversationKeys.all, id] as const,
};

// ---------------------------------------------------------------------------
// Classificação de erro — função pura, testável sem montar o hook
// ---------------------------------------------------------------------------

/**
 * Uma conversa 404 é sempre "indisponível" para o usuário atual (inexistente,
 * de outro usuário, ou soft-deletada — o backend nunca distingue os três
 * casos, de propósito, para não vazar a existência do recurso).
 */
export function isConversationNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

function fetchAssistantConversation(id: string): Promise<AssistantConversationDetail> {
  return api.get<AssistantConversationDetail>(
    `/api/assistant/conversations/${encodeURIComponent(id)}`,
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseAssistantConversationResult {
  data: AssistantConversationDetail | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Conversa não encontrada (404) — owner-scoped, nunca 403. */
  isNotFound: boolean;
  refetch: () => void;
}

/**
 * Abre uma conversa salva do histórico do copiloto interno.
 * `conversationId === null` desliga a query (nenhuma conversa selecionada —
 * workspace em modo "nova conversa").
 */
export function useAssistantConversation(
  conversationId: string | null,
): UseAssistantConversationResult {
  const { data, isLoading, isError, error, refetch } = useQuery<
    AssistantConversationDetail,
    unknown
  >({
    queryKey: assistantConversationKeys.detail(conversationId ?? ''),
    queryFn: () => fetchAssistantConversation(conversationId as string),
    enabled: conversationId !== null && conversationId.length > 0,
  });

  return {
    data,
    isLoading,
    isError,
    isNotFound: isError && isConversationNotFoundError(error),
    refetch,
  };
}
