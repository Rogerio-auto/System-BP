// =============================================================================
// features/conversations/hooks/useConversationSocket.ts — Realtime (F16-S15).
//
// Assina eventos Socket.io do namespace /livechat e aplica as atualizações
// ao cache TanStack Query para que a UI reflita mensagens novas e mudanças
// de status sem refetch completo.
//
// Eventos tratados:
//   message:new          → nova mensagem inbound (worker livechat-inbound S08)
//   conversation:updated → mudança de view_status outbound ou status da conversa
//                          (worker livechat-inbound S08 + send.service S13)
//
// Estratégia de atualização:
//   message:new:
//     1. Invalida a lista de conversas (unreadCount mudou).
//     2. Se a conversa está aberta (detalhe carregado), invalida o detalhe.
//     3. Invalida a query de mensagens da conversa — re-fetch automático.
//        (Em S17, trocaremos invalidação por setQueryData para melhor UX.)
//
//   conversation:updated:
//     1. Invalida o detalhe da conversa (viewStatus de mensagem outbound).
//     2. Invalida a query de mensagens (viewStatus atualizado nas bolhas).
//
// Por que invalidar em vez de setQueryData aqui:
//   - S15 é fundação — invalidação é simples, correta e segura.
//   - S17 (Composer) introduzirá setQueryData para otimistic updates em envio.
//   - Evitar complexidade prematura de merging de páginas infinitas aqui.
//
// LGPD (doc 17 §8.3):
//   - Os payloads socket não contêm content nem contactPhone — apenas IDs.
//   - Não logamos payloads recebidos.
//
// Uso:
//   // No componente que exibe a lista (S16):
//   useConversationSocket({ conversationId: activeConversationId });
//
//   // No componente de chat aberto (S17):
//   useConversationSocket({ conversationId: id });
// =============================================================================

import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { useSocket } from '../../../lib/realtime/useSocket';
import { conversationKeys } from '../queries';
import type {
  Conversation,
  ConversationListResponse,
  ConversationUpdatedPayload,
  MessageNewPayload,
} from '../types';

// ---------------------------------------------------------------------------
// Opções do hook
// ---------------------------------------------------------------------------

export interface UseConversationSocketOptions {
  /**
   * UUID da conversa aberta no momento.
   * Quando definido, os eventos dessa conversa também invalidam
   * as queries de detalhe e mensagens desta conversa específica.
   * undefined = apenas a lista geral é mantida atualizada.
   */
  readonly conversationId?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useConversationSocket — integra Socket.io com o cache TanStack Query.
 *
 * Deve ser montado nos componentes de inbox (S16) e de chat (S17).
 * Remove os listeners automaticamente no unmount.
 *
 * Depende do SocketProvider estar montado acima na árvore.
 */
export function useConversationSocket(options: UseConversationSocketOptions = {}): void {
  const { conversationId } = options;
  const socket = useSocket();
  const qc = useQueryClient();

  // ── message:new ─────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!socket) return;

    function handleMessageNew(payload: MessageNewPayload): void {
      // 1. Invalida todas as listas de conversas (unreadCount mudou)
      void qc.invalidateQueries({ queryKey: conversationKeys.all });

      // 2. Se temos uma conversa aberta, invalida detalhe + mensagens
      if (conversationId && payload.conversationId === conversationId) {
        void qc.invalidateQueries({
          queryKey: conversationKeys.detail(conversationId),
        });
        void qc.invalidateQueries({
          queryKey: conversationKeys.messages(conversationId),
        });
      }
    }

    socket.on('message:new', handleMessageNew);

    return () => {
      socket.off('message:new', handleMessageNew);
    };
  }, [socket, qc, conversationId]);

  // ── conversation:updated ─────────────────────────────────────────────────
  React.useEffect(() => {
    if (!socket) return;

    function handleConversationUpdated(payload: ConversationUpdatedPayload): void {
      // Se o payload tem unreadCount (F16-S26: markConversationRead via workspace room),
      // aplica atualizacao direta em TODOS os items da lista — nao invalida para evitar
      // refetch desnecessario. Invalida apenas se nao for uma atualizacao de badge puro.
      if (typeof payload.unreadCount === 'number') {
        qc.setQueriesData<ConversationListResponse>(
          { queryKey: conversationKeys.all, exact: false },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              data: old.data.map((c: Conversation) =>
                c.id === payload.conversationId ? { ...c, unreadCount: payload.unreadCount! } : c,
              ),
            };
          },
        );
        return;
      }

      // Invalida detalhe + mensagens da conversa afetada.
      // Se nao ha conversa aberta localmente, qualquer conversa pode ter mudado —
      // invalidamos a lista para refletir status atualizado.
      void qc.invalidateQueries({ queryKey: conversationKeys.all });

      if (conversationId && payload.conversationId === conversationId) {
        void qc.invalidateQueries({
          queryKey: conversationKeys.detail(conversationId),
        });
        void qc.invalidateQueries({
          queryKey: conversationKeys.messages(conversationId),
        });
      }
    }

    socket.on('conversation:updated', handleConversationUpdated);

    return () => {
      socket.off('conversation:updated', handleConversationUpdated);
    };
  }, [socket, qc, conversationId]);

  // ── badge zero ao abrir conversa ─────────────────────────────────────────
  // Quando conversationId muda (conversa aberta), zeramos imediatamente o
  // unreadCount no cache local. O backend já zerou via GET /messages (F16-S26).
  // Nao esperamos o socket event — resposta imediata para o badge sumir.
  React.useEffect(() => {
    if (!conversationId) return;
    qc.setQueriesData<ConversationListResponse>(
      { queryKey: conversationKeys.all, exact: false },
      (old) => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map((c: Conversation) =>
            c.id === conversationId ? { ...c, unreadCount: 0 } : c,
          ),
        };
      },
    );
  }, [conversationId, qc]);

  // ── conversation:join / leave ────────────────────────────────────────────
  // Quando uma conversa específica está aberta, entramos na sala para
  // receber eventos de granularidade fina (ex: typing, view status por mensagem).
  // O servidor valida que conversationId pertence à org do usuário.
  React.useEffect(() => {
    if (!socket || !conversationId) return;

    socket.emit('conversation:join', { conversationId });

    return () => {
      socket.emit('conversation:leave', { conversationId });
    };
  }, [socket, conversationId]);
}
