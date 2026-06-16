// =============================================================================
// MessageComposer/useSendMessage.ts — Mutation de envio de mensagem.
//
// - POST /api/conversations/:id/messages
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

export type MediaKind = 'image' | 'video' | 'audio' | 'document';

export interface SendTextPayload {
  type: 'text';
  content: string;
  idempotencyKey: string;
}

export interface SendMediaPayload {
  type: 'media';
  mediaKind: MediaKind;
  publicMediaUrl: string;
  mime: string;
  fileName: string;
  idempotencyKey: string;
}

export interface SendTemplatePayload {
  type: 'template';
  templateName: string;
  languageCode: string;
  components: unknown[];
  idempotencyKey: string;
}

export type SendMessagePayload = SendTextPayload | SendMediaPayload | SendTemplatePayload;

export interface SendMessageResult {
  data: Message;
}

// ─── Fetcher ─────────────────────────────────────────────────────────────────

async function sendMessage(
  conversationId: string,
  payload: SendMessagePayload,
): Promise<SendMessageResult> {
  const { idempotencyKey, ...bodyFields } = payload;
  return api.post<SendMessageResult>(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
    bodyFields,
    {
      headers: {
        'Idempotency-Key': idempotencyKey,
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
      await qc.cancelQueries({ queryKey: conversationKeys.messages(conversationId) });

      const previousData = qc.getQueryData<InfiniteData<MessageListResponse>>(
        conversationKeys.messages(conversationId),
      );

      const optimisticMessage: Message = {
        id: `optimistic-${payload.idempotencyKey}`,
        conversationId,
        channelId: '',
        direction: 'out',
        externalId: null,
        type:
          payload.type === 'text'
            ? 'text'
            : payload.type === 'template'
              ? 'template'
              : payload.mediaKind,
        // LGPD: conteúdo apenas em memória para exibição imediata
        content:
          payload.type === 'text'
            ? payload.content
            : payload.type === 'template'
              ? payload.templateName
              : null,
        mediaUrl: payload.type === 'media' ? payload.publicMediaUrl : null,
        mediaMime: payload.type === 'media' ? payload.mime : null,
        mediaSizeBytes: null,
        mediaSha256: null,
        interactivePayload: null,
        viewStatus: 'sent',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

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
          return { ...old, pages: [newFirstPage, ...old.pages.slice(1)] };
        },
      );

      return { previousData };
    },

    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    },

    onError: (_error, _payload, context) => {
      if (context?.previousData !== undefined) {
        qc.setQueryData(conversationKeys.messages(conversationId), context.previousData);
      }
      toast('Não foi possível enviar a mensagem. Tente novamente.', 'danger');
    },
  });
}
