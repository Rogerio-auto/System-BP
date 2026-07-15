// =============================================================================
// hooks/assistant/useDeleteAssistantConversation.ts — Mutation de remover
// (soft-delete) uma conversa salva do histórico do copiloto interno
// (F6-S29, barra lateral). Consome F6-S25 —
// DELETE /api/assistant/conversations/:id.
//
// Contrato real (apps/api/src/modules/assistant-history/schemas.ts):
//   response: { deleted: boolean }
//
// Owner-scoped no backend: conversa de outro usuário, inexistente, ou já
// removida retorna 404 (nunca 403 — não vazar existência do recurso). O
// caller trata 404 como "já não existe" — mesmo resultado prático do que
// pedir, então segue como sucesso silencioso (refetch da lista já resolve
// o estado real).
//
// Invalida a lista após a remoção. Não invalida o detalhe — se a conversa
// removida estiver aberta no workspace, o caller (AssistantWorkspaceModal)
// é responsável por voltar para "nova conversa".
// =============================================================================

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api';

import { assistantConversationKeys } from './useAssistantConversation';

export type DeleteConversationErrorKind =
  | 'not_found'
  | 'unauthorized'
  | 'forbidden'
  | 'server'
  | 'network';

export interface DeleteConversationError {
  kind: DeleteConversationErrorKind;
  message: string;
}

export function classifyDeleteConversationError(error: unknown): DeleteConversationError {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return { kind: 'unauthorized', message: 'Sua sessão expirou. Faça login novamente.' };
      case 403:
        return { kind: 'forbidden', message: 'Você não tem permissão para remover esta conversa.' };
      case 404:
        return {
          kind: 'not_found',
          message: 'Conversa não encontrada — pode já ter sido removida.',
        };
      default:
        return {
          kind: 'server',
          message: 'Não foi possível remover a conversa agora. Tente novamente em instantes.',
        };
    }
  }

  return {
    kind: 'network',
    message: 'Falha de conexão. Verifique sua internet e tente novamente.',
  };
}

interface DeleteConversationResponse {
  deleted: boolean;
}

async function deleteAssistantConversation(id: string): Promise<DeleteConversationResponse> {
  return api.delete<DeleteConversationResponse>(
    `/api/assistant/conversations/${encodeURIComponent(id)}`,
  );
}

export interface UseDeleteAssistantConversationResult {
  /** Dispara DELETE /api/assistant/conversations/:id; resolve com `{ deleted }`
   * ou rejeita (classifique com classifyDeleteConversationError). */
  remove: (id: string) => Promise<DeleteConversationResponse>;
  isPending: boolean;
  reset: () => void;
}

export function useDeleteAssistantConversation(): UseDeleteAssistantConversationResult {
  const queryClient = useQueryClient();

  const mutation: UseMutationResult<DeleteConversationResponse, unknown, string> = useMutation({
    mutationFn: (id: string) => deleteAssistantConversation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: assistantConversationKeys.list() });
    },
  });

  return {
    remove: (id: string) => mutation.mutateAsync(id),
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
