// =============================================================================
// features/assistant/components/AssistantHistorySidebar.tsx — Barra lateral
// de histórico do copiloto interno (F6-S29): lista as conversas do usuário
// (GET /api/assistant/conversations, F6-S25), com nova/abrir/renomear/
// excluir. Último slot da Fase 2.
//
// Estados explícitos (DS §13): loading (skeleton), erro (mensagem + retry),
// vazio — ver AssistantHistorySidebarStates.tsx. Com a flag
// `assistant.history.enabled` desligada (estado atual em produção — gate do
// DPO), a API sempre devolve lista vazia (200, nunca erro) — o estado vazio
// aqui é discreto e não promete um histórico que ainda não existe.
//
// LGPD (doc 17): títulos já vêm higienizados do backend (derivados por
// intenção — nunca nome de titular); a lista vive só no cache do TanStack
// Query (memória), nunca em localStorage/sessionStorage.
// =============================================================================

import * as React from 'react';

import { useAssistantConversations } from '../../../hooks/assistant/useAssistantConversations';
import type { AssistantConversationSummary } from '../../../hooks/assistant/useAssistantConversations';
import { cn } from '../../../lib/cn';

import { AssistantDeleteConversationModal } from './AssistantDeleteConversationModal';
import { AssistantHistorySidebarItem } from './AssistantHistorySidebarItem';
import {
  AssistantHistorySidebarEmptyState,
  AssistantHistorySidebarErrorState,
  AssistantHistorySidebarSkeleton,
} from './AssistantHistorySidebarStates';
import { AssistantRenameConversationModal } from './AssistantRenameConversationModal';

interface AssistantHistorySidebarProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  /** A conversa aberta no workspace foi removida — o caller volta para "nova conversa". */
  onSelectedConversationDeleted: (id: string) => void;
  /** Overlay em mobile (< sm) — persistente em telas maiores. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      className="w-3.5 h-3.5"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function AssistantHistorySidebar({
  selectedId,
  onSelect,
  onNewConversation,
  onSelectedConversationDeleted,
  mobileOpen,
  onCloseMobile,
}: AssistantHistorySidebarProps): React.JSX.Element {
  const { data: conversations, isLoading, isError, refetch } = useAssistantConversations();
  const [renameTarget, setRenameTarget] = React.useState<AssistantConversationSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<AssistantConversationSummary | null>(null);

  return (
    <div
      className={cn(
        'flex-col shrink-0 border-r overflow-hidden',
        'sm:flex sm:static sm:w-[264px] sm:inset-auto sm:z-auto',
        mobileOpen ? 'flex absolute inset-0 z-20 w-full' : 'hidden',
      )}
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elev-1)' }}
    >
      {/* Cabeçalho mobile: título + fechar (persistente em sm+, sem cabeçalho próprio) */}
      <div
        className="flex items-center justify-between px-3 py-3 border-b shrink-0 sm:hidden"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <h3 className="font-sans font-semibold text-ink text-sm">Histórico</h3>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Fechar histórico"
          className="w-8 h-8 flex items-center justify-center rounded-sm text-ink-3 hover:text-ink hover:bg-surface-hover transition-colors duration-fast"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Nova conversa */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <button
          type="button"
          onClick={() => {
            onNewConversation();
            onCloseMobile();
          }}
          className={cn(
            'w-full inline-flex items-center justify-center gap-2 rounded-sm px-3 py-2',
            'font-sans font-semibold',
            'transition-all duration-fast ease-out',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
          )}
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--brand-azul)',
            background: 'color-mix(in srgb, var(--brand-azul) 10%, transparent)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              'color-mix(in srgb, var(--brand-azul) 16%, transparent)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              'color-mix(in srgb, var(--brand-azul) 10%, transparent)';
          }}
        >
          <PlusIcon />
          Nova conversa
        </button>
      </div>

      {/* Lista */}
      <div
        role="list"
        aria-label="Conversas anteriores"
        className="flex-1 overflow-y-auto px-2 pb-2"
      >
        {isLoading && <AssistantHistorySidebarSkeleton />}

        {isError && !isLoading && (
          <AssistantHistorySidebarErrorState onRetry={() => void refetch()} />
        )}

        {!isLoading && !isError && conversations.length === 0 && (
          <AssistantHistorySidebarEmptyState />
        )}

        {conversations.map((conversation) => (
          <div key={conversation.id} role="listitem">
            <AssistantHistorySidebarItem
              conversation={conversation}
              selected={selectedId === conversation.id}
              onSelect={(id) => {
                onSelect(id);
                onCloseMobile();
              }}
              onRename={setRenameTarget}
              onDelete={setDeleteTarget}
            />
          </div>
        ))}
      </div>

      {renameTarget && (
        <AssistantRenameConversationModal
          conversation={renameTarget}
          onClose={() => setRenameTarget(null)}
        />
      )}

      {deleteTarget && (
        <AssistantDeleteConversationModal
          conversation={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(id) => {
            setDeleteTarget(null);
            if (id === selectedId) onSelectedConversationDeleted(id);
          }}
        />
      )}
    </div>
  );
}
