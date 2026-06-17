// =============================================================================
// features/conversations/components/ConversationPanel.tsx — Painel da conversa.
//
// Composição:
//   - useMessages(conversationId): histórico infinito (cursor backwards)
//   - useConversationSocket: realtime (message:new / conversation:updated)
//   - Scroll container com Intersection Observer (load-more ao topo)
//   - Auto-scroll para o bottom em novas mensagens
//   - MessageBubble: polimórfico por tipo
//   - MessageComposer: input + janela 24h
//
// Loading state: skeleton de bolhas (nunca spinner sozinho).
// Empty state: CTA de início de conversa.
// Error state: mensagem clara + retry.
//
// LGPD (doc 17):
//   - Não loga conteúdo de mensagens
//   - Skeleton não exibe dados reais
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';
import { useConversationSocket } from '../hooks/useConversationSocket';
import { useConversation, useMessages } from '../queries';
import type { ChannelProvider, Message } from '../types';

import { MessageBubble } from './MessageBubble';
import { isDifferentDay, formatDaySeparator } from './MessageBubble/utils';
import { MessageComposer } from './MessageComposer';

// ─── ConversationHeader ───────────────────────────────────────────────────────

function ProviderBadge({ provider }: { provider: ChannelProvider }): React.JSX.Element {
  const color =
    provider === 'meta_whatsapp'
      ? '#25d366'
      : provider === 'meta_instagram'
        ? '#e1306c'
        : 'var(--brand-azul)';

  const label =
    provider === 'meta_whatsapp'
      ? 'WhatsApp'
      : provider === 'meta_instagram'
        ? 'Instagram'
        : 'Chat';

  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill font-sans font-medium"
      style={{
        padding: '2px 8px',
        fontSize: 11,
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

interface ConversationHeaderProps {
  conversationId: string;
}

function ConversationHeader({ conversationId }: ConversationHeaderProps): React.JSX.Element {
  const { data } = useConversation(conversationId);

  const contactName = data?.data.contactName ?? data?.data.contactRemoteId ?? '…';
  const provider = data?.composerState.provider;
  const initial = contactName.charAt(0).toUpperCase();

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-elev-1)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {/* Avatar */}
      <span
        className="flex-shrink-0 inline-flex items-center justify-center rounded-full font-sans font-bold select-none"
        style={{
          width: 36,
          height: 36,
          background: 'var(--grad-azul)',
          color: 'var(--brand-branco)',
          fontSize: 'var(--text-sm)',
          boxShadow: 'var(--elev-2)',
        }}
        aria-hidden="true"
      >
        {initial}
      </span>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span
          className="font-sans font-semibold truncate"
          style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', letterSpacing: '-0.01em' }}
        >
          {contactName}
        </span>
        {provider !== undefined && <ProviderBadge provider={provider} />}
      </div>
    </div>
  );
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

type ListItem = { kind: 'message'; message: Message } | { kind: 'day-separator'; date: string };

// ─── Skeleton de carregamento ─────────────────────────────────────────────────

function MessageSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 animate-pulse">
      {/* Inbound */}
      <div className="flex gap-2 items-end">
        <div className="w-7 h-7 rounded-pill bg-surface-muted shrink-0" />
        <div className="flex flex-col gap-1 max-w-[60%]">
          <div className="h-10 rounded-md bg-surface-muted w-48" />
          <div className="h-3 rounded bg-surface-muted w-16" />
        </div>
      </div>
      {/* Outbound */}
      <div className="flex justify-end gap-2 items-end">
        <div className="flex flex-col gap-1 items-end max-w-[60%]">
          <div className="h-8 rounded-md bg-surface-muted w-40" />
          <div className="h-3 rounded bg-surface-muted w-12" />
        </div>
      </div>
      {/* Inbound longa */}
      <div className="flex gap-2 items-end">
        <div className="w-7 h-7 rounded-pill bg-surface-muted shrink-0" />
        <div className="flex flex-col gap-1 max-w-[70%]">
          <div className="h-16 rounded-md bg-surface-muted w-56" />
          <div className="h-3 rounded bg-surface-muted w-16" />
        </div>
      </div>
      {/* Outbound */}
      <div className="flex justify-end">
        <div className="flex flex-col gap-1 items-end max-w-[50%]">
          <div className="h-6 rounded-md bg-surface-muted w-32" />
          <div className="h-3 rounded bg-surface-muted w-10" />
        </div>
      </div>
      {/* Inbound */}
      <div className="flex gap-2 items-end">
        <div className="w-7 h-7 rounded-pill bg-surface-muted shrink-0" />
        <div className="flex flex-col gap-1">
          <div className="h-8 rounded-md bg-surface-muted w-36" />
          <div className="h-3 rounded bg-surface-muted w-14" />
        </div>
      </div>
    </div>
  );
}

// ─── DaySeparator ─────────────────────────────────────────────────────────────

function DaySeparator({ date }: { date: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3 py-2 px-4">
      <div className="h-px flex-1 bg-border-subtle" />
      <span className="font-sans text-xs text-ink-3 px-2 py-0.5 rounded-pill bg-surface-2 border border-border-subtle whitespace-nowrap">
        {date}
      </span>
      <div className="h-px flex-1 bg-border-subtle" />
    </div>
  );
}

// ─── LoadMoreTrigger ──────────────────────────────────────────────────────────

interface LoadMoreTriggerProps {
  onIntersect: () => void;
  hasMore: boolean;
  isFetching: boolean;
}

/**
 * Sentinela invisível no topo da lista.
 * Quando fica visível (usuário rolou até o topo), dispara `onIntersect`.
 */
function LoadMoreTrigger({
  onIntersect,
  hasMore,
  isFetching,
}: LoadMoreTriggerProps): React.JSX.Element | null {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!hasMore || isFetching) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          onIntersect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isFetching, onIntersect]);

  if (!hasMore) return null;

  return (
    <div ref={ref} className="flex justify-center py-3">
      {isFetching ? (
        <div className="flex items-center gap-2 text-ink-3 text-xs font-sans">
          <svg
            className="w-3.5 h-3.5 animate-spin"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="8" cy="8" r="5" strokeOpacity="0.25" />
            <path d="M8 3a5 5 0 015 5" strokeLinecap="round" />
          </svg>
          Carregando mensagens anteriores...
        </div>
      ) : (
        <button
          type="button"
          onClick={onIntersect}
          className="font-sans text-xs text-azul hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-azul/30 rounded-xs px-2 py-1 transition-colors"
        >
          Carregar mensagens anteriores
        </button>
      )}
    </div>
  );
}

// ─── MessageList ──────────────────────────────────────────────────────────────

interface MessageListProps {
  items: ListItem[];
  onLoadMore: () => void;
  hasMore: boolean;
  isFetchingMore: boolean;
  /** Total de mensagens antes da última atualização — para auto-scroll */
  prevCount: number;
}

function MessageList({
  items,
  onLoadMore,
  hasMore,
  isFetchingMore,
  prevCount,
}: MessageListProps): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const isInitialMount = React.useRef(true);

  // Scroll inicial para o bottom
  React.useEffect(() => {
    if (isInitialMount.current && items.length > 0) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
      isInitialMount.current = false;
    }
  }, [items.length]);

  // Auto-scroll para o bottom quando novas mensagens são adicionadas ao final
  React.useEffect(() => {
    if (isInitialMount.current) return;

    const container = scrollRef.current;
    if (!container) return;

    const messageCount = items.filter((i) => i.kind === 'message').length;

    if (messageCount > prevCount) {
      // Só auto-scroll se o usuário está perto do bottom (últimos 200px)
      const distanceFromBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceFromBottom < 200) {
        bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
      }
    }
  });

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto overscroll-contain"
      // Scroll behavior padrão — smooth apenas no auto-scroll manual
    >
      {/* Sentinela de load-more (topo) */}
      <LoadMoreTrigger onIntersect={onLoadMore} hasMore={hasMore} isFetching={isFetchingMore} />

      {/* Lista de itens */}
      <div className="flex flex-col py-2">
        {items.map((item, i) => {
          if (item.kind === 'day-separator') {
            return <DaySeparator key={`sep-${item.date}-${i}`} date={item.date} />;
          }
          return <MessageBubble key={item.message.id} message={item.message} />;
        })}
      </div>

      {/* Âncora do bottom para scroll */}
      <div ref={bottomRef} aria-hidden="true" className="h-px" />
    </div>
  );
}

// ─── ConversationPanel ────────────────────────────────────────────────────────

interface ConversationPanelProps {
  conversationId: string;
  /** Callback para CTA de "usar template" no WindowNotice */
  onUseTemplate?: () => void;
}

/**
 * ConversationPanel — painel completo da conversa.
 *
 * Integra lista de mensagens com paginação regressiva + realtime + compositor.
 */
export function ConversationPanel({
  conversationId,
  onUseTemplate,
}: ConversationPanelProps): React.JSX.Element {
  // ── Dados ──────────────────────────────────────────────────────────────────
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    useMessages(conversationId);

  // ── Realtime ───────────────────────────────────────────────────────────────
  useConversationSocket({ conversationId });

  // ── Flatten mensagens (infinite query = páginas) ───────────────────────────
  // pages[0] = mais recente (primeira fetch), pages[N] = mais antigas.
  // Queremos exibição cronológica (top=antigo, bottom=recente):
  // → invertemos a ordem das páginas e dentro de cada página também.
  const allMessages = React.useMemo<Message[]>(() => {
    if (!data) return [];
    return [...data.pages].reverse().flatMap((page) => [...page.data].reverse());
  }, [data]);

  const prevMessageCountRef = React.useRef(0);
  const prevCount = prevMessageCountRef.current;
  React.useEffect(() => {
    prevMessageCountRef.current = allMessages.length;
  });

  // ── Inserir separadores de dia ─────────────────────────────────────────────
  const listItems = React.useMemo<ListItem[]>(() => {
    const items: ListItem[] = [];
    for (let i = 0; i < allMessages.length; i++) {
      const msg = allMessages[i];
      if (!msg) continue;
      const prev = allMessages[i - 1];
      const dayChanged = prev ? isDifferentDay(prev.createdAt, msg.createdAt) : true;
      if (dayChanged) {
        items.push({ kind: 'day-separator', date: formatDaySeparator(msg.createdAt) });
      }
      items.push({ kind: 'message', message: msg });
    }
    return items;
  }, [allMessages]);

  const handleLoadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-surface-1">
        <ConversationHeader conversationId={conversationId} />
        <div className="flex-1 overflow-hidden">
          <MessageSkeleton />
        </div>
        <div className="border-t border-border bg-surface-1 h-14 animate-pulse" />
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="flex flex-col h-full bg-surface-1">
        <ConversationHeader conversationId={conversationId} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
          <div
            className="w-10 h-10 rounded-md flex items-center justify-center"
            style={{ background: 'var(--danger-bg)', boxShadow: 'var(--elev-1)' }}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-5 h-5 text-danger"
            >
              <circle cx="10" cy="10" r="8" />
              <path d="M10 7v4M10 13v.5" strokeLinecap="round" strokeWidth={2} />
            </svg>
          </div>
          <div className="text-center">
            <p className="font-sans font-semibold text-ink text-sm">Erro ao carregar mensagens</p>
            <p className="font-sans text-xs text-ink-3 mt-1">
              Verifique sua conexão e tente novamente.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className={cn(
              'font-sans text-sm font-semibold px-4 py-2 rounded-sm',
              '[background:var(--grad-azul)] text-white',
              '[box-shadow:var(--elev-2)]',
              'hover:-translate-y-0.5 hover:[box-shadow:var(--glow-azul)]',
              'active:translate-y-0',
              'transition-[transform,box-shadow] duration-fast ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            )}
          >
            Tentar novamente
          </button>
        </div>
        <MessageComposer
          conversationId={conversationId}
          {...(onUseTemplate !== undefined ? { onUseTemplate } : {})}
        />
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (allMessages.length === 0) {
    return (
      <div className="flex flex-col h-full bg-surface-1">
        <ConversationHeader conversationId={conversationId} />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6">
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--info-bg)', boxShadow: 'var(--elev-2)' }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-6 h-6 text-azul"
            >
              <path
                d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="text-center">
            <p className="font-display font-semibold text-ink">Nenhuma mensagem ainda</p>
            <p className="font-sans text-xs text-ink-3 mt-1">
              Use o compositor abaixo para iniciar a conversa.
            </p>
          </div>
        </div>
        <MessageComposer
          conversationId={conversationId}
          {...(onUseTemplate !== undefined ? { onUseTemplate } : {})}
        />
      </div>
    );
  }

  // ── Estado principal ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-surface-1">
      <ConversationHeader conversationId={conversationId} />
      <MessageList
        items={listItems}
        onLoadMore={handleLoadMore}
        hasMore={Boolean(hasNextPage)}
        isFetchingMore={isFetchingNextPage}
        prevCount={prevCount}
      />
      <MessageComposer
        conversationId={conversationId}
        {...(onUseTemplate !== undefined ? { onUseTemplate } : {})}
      />
    </div>
  );
}
