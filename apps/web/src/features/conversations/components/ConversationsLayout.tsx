// =============================================================================
// ConversationsLayout.tsx — Shell do inbox live chat (F16-S16, redesign F24).
//
// Estrutura após redesign do filtro de status (F24):
//   Col 1 (~60-188px): StatusSideMenu — menu vertical colapsável de status
//   Col 2 (280px, fixa): ChatList — lista de conversas
//   Col 3 (flex-1):      Painel da conversa
//   Col 4 (240px, collapsible): Dados do contato
//
// Responsivo:
//   - < 768px (mobile): StatusSideMenu forçado colapsado (60px ícones),
//     ChatList ocupa o restante. Ao selecionar conversa, exibe só o detalhe.
//   - >= 768px: layout completo.
//
// Estado hoistado aqui:
//   - selectedId (conversa selecionada)
//   - statusFilter (StatusSideMenu ↔ ChatList)
//   - useConversationCounts() — passado para StatusSideMenu
//
// DS: light-first, tokens sem hex hardcoded.
// =============================================================================

import * as React from 'react';

import { useConversationCounts } from '../queries';

import { ChatList } from './ChatList';
import type { StatusFilter } from './ChatList/ChatListFilters';
import { ContactPanel } from './ContactPanel';
import { ConversationPanel } from './ConversationPanel';
import { StatusSideMenu } from './StatusSideMenu';

// ---------------------------------------------------------------------------
// Placeholder da coluna de conversa
// ---------------------------------------------------------------------------

function ConversationPlaceholder(): React.JSX.Element {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-3"
      style={{ background: 'var(--bg)', color: 'var(--text-3)' }}
    >
      <span
        className="inline-flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
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
          className="w-7 h-7"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </span>
      <p className="font-sans" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-3)' }}>
        Selecione uma conversa
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle button do ContactPanel
// ---------------------------------------------------------------------------

interface ContactToggleButtonProps {
  isOpen: boolean;
  onClick: () => void;
}

function ContactToggleButton({ isOpen, onClick }: ContactToggleButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isOpen ? 'Fechar painel de contato' : 'Abrir painel de contato'}
      aria-expanded={isOpen}
      style={{
        position: 'absolute',
        top: 'var(--space-3)',
        right: 'var(--space-3)',
        zIndex: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        borderRadius: 'var(--radius-sm)',
        border: isOpen ? '1px solid var(--brand-azul)' : '1px solid var(--border-subtle)',
        background: isOpen
          ? 'color-mix(in srgb, var(--brand-azul) 10%, var(--bg-elev-1))'
          : 'var(--bg-elev-1)',
        color: isOpen ? 'var(--brand-azul)' : 'var(--text-3)',
        boxShadow: 'var(--elev-1)',
        cursor: 'pointer',
        transition: 'background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)',
      }}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: 14, height: 14 }}
        aria-hidden="true"
      >
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 7v4" />
        <circle cx="8" cy="5" r=".5" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * ConversationsLayout — shell do inbox com menu lateral de status.
 *
 * Gerencia: selectedId, statusFilter, contactOpen.
 * Delega: contagens ao StatusSideMenu, lista filtrada ao ChatList.
 */
export function ConversationsLayout(): React.JSX.Element {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [isMobile, setIsMobile] = React.useState(false);
  const [isLarge, setIsLarge] = React.useState(false);
  const [contactOpen, setContactOpen] = React.useState(true);

  // Estado de filtro hoistado — compartilhado entre StatusSideMenu e ChatList
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('open');

  // Contagens hoistadas — passadas ao StatusSideMenu
  const { data: countsData, isLoading: countsLoading } = useConversationCounts();

  React.useEffect(() => {
    const mqMobile = window.matchMedia('(max-width: 767px)');
    const mqLarge = window.matchMedia('(min-width: 1024px)');
    setIsMobile(mqMobile.matches);
    setIsLarge(mqLarge.matches);
    setContactOpen(mqLarge.matches);
    const onMobile = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    const onLarge = (e: MediaQueryListEvent) => {
      setIsLarge(e.matches);
      setContactOpen(e.matches);
    };
    mqMobile.addEventListener('change', onMobile);
    mqLarge.addEventListener('change', onLarge);
    return () => {
      mqMobile.removeEventListener('change', onMobile);
      mqLarge.removeEventListener('change', onLarge);
    };
  }, []);

  const showList = !isMobile || selectedId === null;
  const showDetail = !isMobile || selectedId !== null;
  const showContactInline = !isMobile && selectedId !== null && contactOpen && isLarge;
  const showContactOverlay = !isMobile && selectedId !== null && contactOpen && !isLarge;

  return (
    <div
      className="flex h-full overflow-hidden"
      style={{ background: 'var(--bg)', position: 'relative' }}
    >
      {/* ── Col 1: StatusSideMenu ────────────────────────────────────────── */}
      {showList && (
        <StatusSideMenu
          value={statusFilter}
          onChange={setStatusFilter}
          counts={countsData}
          countsLoading={countsLoading}
          forceCollapsed={isMobile}
        />
      )}

      {/* ── Col 2: ChatList ──────────────────────────────────────────────── */}
      {showList && (
        <aside
          className="flex flex-col h-full overflow-hidden flex-shrink-0"
          style={{
            width: isMobile ? undefined : '280px',
            minWidth: isMobile ? undefined : '280px',
            flex: isMobile ? '1 1 0' : undefined,
            borderRight: '1px solid var(--border-subtle)',
            boxShadow: 'var(--elev-1)',
            background: 'var(--bg-elev-1)',
          }}
          aria-label="Lista de conversas"
        >
          <ChatList
            key={statusFilter}
            selectedConversationId={selectedId}
            onSelectConversation={(id) => setSelectedId(id)}
            statusFilter={statusFilter}
          />
        </aside>
      )}

      {/* ── Col 3: Conversa ──────────────────────────────────────────────── */}
      {showDetail && (
        <main
          className="flex-1 flex flex-col h-full overflow-hidden"
          style={{ position: 'relative', minWidth: isMobile ? undefined : 320 }}
          aria-label="Conversa"
        >
          {/* Botão voltar em mobile */}
          {isMobile && selectedId !== null && (
            <div
              className="flex items-center px-4 py-3"
              style={{
                borderBottom: '1px solid var(--border-subtle)',
                background: 'var(--bg-elev-1)',
                boxShadow: 'var(--elev-1)',
              }}
            >
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="flex items-center gap-2 font-sans font-medium transition-opacity duration-fast hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-azul rounded-xs"
                style={{ fontSize: 'var(--text-sm)', color: 'var(--brand-azul)' }}
                aria-label="Voltar para a lista"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4"
                  aria-hidden="true"
                >
                  <path d="M10 13L5 8l5-5" />
                </svg>
                Voltar
              </button>
            </div>
          )}

          {!isMobile && selectedId !== null && (
            <ContactToggleButton
              isOpen={contactOpen}
              onClick={() => setContactOpen((prev) => !prev)}
            />
          )}

          {selectedId !== null ? (
            <ConversationPanel conversationId={selectedId} />
          ) : (
            <ConversationPlaceholder />
          )}
        </main>
      )}

      {/* Col 4: Contato inline (>= 1024px) */}
      {showContactInline && (
        <aside
          className="flex-shrink-0 h-full overflow-y-auto"
          style={{
            width: '240px',
            minWidth: '240px',
            borderLeft: '1px solid var(--border-subtle)',
            background: 'var(--bg-elev-1)',
          }}
          aria-label="Dados do contato"
        >
          <ContactPanel conversationId={selectedId!} />
        </aside>
      )}

      {/* Col 4: Contato overlay (768-1023px) */}
      {showContactOverlay && (
        <>
          <div
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.18)' }}
            onClick={() => setContactOpen(false)}
          />
          <aside
            className="flex-shrink-0 h-full overflow-y-auto"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              zIndex: 21,
              width: '260px',
              borderLeft: '1px solid var(--border-subtle)',
              background: 'var(--bg-elev-1)',
              boxShadow: 'var(--elev-4)',
            }}
            aria-label="Dados do contato"
          >
            <ContactPanel conversationId={selectedId!} />
          </aside>
        </>
      )}
    </div>
  );
}
