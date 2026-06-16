// =============================================================================
// ChatList/ChatListItem.tsx — Item de conversa no inbox (F16-S16).
//
// Exibe avatar, nome do contato, preview da última mensagem, timestamp e
// badge de não-lidas. Hover: Lift pattern (DS §8).
//
// Acessibilidade: role="button", tabIndex, onKeyDown (Enter/Space).
//
// LGPD (doc 17 §8.1): contactName e contactRemoteId não são logados.
// =============================================================================

import * as React from 'react';

import type { Conversation } from '../../types';

// ---------------------------------------------------------------------------
// Utilitários de tempo
// ---------------------------------------------------------------------------

/**
 * Formata timestamp para exibição compacta.
 * Se hoje → "HH:MM", senão → "DD/MM".
 */
function formatTimestamp(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

// ---------------------------------------------------------------------------
// Avatar com inicial
// ---------------------------------------------------------------------------

interface AvatarInitialProps {
  readonly name: string | null;
}

function AvatarInitial({ name }: AvatarInitialProps): React.JSX.Element {
  const initial = name ? name.trim().charAt(0).toUpperCase() : '?';

  return (
    <span
      aria-hidden="true"
      className="flex-shrink-0 inline-flex items-center justify-center rounded-full font-sans font-bold select-none"
      style={{
        width: 40,
        height: 40,
        minWidth: 40,
        background: 'var(--grad-azul)',
        color: 'var(--brand-branco)',
        fontSize: 'var(--text-base)',
        letterSpacing: '-0.01em',
        boxShadow: 'var(--elev-2)',
      }}
    >
      {initial}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badge de não-lidas
// ---------------------------------------------------------------------------

interface UnreadBadgeProps {
  readonly count: number;
}

function UnreadBadge({ count }: UnreadBadgeProps): React.JSX.Element | null {
  if (count <= 0) return null;

  return (
    <span
      aria-label={`${count} mensagem${count !== 1 ? 's' : ''} não lida${count !== 1 ? 's' : ''}`}
      className="flex-shrink-0 inline-flex items-center justify-center rounded-pill font-mono font-semibold"
      style={{
        minWidth: 20,
        height: 20,
        paddingLeft: count > 9 ? '6px' : undefined,
        paddingRight: count > 9 ? '6px' : undefined,
        fontSize: 11,
        background: 'var(--success)',
        color: 'var(--brand-branco)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props do item
// ---------------------------------------------------------------------------

export interface ChatListItemProps {
  readonly conversation: Conversation;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

// ---------------------------------------------------------------------------
// ChatListItem
// ---------------------------------------------------------------------------

/**
 * Item de conversa no inbox.
 *
 * Hover: Lift (translateY -2px + elev-3). Selecionado: tint azul.
 * Totalmente acessível por teclado (role button, Enter/Space).
 */
export function ChatListItem({
  conversation,
  selected,
  onSelect,
}: ChatListItemProps): React.JSX.Element {
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(conversation.id);
      }
    },
    [conversation.id, onSelect],
  );

  const timestamp = formatTimestamp(conversation.lastMessageAt ?? conversation.createdAt);

  // Preview: placeholder enquanto S17 não adiciona lastMessagePreview ao DTO
  const preview = ''; // campo não existe ainda no DTO — S17 vai adicionar

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Conversa com ${conversation.contactName ?? 'contato desconhecido'}`}
      onClick={() => onSelect(conversation.id)}
      onKeyDown={handleKeyDown}
      className="flex items-center gap-3 px-4 py-3 cursor-pointer outline-none transition-all duration-fast ease-out"
      style={{
        background: selected
          ? 'color-mix(in srgb, var(--brand-azul) 10%, var(--bg-elev-1))'
          : 'transparent',
        borderLeft: selected ? '2px solid var(--brand-azul)' : '2px solid transparent',
        boxShadow: selected ? 'var(--elev-1)' : 'none',
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)';
          (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)';
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--elev-2)';
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          (e.currentTarget as HTMLDivElement).style.background = 'transparent';
          (e.currentTarget as HTMLDivElement).style.transform = '';
          (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        }
      }}
      onFocus={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 0 0 2px rgba(27, 58, 140, 0.3)';
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = selected ? 'var(--elev-1)' : 'none';
      }}
    >
      {/* Avatar */}
      <AvatarInitial name={conversation.contactName} />

      {/* Conteúdo */}
      <div className="flex-1 min-w-0 flex flex-col gap-[2px]">
        {/* Linha 1: nome + timestamp */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="font-sans font-semibold truncate"
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text)',
              letterSpacing: '-0.01em',
            }}
          >
            {conversation.contactName ?? 'Contato desconhecido'}
          </span>
          <span
            className="font-sans flex-shrink-0"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}
          >
            {timestamp}
          </span>
        </div>

        {/* Linha 2: preview da mensagem + badge */}
        <div className="flex items-center justify-between gap-2">
          <span
            className="font-sans truncate"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text-3)',
              lineHeight: '1.4',
            }}
          >
            {preview || ' '}
          </span>
          <UnreadBadge count={conversation.unreadCount} />
        </div>
      </div>
    </div>
  );
}
