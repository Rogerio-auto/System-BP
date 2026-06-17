// =============================================================================
// features/conversations/queries.ts — TanStack Query hooks para conversas (F16-S15).
//
// Hooks:
//   useConversations(params?)   — GET /api/conversations (cursor-based list)
//   useConversation(id)         — GET /api/conversations/:id (detalhe + window)
//   useMessages(id, params?)    — GET /api/conversations/:id/messages (infinite cursor)
//
// Regras:
//   - Nunca useEffect + fetch — sempre TanStack Query.
//   - Tipos derivados de ./types.ts (que espelha shared-types + schemas S12).
//   - Invalidação por eventos socket em useConversationSocket.ts (não aqui).
//   - Query keys exportadas para uso pelo hook de realtime.
//
// LGPD (doc 17 §8.1):
//   - Não logar responses — podem conter content (PII) ou contactPhone.
//   - staleTime 30s herdado do QueryClient global.
// =============================================================================

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../lib/api';

import type {
  ConversationDetailResponse,
  ConversationListResponse,
  ConversationsQueryParams,
  MessageListResponse,
  MessagesQueryParams,
} from './types';

// ---------------------------------------------------------------------------
// Query keys — canônicas, usadas pelo hook de realtime para invalidar
// ---------------------------------------------------------------------------

export const conversationKeys = {
  /** Raiz de todas as queries de conversas — invalida tudo em `qc.invalidateQueries`. */
  all: ['conversations'] as const,
  /** Lista com filtros — stale ao receber message:new na workspace room. */
  list: (params: ConversationsQueryParams) => ['conversations', 'list', params] as const,
  /** Detalhe de uma conversa + composerState. */
  detail: (id: string) => ['conversations', 'detail', id] as const,
  /** Lista de mensagens infinita (cursor backward). */
  messages: (conversationId: string, params: MessagesQueryParams = {}) =>
    ['conversations', 'messages', conversationId, params] as const,
} as const;

// ---------------------------------------------------------------------------
// Fetchers — chamam lib/api.ts (único ponto de rede)
// ---------------------------------------------------------------------------

async function fetchConversations(
  params: ConversationsQueryParams,
): Promise<ConversationListResponse> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.channelId) qs.set('channelId', params.channelId);
  if (params.assignedUserId) qs.set('assignedUserId', params.assignedUserId);
  if (params.cursor) qs.set('cursor', params.cursor);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));

  const query = qs.toString();
  return api.get<ConversationListResponse>(`/api/conversations${query ? `?${query}` : ''}`);
}

async function fetchConversation(id: string): Promise<ConversationDetailResponse> {
  return api.get<ConversationDetailResponse>(`/api/conversations/${encodeURIComponent(id)}`);
}

async function fetchMessages(
  conversationId: string,
  params: MessagesQueryParams,
): Promise<MessageListResponse> {
  const qs = new URLSearchParams();
  if (params.before) qs.set('before', params.before);
  if (params.limit !== undefined) qs.set('limit', String(params.limit));

  const query = qs.toString();
  return api.get<MessageListResponse>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages${query ? `?${query}` : ''}`,
  );
}

// ---------------------------------------------------------------------------
// Hooks de leitura
// ---------------------------------------------------------------------------

/**
 * useConversations — lista paginada (cursor-based) do inbox.
 *
 * @param params Filtros opcionais. Default: status=open.
 *
 * Invalidado por eventos `message:new` (via useConversationSocket) quando
 * o hook está ativo na lista do inbox.
 */
export function useConversations(params: ConversationsQueryParams = {}) {
  return useQuery({
    queryKey: conversationKeys.list(params),
    queryFn: () => fetchConversations(params),
    // staleTime herdado do QueryClient global (30s)
  });
}

/**
 * useConversation — detalhe de uma conversa + estado da janela de composição.
 *
 * @param id UUID da conversa.
 *
 * Invalidado por eventos `conversation:updated` (via useConversationSocket).
 */
export function useConversation(id: string) {
  return useQuery({
    queryKey: conversationKeys.detail(id),
    queryFn: () => fetchConversation(id),
    enabled: id.length > 0,
  });
}

/**
 * useMessages — histórico de mensagens com paginação regressiva por cursor.
 *
 * Usa useInfiniteQuery para carregar mensagens mais antigas via "cursor backward":
 *   - Primeiro fetch: mensagens mais recentes (sem `before`).
 *   - Páginas seguintes: `before` = nextCursor da resposta anterior.
 *
 * @param conversationId UUID da conversa.
 * @param params Parâmetros opcionais (limit).
 *
 * Atualizado via setQueryData em `message:new` (useConversationSocket)
 * para que novas mensagens apareçam sem refetch completo.
 */
export function useMessages(conversationId: string, params: MessagesQueryParams = {}) {
  return useInfiniteQuery({
    queryKey: conversationKeys.messages(conversationId, params),
    queryFn: ({ pageParam }) => {
      // pageParam = cursor da mensagem mais antiga da página atual.
      // Evitamos atribuir `undefined` explicitamente em params (exactOptionalPropertyTypes).
      const fetchParams: MessagesQueryParams =
        typeof pageParam === 'string' ? { ...params, before: pageParam } : { ...params };
      return fetchMessages(conversationId, fetchParams);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: conversationId.length > 0,
  });
}

// ---------------------------------------------------------------------------
// Tipos auxiliares para mutations
// ---------------------------------------------------------------------------

/** Resumo de usuário para o seletor de agente (subconjunto de UserResponse da API). */
export interface AgentUser {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly status: 'active' | 'disabled' | 'pending';
}

interface AgentUsersApiResponse {
  readonly data: AgentUser[];
  readonly pagination: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly totalPages: number;
  };
}

// ---------------------------------------------------------------------------
// Fetchers de mutations
// ---------------------------------------------------------------------------

async function fetchAgentUsers(): Promise<AgentUsersApiResponse> {
  return api.get<AgentUsersApiResponse>('/api/admin/users?limit=100');
}

// ---------------------------------------------------------------------------
// Hooks de agentes (para seletor de atribuição)
// ---------------------------------------------------------------------------

/**
 * useAgentUsers — lista usuários ativos da org para o seletor de atribuição.
 *
 * Requer `users:manage` — retorna vazio silenciosamente para agentes sem permissão.
 * staleTime 5 min: a lista de agentes muda raramente.
 */
export function useAgentUsers() {
  return useQuery({
    queryKey: ['agent-users'],
    queryFn: fetchAgentUsers,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

// ---------------------------------------------------------------------------
// Mutations de conversa
// ---------------------------------------------------------------------------

/**
 * useAssignConversation — atribui (ou desatribui) um agente a uma conversa.
 *
 * PATCH /api/conversations/:id/assign
 * Body: { agentId: string | null }
 * Requer `livechat:conversation:manage`.
 *
 * Invalida o detalhe da conversa e a lista ao suceder.
 */
export function useAssignConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string | null) =>
      api.patch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/assign`, {
        agentId,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      void qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}

/**
 * useResolveConversation — marca a conversa como resolvida.
 *
 * PATCH /api/conversations/:id/resolve
 * Requer `livechat:conversation:manage`.
 *
 * Invalida o detalhe e a lista (conversa sai do inbox 'open').
 */
export function useResolveConversation(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.patch<unknown>(`/api/conversations/${encodeURIComponent(conversationId)}/resolve`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      void qc.invalidateQueries({ queryKey: conversationKeys.all });
    },
  });
}
