// =============================================================================
// ChatList/ChatList.tsx — Lista de conversas do inbox (F16-S16).
//
// Funcionalidades:
//   - Busca debounced 300ms (filtra por contactName no cliente)
//   - Filtro de status: dropdown no header (ChatListFilters), estado local
//     (default 'all' — todas), gerenciado aqui junto com useConversationCounts.
//   - Scroll infinito via useInfiniteQuery + IntersectionObserver (paginação
//     interna ao TanStack, cacheada por status — sem cursor/accumulated manual).
//     O observer usa o próprio container de scroll como `root` (não o viewport)
//     para disparar corretamente dentro do painel aninhado.
//   - Realtime via useConversationSocket (scope 'list' — cache da lista)
//   - Estados explícitos: loading (skeletons), empty, error
//   - Acessível: aria-label, lista semântica
//
// Redesign: statusFilter e useConversationCounts voltaram a viver aqui (o
// dropdown de status é parte do header do ChatList — sem prop-drilling via
// ConversationsLayout, que hoje só monta o shell de colunas).
//
// LGPD (doc 17 §8.1): contactName e contactRemoteId não são logados.
// =============================================================================

import * as React from 'react';

import { useChannels } from '../../../configuracoes/canais/useChannels';
import {
  useConversationSocket,
  type UseConversationSocketOptions,
} from '../../hooks/useConversationSocket';
import { useConversationCounts, useConversationsInfinite } from '../../queries';
import type { Conversation, ConversationsQueryParams, ConversationStatus } from '../../types';

import type { StatusFilter } from './ChatListFilters';
import { ChatListFilters } from './ChatListFilters';
import { ChatListItem } from './ChatListItem';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const LIMIT = 25;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ChatListProps {
  /** UUID da conversa atualmente selecionada */
  readonly selectedConversationId: string | null;
  /** Callback quando o usuário seleciona uma conversa */
  readonly onSelectConversation: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Hook de debounce interno
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState<T>(value);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

// ---------------------------------------------------------------------------
// Skeletons de loading (nunca spinner sozinho — DS §8)
// ---------------------------------------------------------------------------

function ChatListSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={String(i)} className="flex items-center gap-3 px-4 py-3 animate-pulse">
          {/* Avatar skeleton */}
          <div
            className="rounded-full flex-shrink-0"
            style={{
              width: 40,
              height: 40,
              background: 'var(--surface-muted)',
            }}
          />
          {/* Texto skeleton */}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <div className="h-3 rounded w-3/4" style={{ background: 'var(--surface-muted)' }} />
            <div className="h-2.5 rounded w-1/2" style={{ background: 'var(--surface-muted)' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado vazio
// ---------------------------------------------------------------------------

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
      {/* Ícone caixa de entrada vazia */}
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 48,
          height: 48,
          background: 'var(--surface-muted)',
          color: 'var(--text-3)',
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </span>
      <p
        className="font-sans font-medium"
        style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
      >
        Nenhuma conversa encontrada
      </p>
      <p className="font-sans" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
        Tente ajustar os filtros ou aguarde novas mensagens.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estado de erro
// ---------------------------------------------------------------------------

interface ErrorStateProps {
  readonly onRetry: () => void;
}

function ErrorState({ onRetry }: ErrorStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-8 px-6 text-center">
      <p className="font-sans" style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
        Não foi possível carregar as conversas.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans font-medium underline transition-opacity duration-fast hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-azul rounded-xs"
        style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-azul)' }}
      >
        Tentar novamente
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatList
// ---------------------------------------------------------------------------

/**
 * ChatList — coluna da lista de conversas do inbox (Col 1 do layout de 3 colunas).
 *
 * Gerencia o próprio statusFilter (dropdown no header) e useConversationCounts.
 * Integra busca debounced, scroll infinito e realtime (scope 'list').
 * O SocketProvider deve estar montado acima na árvore.
 */
export function ChatList({
  selectedConversationId,
  onSelectConversation,
}: ChatListProps): React.JSX.Element {
  // ── Estado local da busca ────────────────────────────────────────────────
  const [searchRaw, setSearchRaw] = React.useState('');
  const searchDebounced = useDebounce(searchRaw, 300);

  // ── Estado local do filtro de status — padrão 'all' (Todas) ───────────────
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const { data: countsData } = useConversationCounts();

  const sentinelRef = React.useRef<HTMLDivElement | null>(null);
  // Container de scroll — usado como `root` do IntersectionObserver (em vez do
  // viewport) para que o sentinelo dispare corretamente dentro do painel
  // aninhado (`flex-1 overflow-y-auto`). Ver efeito de scroll infinito abaixo.
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);

  // ── Query params (SEM cursor — a paginação é interna à infinite query) ────
  // A queryKey é por-status → cada aba é uma query isolada, cacheada com todas
  // as suas páginas. Alternar status é só trocar de query: o TanStack restaura
  // as páginas já carregadas instantaneamente. Sem cursor state, sem accumulated,
  // sem reset manual — a classe inteira de bugs de "lista vazia ao alternar" e
  // "scroll travado" some na raiz.
  const queryParams: ConversationsQueryParams = React.useMemo(
    () =>
      statusFilter !== 'all'
        ? { limit: LIMIT, status: statusFilter as ConversationStatus }
        : { limit: LIMIT },
    [statusFilter],
  );

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useConversationsInfinite(queryParams);

  // Mapa channelId → nome do canal para exibir no item da lista
  const { channels } = useChannels();
  const channelNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) map.set(ch.id, ch.name);
    return map;
  }, [channels]);

  // ── Realtime ─────────────────────────────────────────────────────────────
  // scope 'list': ChatList é a ÚNICA dona do cache da lista (badge, reordenação).
  // Ver cabeçalho de useConversationSocket.ts — evita o bug do contador em
  // dobro quando ConversationPanel também está montado (conversa aberta).
  const socketOptions: UseConversationSocketOptions =
    selectedConversationId !== null
      ? { conversationId: selectedConversationId, scope: 'list' }
      : { scope: 'list' };
  useConversationSocket(socketOptions);

  // ── Achata as páginas + filtro de busca (cliente-side) ────────────────────
  // Guard Array.isArray(pages): defesa extra caso o cache tenha shape inesperado
  // (a key 'infinite' já isola de entradas flat legadas — cinto e suspensório).
  const allConversations: Conversation[] = React.useMemo(() => {
    const pages = data?.pages;
    if (!Array.isArray(pages)) return [];
    return pages.flatMap((p) => (Array.isArray(p?.data) ? p.data : []));
  }, [data]);

  const conversations: Conversation[] = React.useMemo(() => {
    if (!searchDebounced.trim()) return allConversations;
    const q = searchDebounced.trim().toLowerCase();
    return allConversations.filter((c) => (c.contactName ?? '').toLowerCase().includes(q));
  }, [allConversations, searchDebounced]);

  // ── Scroll infinito ──────────────────────────────────────────────────────
  // O sentinelo vive dentro do container `role="list"` (flex-1 overflow-y-auto)
  // — um scroll container ANINHADO, não o viewport. Passar `root: null`
  // (padrão) faz o observer computar a interseção contra o viewport do
  // documento, que é ambíguo/instável quando o elemento real que rola é o
  // container interno. Fix: usar o próprio container como `root` — a
  // interseção passa a ser calculada dentro do painel que efetivamente rola,
  // então o fetch da próxima página dispara de forma confiável assim que o
  // sentinelo se aproxima do fundo visível da lista.
  //
  // getNextPageParam retorna undefined quando nextCursor é null → hasNextPage
  // fica false e o observer para (sem sentinelo renderizado — ver JSX abaixo).
  // Guard isFetchingNextPage evita disparos duplicados enquanto uma página
  // carrega. O effect reobserva sempre que hasNextPage muda (nova página =
  // sentinelo remontado) ou quando o container de scroll está pronto.
  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollContainerRef.current;
    if (!sentinel || !root || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root, threshold: 0.1, rootMargin: '120px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-elev-1)' }}>
      {/* Busca + dropdown de status */}
      <ChatListFilters
        search={searchRaw}
        onSearchChange={setSearchRaw}
        status={statusFilter}
        onStatusChange={setStatusFilter}
        counts={countsData}
      />

      {/* Lista de conversas */}
      <div
        ref={scrollContainerRef}
        role="list"
        aria-label="Conversas"
        className="flex-1 overflow-y-auto"
        style={{ overscrollBehavior: 'contain' }}
      >
        {conversations.length === 0 && !isError && isLoading && <ChatListSkeleton />}

        {isError && !isLoading && <ErrorState onRetry={() => void refetch()} />}

        {!isLoading && !isError && data !== undefined && conversations.length === 0 && (
          <EmptyState />
        )}

        {conversations.length > 0 && (
          <>
            {conversations.map((conv) => (
              <div key={conv.id} role="listitem">
                <ChatListItem
                  conversation={conv}
                  selected={selectedConversationId === conv.id}
                  onSelect={onSelectConversation}
                  channelName={channelNameMap.get(conv.channelId) ?? null}
                />
              </div>
            ))}

            {/* Sentinel para scroll infinito — dispara fetchNextPage ao entrar na viewport */}
            {hasNextPage && (
              <div
                ref={sentinelRef}
                aria-hidden="true"
                className="flex justify-center py-3"
                style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}
              >
                {isFetchingNextPage ? (
                  <span className="animate-pulse">Carregando mais...</span>
                ) : (
                  'Role para carregar mais'
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Rodapé: contagem */}
      {!isError && conversations.length > 0 && (
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{
            borderTop: '1px solid var(--border-subtle)',
            background: 'var(--bg-elev-1)',
          }}
        >
          <span
            className="font-sans"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}
          >
            {conversations.length} conversa{conversations.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
