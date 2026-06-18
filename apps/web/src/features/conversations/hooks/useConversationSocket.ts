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
      const isOpen = conversationId !== undefined && payload.conversationId === conversationId;

      // 1. Atualização CIRÚRGICA da lista (sem refetch). A lista é ordenada por
      //    lastMessageAt desc no servidor → movemos a conversa para o topo,
      //    atualizamos o timestamp e incrementamos unreadCount (apenas inbound
      //    em conversa NÃO aberta). O item da lista não tem preview de texto e o
      //    payload não carrega content (LGPD) → nada fica stale; zero request.
      let foundInList = false;
      qc.setQueriesData<ConversationListResponse>(
        { queryKey: ['conversations', 'list'], exact: false },
        (old) => {
          if (!old || !Array.isArray(old.data)) return old;
          const idx = old.data.findIndex((c) => c.id === payload.conversationId);
          if (idx === -1) return old;
          const conv = old.data[idx];
          if (!conv) return old;
          foundInList = true;
          const updated: Conversation = {
            ...conv,
            lastMessageAt: payload.createdAt,
            lastInboundAt: payload.direction === 'inbound' ? payload.createdAt : conv.lastInboundAt,
            unreadCount:
              payload.direction === 'inbound' && !isOpen ? conv.unreadCount + 1 : conv.unreadCount,
          };
          const rest = [...old.data.slice(0, idx), ...old.data.slice(idx + 1)];
          return { ...old, data: [updated, ...rest] };
        },
      );

      // 2. Conversa nova (ainda não está em nenhuma lista carregada) → invalida
      //    a lista só para ela aparecer. Acontece apenas no PRIMEIRO contato.
      if (!foundInList) {
        void qc.invalidateQueries({ queryKey: ['conversations', 'list'] });
      }

      // 3. Conversa aberta → buscar a nova mensagem (com content). Apenas messages,
      //    não detalhe/window/templates (não mudaram com uma nova mensagem).
      if (isOpen) {
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
        // Escopo APENAS às queries de lista (['conversations','list',...]).
        // conversationKeys.all (['conversations']) com exact:false casaria também
        // detail/messages, cujo `data` não é array → crash (.map de undefined).
        qc.setQueriesData<ConversationListResponse>(
          { queryKey: ['conversations', 'list'], exact: false },
          (old) => {
            if (!old || !Array.isArray(old.data)) return old;
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

      // Status/atribuição/resolução mudaram. Invalida só a LISTA (reflete
      // status/ordem) — não conversationKeys.all (que atingiria window/templates
      // à toa). Para a conversa aberta, atualiza detalhe (status/agente) e
      // mensagens (checkmarks de view status mudam via callbacks do provider).
      void qc.invalidateQueries({ queryKey: ['conversations', 'list'] });

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
      { queryKey: ['conversations', 'list'], exact: false },
      (old) => {
        if (!old || !Array.isArray(old.data)) return old;
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
