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
// scope — DUAS montagens coexistem quando uma conversa está aberta (ChatList
// sempre montado + ConversationPanel montado enquanto há seleção), ambas
// recebendo o MESMO evento global (não há filtragem por sala para
// message:new/conversation:updated). Historicamente as duas processavam a
// LISTA inteira, então um inbound em conversa de fundo incrementava o
// unreadCount DUAS VEZES (bug do contador). `scope` isola a responsabilidade:
//   'list'   — dono do cache da LISTA (reordenar, unreadCount, badge-zero ao
//              selecionar). Deve haver EXATAMENTE UMA instância montada com
//              scope 'list' por vez — ChatList.
//   'detail' — dono do cache de DETALHE/MENSAGENS da conversa aberta e da
//              sala socket (conversation:join/leave para eventos de
//              granularidade fina) — ConversationPanel.
//
// Estratégia de atualização:
//   message:new (scope 'list'):
//     1. Atualização cirúrgica do cache da lista (reordena + unreadCount).
//     2. Conversa não encontrada em nenhuma página → invalida a lista (1º contato).
//   message:new (scope 'detail'):
//     3. Se a mensagem é da conversa aberta, agenda refetch (debounced) do
//        detalhe + mensagens.
//
//   conversation:updated:
//     - Payload com unreadCount (scope 'list' apenas) → set direto no cache.
//     - Demais mudanças (status/atribuição) → cada scope invalida sua fatia
//       (lista em 'list', detalhe+mensagens em 'detail' quando é a conversa aberta).
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
//   // No componente que exibe a lista (ChatList) — dono do cache da lista:
//   useConversationSocket({ conversationId: selectedId ?? undefined, scope: 'list' });
//
//   // No componente de chat aberto (ConversationPanel) — dono do detalhe:
//   useConversationSocket({ conversationId: id, scope: 'detail' });
// =============================================================================

import type { InfiniteData } from '@tanstack/react-query';
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
// Helpers puros de update do cache da lista (INFINITE QUERY)
//
// A lista do inbox usa useInfiniteQuery → o cache tem shape
// InfiniteData<ConversationListResponse> = { pages: [{ data, nextCursor }...] }.
// Estes helpers operam sobre TODAS as páginas e são exportados para teste
// isolado (ver __tests__/realtime.test.ts) — a lógica testada é a REAL.
// ---------------------------------------------------------------------------

/** Cache da lista de conversas como infinite query (ou undefined se não carregada). */
export type ConversationListCache = InfiniteData<ConversationListResponse> | undefined;

/**
 * Atualiza o unreadCount de uma conversa em TODAS as páginas (in place, sem reordenar).
 * Retorna a MESMA referência se a conversa não estiver em nenhuma página (evita
 * refetch/re-render desnecessário — preserva a semântica do teste #3).
 */
export function applyUnreadCountToList(
  old: ConversationListCache,
  conversationId: string,
  unreadCount: number,
): ConversationListCache {
  // Guarda contra entradas de shape flat legado (`{data,nextCursor}`) que o
  // prefixo ['conversations','list'] do setQueriesData ainda casa — sem `pages`
  // não é infinite: retorna intacto (não é nossa query).
  if (!old || !Array.isArray(old.pages)) return old;
  let changed = false;
  const pages = old.pages.map((page) => {
    if (!Array.isArray(page.data) || !page.data.some((c) => c.id === conversationId)) return page;
    changed = true;
    return {
      ...page,
      data: page.data.map((c) => (c.id === conversationId ? { ...c, unreadCount } : c)),
    };
  });
  return changed ? { ...old, pages } : old;
}

/**
 * Aplica um evento message:new à lista: move a conversa para o TOPO (página 0),
 * atualiza timestamps e incrementa unreadCount (apenas inbound em conversa não aberta).
 *
 * Retorna `{ next, found }`. Se a conversa não estiver em nenhuma página carregada
 * (`found=false`), o chamador invalida a lista para que ela apareça (1º contato).
 */
export function applyMessageNewToList(
  old: ConversationListCache,
  payload: MessageNewPayload,
  isOpen: boolean,
): { next: ConversationListCache; found: boolean } {
  // Guarda contra shape flat legado (ver applyUnreadCountToList).
  if (!old || !Array.isArray(old.pages)) return { next: old, found: false };

  let existing: Conversation | undefined;
  for (const page of old.pages) {
    if (!Array.isArray(page.data)) continue;
    const hit = page.data.find((c) => c.id === payload.conversationId);
    if (hit) {
      existing = hit;
      break;
    }
  }
  if (!existing) return { next: old, found: false };

  const updated: Conversation = {
    ...existing,
    lastMessageAt: payload.createdAt,
    lastInboundAt: payload.direction === 'inbound' ? payload.createdAt : existing.lastInboundAt,
    unreadCount:
      payload.direction === 'inbound' && !isOpen ? existing.unreadCount + 1 : existing.unreadCount,
  };

  // Remove de todas as páginas e prepende na página 0.
  const pages = old.pages.map((page) => ({
    ...page,
    data: Array.isArray(page.data)
      ? page.data.filter((c) => c.id !== payload.conversationId)
      : page.data,
  }));
  const firstPage = pages[0] ?? { data: [], nextCursor: null };
  pages[0] = { ...firstPage, data: [updated, ...firstPage.data] };

  return { next: { ...old, pages }, found: true };
}

// ---------------------------------------------------------------------------
// Opções do hook
// ---------------------------------------------------------------------------

export interface UseConversationSocketOptions {
  /**
   * UUID da conversa atualmente aberta na UI (selecionada), independente do
   * `scope` desta montagem. Usado para decidir se um `message:new` deve
   * incrementar o badge (scope 'list') ou disparar refetch de detalhe/mensagens
   * (scope 'detail'). undefined = nenhuma conversa aberta.
   */
  readonly conversationId?: string;
  /**
   * Qual fatia do cache esta montagem do hook possui:
   *   'list'   — cache da LISTA de conversas (ChatList). Uma instância só.
   *   'detail' — cache de detalhe/mensagens da conversa aberta + sala socket
   *              (ConversationPanel).
   */
  readonly scope: 'list' | 'detail';
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
export function useConversationSocket(options: UseConversationSocketOptions): void {
  const { conversationId, scope } = options;
  const socket = useSocket();
  const qc = useQueryClient();
  const isListOwner = scope === 'list';
  const isDetailOwner = scope === 'detail';

  // Debounce para coalescer rajadas de conversation:updated/message:new. Sem
  // isso, cada evento dispara invalidações a cada disparo -> refetch storm
  // que estoura o rate-limit (429) quando o backend emite muitos eventos em
  // sequencia (ex.: reprocessamento apos restart). Coalescemos numa janela curta.
  //
  // dirty refs SEPARADOS por fatia (list vs detail) — cada montagem do hook só
  // marca/consome a sua própria fatia (ver `scope` no cabeçalho do arquivo).
  const flushTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const listDirty = React.useRef(false);
  const detailDirty = React.useRef(false);

  const flushDirty = React.useCallback(() => {
    flushTimer.current = null;
    if (isListOwner && listDirty.current) {
      listDirty.current = false;
      void qc.invalidateQueries({ queryKey: ['conversations', 'list'] });
    }
    if (isDetailOwner && detailDirty.current && conversationId) {
      detailDirty.current = false;
      void qc.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) });
      void qc.invalidateQueries({ queryKey: conversationKeys.messages(conversationId) });
    }
  }, [qc, conversationId, isListOwner, isDetailOwner]);

  const scheduleFlush = React.useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(flushDirty, 350);
  }, [flushDirty]);

  // ── message:new ─────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!socket) return;

    function handleMessageNew(payload: MessageNewPayload): void {
      const isOpenConversation =
        conversationId !== undefined && payload.conversationId === conversationId;

      // scope 'list': única dona do cache da LISTA. Sem isso duplicado em
      // 'detail', um inbound em conversa de fundo não é mais contado 2x
      // (bug do contador: ChatList + ConversationPanel processavam o MESMO
      // evento global e cada um incrementava o unreadCount).
      if (isListOwner) {
        // 1. Atualização CIRÚRGICA da lista (sem refetch). A lista é ordenada por
        //    lastMessageAt desc no servidor → movemos a conversa para o topo,
        //    atualizamos o timestamp e incrementamos unreadCount (apenas inbound
        //    em conversa NÃO aberta). O item da lista não tem preview de texto e o
        //    payload não carrega content (LGPD) → nada fica stale; zero request.
        //    A lista é infinite query → operamos sobre InfiniteData (todas as páginas).
        let foundInList = false;
        qc.setQueriesData<InfiniteData<ConversationListResponse>>(
          { queryKey: ['conversations', 'list'], exact: false },
          (old) => {
            const { next, found } = applyMessageNewToList(old, payload, isOpenConversation);
            if (found) foundInList = true;
            return next;
          },
        );

        // 2. Conversa nova (ainda não está em nenhuma lista carregada) → invalida
        //    a lista só para ela aparecer. Acontece apenas no PRIMEIRO contato.
        if (!foundInList) {
          void qc.invalidateQueries({ queryKey: ['conversations', 'list'] });
        }
      }

      // scope 'detail': única dona do refetch de detalhe/mensagens da conversa
      // aberta. DEBOUNCED: a rajada do bot (N mensagens => N eventos) colapsa
      // num único refetch, evitando 429 no rate-limit.
      if (isDetailOwner && isOpenConversation) {
        detailDirty.current = true;
        scheduleFlush();
      }
    }

    socket.on('message:new', handleMessageNew);

    return () => {
      socket.off('message:new', handleMessageNew);
    };
  }, [socket, qc, conversationId, scheduleFlush, isListOwner, isDetailOwner]);

  // ── conversation:updated ─────────────────────────────────────────────────
  React.useEffect(() => {
    if (!socket) return;

    function handleConversationUpdated(payload: ConversationUpdatedPayload): void {
      // Se o payload tem unreadCount (F16-S26: markConversationRead via workspace room),
      // aplica atualizacao direta em TODOS os items da lista — nao invalida para evitar
      // refetch desnecessario. Apenas o dono da lista aplica (evita write duplicado).
      if (typeof payload.unreadCount === 'number') {
        if (!isListOwner) return;
        // Escopo APENAS às queries de lista (['conversations','list',...]).
        // conversationKeys.all (['conversations']) com exact:false casaria também
        // detail/messages, cuja estrutura não é infinite → crash.
        const unread = payload.unreadCount;
        qc.setQueriesData<InfiniteData<ConversationListResponse>>(
          { queryKey: ['conversations', 'list'], exact: false },
          (old) => applyUnreadCountToList(old, payload.conversationId, unread),
        );
        return;
      }

      // Status/atribuição/resolução mudaram. Cada scope marca dirty a sua
      // própria fatia e agenda o flush debounced — uma rajada de N eventos
      // colapsa em 1 conjunto de invalidações por fatia.
      if (isListOwner) {
        listDirty.current = true;
        scheduleFlush();
      }
      if (isDetailOwner && conversationId && payload.conversationId === conversationId) {
        detailDirty.current = true;
        scheduleFlush();
      }
    }

    socket.on('conversation:updated', handleConversationUpdated);

    return () => {
      socket.off('conversation:updated', handleConversationUpdated);
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [socket, qc, conversationId, scheduleFlush, isListOwner, isDetailOwner]);

  // ── badge zero ao abrir conversa ─────────────────────────────────────────
  // Quando conversationId muda (conversa aberta), zeramos imediatamente o
  // unreadCount no cache local. O backend já zerou via GET /messages (F16-S26).
  // Nao esperamos o socket event — resposta imediata para o badge sumir.
  // Apenas o dono da lista escreve (evita write duplicado em 'detail').
  React.useEffect(() => {
    if (!isListOwner || !conversationId) return;
    qc.setQueriesData<InfiniteData<ConversationListResponse>>(
      { queryKey: ['conversations', 'list'], exact: false },
      (old) => applyUnreadCountToList(old, conversationId, 0),
    );
  }, [isListOwner, conversationId, qc]);

  // ── conversation:join / leave ────────────────────────────────────────────
  // Só o dono do detalhe (conversa aberta) entra na sala — recebe eventos de
  // granularidade fina (ex: typing, view status por mensagem). A lista não
  // precisa: message:new/conversation:updated já chegam pela sala da
  // organização. O servidor valida que conversationId pertence à org do usuário.
  React.useEffect(() => {
    if (!socket || !isDetailOwner || !conversationId) return;

    socket.emit('conversation:join', { conversationId });

    return () => {
      socket.emit('conversation:leave', { conversationId });
    };
  }, [socket, conversationId, isDetailOwner]);
}
