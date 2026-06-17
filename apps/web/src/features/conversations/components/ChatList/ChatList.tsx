// =============================================================================
// ChatList/ChatList.tsx — Lista de conversas do inbox (F16-S16).
//
// Funcionalidades:
//   - Busca debounced 300ms (filtra por contactName no cliente)
//   - Filtro de status (all / open / pending / resolved)
//   - Scroll infinito com IntersectionObserver + cursor acumulado
//   - Realtime via useConversationSocket (invalida cache em message:new)
//   - Estados explícitos: loading (skeletons), empty, error
//   - Acessível: aria-label, lista semântica
//
// LGPD (doc 17 §8.1): contactName e contactRemoteId não são logados.
// =============================================================================

import * as React from 'react';

import { useSocket } from '../../../../lib/realtime/useSocket';
import { useChannels } from '../../../configuracoes/canais/useChannels';
import {
  useConversationSocket,
  type UseConversationSocketOptions,
} from '../../hooks/useConversationSocket';
import { useConversations } from '../../queries';
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
 * ChatList — painel esquerdo do inbox.
 *
 * Integra filtros, busca debounced, scroll infinito e realtime.
 * O SocketProvider deve estar montado acima na árvore.
 *
 * Paginação: cursor-based. `nextCursor` da resposta é passado para a
 * próxima query quando o sentinel entra na viewport. Os resultados são
 * acumulados em `accumulatedConversations` para exibição contínua.
 */
export function ChatList({
  selectedConversationId,
  onSelectConversation,
}: ChatListProps): React.JSX.Element {
  // ── Estado local dos filtros ─────────────────────────────────────────────
  const [searchRaw, setSearchRaw] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('open');
  const searchDebounced = useDebounce(searchRaw, 300);

  // ── Cursor de paginação ──────────────────────────────────────────────────
  const [cursor, setCursor] = React.useState<string | undefined>(undefined);
  // Acumula conversas de múltiplas páginas
  const [accumulated, setAccumulated] = React.useState<Conversation[]>([]);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  // ── Query params ─────────────────────────────────────────────────────────
  const queryParams: ConversationsQueryParams = React.useMemo(() => {
    const base: ConversationsQueryParams =
      statusFilter !== 'all'
        ? { limit: LIMIT, status: statusFilter as ConversationStatus }
        : { limit: LIMIT };
    // cursor: só inclui quando definido (exactOptionalPropertyTypes)
    return cursor !== undefined ? { ...base, cursor } : base;
  }, [statusFilter, cursor]);

  const { data, isLoading, isError, refetch } = useConversations(queryParams);

  // Mapa channelId → nome do canal para exibir no item da lista
  const { channels } = useChannels();
  const channelNameMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of channels) map.set(ch.id, ch.name);
    return map;
  }, [channels]);

  // Acumula resultados quando a query retorna dados novos
  React.useEffect(() => {
    if (!data) return;
    if (cursor === undefined) {
      // Primeira página ou reset de filtro — substitui tudo
      setAccumulated(data.data);
    } else {
      // Página seguinte — acumula (dedup por id)
      setAccumulated((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const newItems = data.data.filter((c) => !existingIds.has(c.id));
        return [...prev, ...newItems];
      });
    }
  }, [data, cursor]);

  // Reset ao mudar o filtro de status
  const handleStatusChange = React.useCallback((v: StatusFilter) => {
    setStatusFilter(v);
    setCursor(undefined);
    setAccumulated([]);
  }, []);

  // ── Realtime: invalida cache ao receber message:new ──────────────────────
  // exactOptionalPropertyTypes: só passa conversationId quando definido
  const socketOptions: UseConversationSocketOptions =
    selectedConversationId !== null ? { conversationId: selectedConversationId } : {};
  useConversationSocket(socketOptions);

  // Ao receber um evento de nova mensagem, reseta o cursor para a primeira
  // página para que a lista reflita novidades que chegaram no topo (ex: nova
  // conversa que não estava na página atual). O useConversationSocket já
  // invalida o cache — este efeito garante que o re-fetch parte da pág. 1.
  const socket = useSocket();
  React.useEffect(() => {
    if (!socket) return;
    function handleMessageNew(): void {
      setCursor(undefined);
    }
    socket.on('message:new', handleMessageNew);
    return () => {
      socket.off('message:new', handleMessageNew);
    };
  }, [socket]);

  // ── Filtro de busca (cliente-side sobre dados acumulados) ────────────────
  const conversations: Conversation[] = React.useMemo(() => {
    if (!searchDebounced.trim()) return accumulated;
    const q = searchDebounced.trim().toLowerCase();
    return accumulated.filter((c) => (c.contactName ?? '').toLowerCase().includes(q));
  }, [accumulated, searchDebounced]);

  // ── Scroll infinito via IntersectionObserver ─────────────────────────────
  const hasNextPage = data !== null && data !== undefined && data.nextCursor !== null;

  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first?.isIntersecting && data?.nextCursor) {
          setCursor(data.nextCursor);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, data]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-elev-1)' }}>
      {/* Filtros no topo */}
      <ChatListFilters
        search={searchRaw}
        onSearchChange={setSearchRaw}
        status={statusFilter}
        onStatusChange={handleStatusChange}
      />

      {/* Lista de conversas */}
      <div
        role="list"
        aria-label="Conversas"
        className="flex-1 overflow-y-auto"
        style={{ overscrollBehavior: 'contain' }}
      >
        {isLoading && accumulated.length === 0 && <ChatListSkeleton />}

        {isError && !isLoading && <ErrorState onRetry={() => void refetch()} />}

        {!isLoading && !isError && conversations.length === 0 && <EmptyState />}

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

            {/* Sentinel para scroll infinito */}
            {hasNextPage && (
              <div
                ref={sentinelRef}
                aria-hidden="true"
                className="flex justify-center py-3"
                style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}
              >
                Carregando mais...
              </div>
            )}

            {/* Loading de página seguinte */}
            {isLoading && accumulated.length > 0 && (
              <div
                className="flex justify-center py-3"
                style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}
              >
                <span className="animate-pulse">Carregando...</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Rodapé: contagem */}
      {!isError && accumulated.length > 0 && (
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
