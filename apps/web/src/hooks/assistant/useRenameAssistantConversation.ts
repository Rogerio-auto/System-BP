// =============================================================================
// hooks/assistant/useRenameAssistantConversation.ts — Mutation de renomear
// uma conversa salva do histórico do copiloto interno (F6-S29, barra
// lateral). Consome F6-S25 — PATCH /api/assistant/conversations/:id.
//
// Contrato real (apps/api/src/modules/assistant-history/schemas.ts):
//   request:  { title: string } (1..200 chars — higienizado no backend
//              antes de gravar: DLP + mascaramento de nome)
//   response: ConversationSummary (id, title, created_at, updated_at)
//
// Owner-scoped no backend: conversa de outro usuário ou inexistente
// retorna 404 (nunca 403 — não vazar existência do recurso).
//
// Invalida a lista + o detalhe da conversa renomeada, para o título novo
// refletir tanto na barra lateral quanto no cabeçalho do workspace se essa
// conversa estiver aberta.
// =============================================================================

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { api, ApiError } from '../../lib/api';

import { assistantConversationKeys } from './useAssistantConversation';
import type { AssistantConversationSummary } from './useAssistantConversations';

/** Espelha RenameConversationBodySchema.title (backend: 1..200 chars). */
export const ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH = 200;

export interface RenameAssistantConversationInput {
  id: string;
  title: string;
}

export type RenameConversationErrorKind =
  | 'not_found'
  | 'invalid'
  | 'unauthorized'
  | 'forbidden'
  | 'server'
  | 'network';

export interface RenameConversationError {
  kind: RenameConversationErrorKind;
  message: string;
}

/**
 * Traduz um erro de rede/API em uma mensagem graciosa para o operador.
 * 404 é owner-scoped (conversa de outro usuário, inexistente, ou já
 * removida — o backend nunca distingue os três casos, de propósito).
 */
export function classifyRenameConversationError(error: unknown): RenameConversationError {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return { kind: 'unauthorized', message: 'Sua sessão expirou. Faça login novamente.' };
      case 403:
        return {
          kind: 'forbidden',
          message: 'Você não tem permissão para renomear esta conversa.',
        };
      case 404:
        return { kind: 'not_found', message: 'Conversa não encontrada — pode ter sido removida.' };
      case 400:
        return {
          kind: 'invalid',
          message: `Título inválido. Use até ${ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH} caracteres.`,
        };
      default:
        return {
          kind: 'server',
          message: 'Não foi possível renomear a conversa agora. Tente novamente em instantes.',
        };
    }
  }

  return {
    kind: 'network',
    message: 'Falha de conexão. Verifique sua internet e tente novamente.',
  };
}

async function patchAssistantConversation(
  id: string,
  title: string,
): Promise<AssistantConversationSummary> {
  return api.patch<AssistantConversationSummary>(
    `/api/assistant/conversations/${encodeURIComponent(id)}`,
    { title },
  );
}

export interface UseRenameAssistantConversationResult {
  /** Dispara PATCH /api/assistant/conversations/:id; resolve com o resumo
   * atualizado ou rejeita (classifique com classifyRenameConversationError). */
  rename: (input: RenameAssistantConversationInput) => Promise<AssistantConversationSummary>;
  isPending: boolean;
  reset: () => void;
}

export function useRenameAssistantConversation(): UseRenameAssistantConversationResult {
  const queryClient = useQueryClient();

  const mutation: UseMutationResult<
    AssistantConversationSummary,
    unknown,
    RenameAssistantConversationInput
  > = useMutation({
    mutationFn: ({ id, title }: RenameAssistantConversationInput) =>
      patchAssistantConversation(id, title),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: assistantConversationKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: assistantConversationKeys.detail(variables.id),
      });
    },
  });

  return {
    rename: (input) => mutation.mutateAsync(input),
    isPending: mutation.isPending,
    reset: mutation.reset,
  };
}
