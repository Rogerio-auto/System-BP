// =============================================================================
// MessageComposer/useSendMessage.ts — Mutation de envio de mensagem.
//
// - POST /api/livechat/conversations/:id/messages
// - Header Idempotency-Key: <uuid> gerado por submit
// - Optimistic update: insere a mensagem localmente antes da resposta
// - Em erro: rollback do cache + toast de erro
//
// LGPD (doc 17):
//   - Não loga message.content em console nem em qualquer storage
//   - Não armazena em localStorage
// =============================================================================

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';

import { useToast } from '../../../../components/ui/Toast';
import { api } from '../../../../lib/api';
import { conversationKeys } from '../../queries';
import type { Message, MessageListResponse } from '../../types';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface SendMessagePayload {
  type: 'text';
  content: string;
  idempotencyKey: string;
}

export interface SendMessageResult {
  data: Message;
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function sendMessage(
  conversationId: string,
  payload: SendMessagePayload,
): Promise<SendMessageResult> {
  return api.post<SendMessageResult>(
    `/api/livechat/conversations/${encodeURIComponent(conversationId)}/messages`,
    { type: payload.type, content: payload.content, idempotencyKey: payload.idempotencyKey },
    {
      headers: {
        'Idempotency-Key': payload.idempotencyKey,
      },
    },
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useSendMessage — mutation com optimistic update e rollback.
 *
 * O idempotencyKey deve ser gerado pelo componente chamador via
 * `crypto.randomUUID()` na hora do submit (novo UUID por tentativa).
 */
export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: (payload: SendMessagePayload) => sendMessage(conversationId, payload),

    // ── Optimistic update ───────────────────────────────────────────────────
    onMutate: async (payload) => {
      // Cancela re-fetches pendentes para não sobrescrever o optimistic
      await qc.cancelQueries({ queryKey: conversationKeys.messages(conversationId) });

      // Snapshot do estado anterior para rollback
      const previousData = qc.getQueryData<InfiniteData<MessageListResponse>>(
        conversationKeys.messages(conversationId),
      );

      // Mensagem otimista — temporária, sem id real
      const optimisticMessage: Message = {
        id: `optimistic-${payload.idempotencyKey}`,
        conversationId,
        channelId: '',
        direction: 'out',
        externalId: null,
        type: 'text',
        // LGPD: conteúdo apenas em memória para exibição imediata
        content: payload.content,
        mediaUrl: null,
        mediaMime: null,
        mediaSizeBytes: null,
        mediaSha256: null,
        interactivePayload: null,
        // sent: aguardando confirmação do servidor
        viewStatus: 'sent',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Injeta no cache: adiciona no início da primeira página (mais recente)
      qc.setQueryData<InfiniteData<MessageListResponse>>(
        conversationKeys.messages(conversationId),
        (old) => {
          if (!old) return old;

          const firstPage = old.pages[0];
          if (!firstPage) return old;

          const newFirstPage: MessageListResponse = {
            ...firstPage,
            data: [optimisticMessage, ...firstPage.data],
          };

          return {
            ...old,
            pages: [newFirstPage, ...old.pages.slice(1)],
          };
        },
      );

      return { previousData };
    },

    // ── Sucesso: invalida para receber a mensagem real do servidor ──────────
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: conversationKeys.messages(conversationId),
      });
    },

    // ── Erro: rollback + toast ───────────────────────────────────────────────
    onError: (_error, _payload, context) => {
      if (context?.previousData !== undefined) {
        qc.setQueryData(conversationKeys.messages(conversationId), context.previousData);
      }
      // Mensagem de erro genérica — sem vazar conteúdo da mensagem
      toast('Não foi possível enviar a mensagem. Tente novamente.', 'danger');
    },
  });
}
