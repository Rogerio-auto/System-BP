// =============================================================================
// features/assistant/components/AssistantHistorySidebarItem.tsx — Uma linha
// de conversa na barra lateral de histórico do copiloto interno (F6-S29).
//
// Hover: Lift (DS §8) — mesmo padrão de ChatListItem.tsx (inbox), para
// consistência entre as listas do produto. Selecionada: tint azul + borda
// esquerda. Ações (renomear/excluir) aparecem no hover/focus da linha —
// nunca escondidas atrás de um menu extra para uma lista curta como esta.
// =============================================================================

import * as React from 'react';

import type { AssistantConversationSummary } from '../../../hooks/assistant/useAssistantConversations';
import { cn } from '../../../lib/cn';
import { formatConversationDate } from '../historyFormat';

interface AssistantHistorySidebarItemProps {
  conversation: AssistantConversationSummary;
  selected: boolean;
  onSelect: (id: string) => void;
  onRename: (conversation: AssistantConversationSummary) => void;
  onDelete: (conversation: AssistantConversationSummary) => void;
}

function PencilIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <path d="M11 2l3 3-7.5 7.5H3v-3.5L11 2z" />
    </svg>
  );
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <path d="M3 4.5h10M6 4.5V3a1 1 0 011-1h2a1 1 0 011 1v1.5M12.5 4.5l-.6 8.4a1.5 1.5 0 01-1.5 1.4H5.6a1.5 1.5 0 01-1.5-1.4l-.6-8.4" />
    </svg>
  );
}

export function AssistantHistorySidebarItem({
  conversation,
  selected,
  onSelect,
  onRename,
  onDelete,
}: AssistantHistorySidebarItemProps): React.JSX.Element {
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(conversation.id);
      }
    },
    [conversation.id, onSelect],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Conversa: ${conversation.title}`}
      onClick={() => onSelect(conversation.id)}
      onKeyDown={handleKeyDown}
      className={cn(
        'group flex items-center gap-2 px-3 py-2.5 rounded-sm cursor-pointer outline-none',
        'transition-all duration-fast ease-out',
        'focus-visible:ring-2 focus-visible:ring-azul/30',
      )}
      style={{
        background: selected
          ? 'color-mix(in srgb, var(--brand-azul) 10%, var(--bg-elev-1))'
          : 'transparent',
        borderLeft: selected ? '2px solid var(--brand-azul)' : '2px solid transparent',
      }}
      onMouseEnter={(e) => {
        if (!selected)
          (e.currentTarget as HTMLDivElement).style.background = 'var(--surface-hover)';
      }}
      onMouseLeave={(e) => {
        if (!selected) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      <div className="flex-1 min-w-0">
        <p
          className="font-sans font-medium truncate"
          style={{
            fontSize: 'var(--text-sm)',
            color: selected ? 'var(--brand-azul)' : 'var(--text)',
            letterSpacing: '-0.01em',
          }}
        >
          {conversation.title}
        </p>
        <p
          className="font-sans truncate"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}
        >
          {formatConversationDate(conversation.updated_at)}
        </p>
      </div>

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-fast">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename(conversation);
          }}
          aria-label={`Renomear conversa "${conversation.title}"`}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded-sm shrink-0',
            'text-ink-3 hover:text-ink hover:bg-surface-muted',
            'transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
          )}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(conversation);
          }}
          aria-label={`Excluir conversa "${conversation.title}"`}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded-sm shrink-0',
            'text-ink-3 hover:text-danger hover:bg-danger-bg',
            'transition-colors duration-fast',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
          )}
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}
