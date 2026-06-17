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

import type { ChannelProvider, Conversation } from '../../types';

// ---------------------------------------------------------------------------
// Ícone de provider
// ---------------------------------------------------------------------------

function ProviderIcon({ provider }: { provider: ChannelProvider }): React.JSX.Element {
  if (provider === 'meta_whatsapp') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.554 4.116 1.524 5.845L0 24l6.31-1.505A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.882a9.877 9.877 0 01-5.031-1.374l-.361-.214-3.741.982.998-3.648-.235-.374A9.861 9.861 0 012.118 12C2.118 6.533 6.533 2.118 12 2.118S21.882 6.533 21.882 12 17.467 21.882 12 21.882z" />
      </svg>
    );
  }
  if (provider === 'meta_instagram') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3 h-3" aria-hidden="true">
        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
      </svg>
    );
  }
  // waha — genérico
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="w-3 h-3"
      aria-hidden="true"
    >
      <path
        d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
      {/* Avatar + badge de canal */}
      <div className="relative flex-shrink-0">
        <AvatarInitial name={conversation.contactName} />
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full"
          style={{
            width: 16,
            height: 16,
            background:
              conversation.provider === 'meta_whatsapp'
                ? '#25d366'
                : conversation.provider === 'meta_instagram'
                  ? '#e1306c'
                  : 'var(--brand-azul)',
            color: '#fff',
            boxShadow: 'var(--elev-1)',
          }}
        >
          <ProviderIcon provider={conversation.provider} />
        </span>
      </div>

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
