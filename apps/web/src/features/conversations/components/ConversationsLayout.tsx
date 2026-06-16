// =============================================================================
// ConversationsLayout.tsx — Shell de 3 colunas do inbox live chat (F16-S16).
//
// Estrutura:
//   Col 1 (280px, fixa): ChatList — lista de conversas
//   Col 2 (flex-1):      Painel da conversa (placeholder — S17 implementa)
//   Col 3 (240px, collapsible): Dados do contato (placeholder — S17+)
//
// Responsivo:
//   - < 768px (mobile): exibe lista OU detalhe, nunca ambos.
//   - >= 768px: layout 3 colunas completo.
//
// DS: light-first, tokens sem hex hardcoded, separadores var(--border-subtle).
//
// O SocketProvider é montado no ConversasPage (acima desta árvore).
// =============================================================================

import * as React from 'react';

import { ChatList } from './ChatList';

// ---------------------------------------------------------------------------
// Placeholder da coluna de conversa (S17 vai substituir)
// ---------------------------------------------------------------------------

function ConversationPlaceholder(): React.JSX.Element {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center gap-3"
      style={{ background: 'var(--bg)', color: 'var(--text-3)' }}
    >
      {/* Ícone decorativo */}
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
// Placeholder da coluna de contato (S17+ vai substituir)
// ---------------------------------------------------------------------------

function ContactPanelPlaceholder(): React.JSX.Element {
  return (
    <div className="h-full flex flex-col gap-4 p-4" style={{ background: 'var(--bg-elev-1)' }}>
      <p
        className="font-sans font-semibold"
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--text-3)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        Contato
      </p>
      {/* Skeletons de dados do contato */}
      <div className="flex flex-col gap-3">
        <div className="h-3 rounded" style={{ background: 'var(--surface-muted)', width: '60%' }} />
        <div className="h-3 rounded" style={{ background: 'var(--surface-muted)', width: '80%' }} />
        <div className="h-3 rounded" style={{ background: 'var(--surface-muted)', width: '50%' }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * ConversationsLayout — shell de 3 colunas do inbox.
 *
 * Gerencia o estado de qual conversa está selecionada (selectedId).
 * Em mobile exibe lista ou detalhe conforme selectedId.
 */
export function ConversationsLayout(): React.JSX.Element {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  // Em mobile, se há conversa selecionada, mostra somente o detalhe
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const showList = !isMobile || selectedId === null;
  const showDetail = !isMobile || selectedId !== null;

  return (
    <div className="flex h-full overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* ── Coluna 1: ChatList ─────────────────────────────────────────── */}
      {showList && (
        <aside
          className="flex flex-col h-full overflow-hidden flex-shrink-0"
          style={{
            width: isMobile ? '100%' : '280px',
            minWidth: isMobile ? undefined : '280px',
            borderRight: isMobile ? 'none' : '1px solid var(--border-subtle)',
            boxShadow: 'var(--elev-1)',
            background: 'var(--bg-elev-1)',
          }}
          aria-label="Lista de conversas"
        >
          <ChatList
            selectedConversationId={selectedId}
            onSelectConversation={(id) => setSelectedId(id)}
          />
        </aside>
      )}

      {/* ── Coluna 2: Conversa ────────────────────────────────────────── */}
      {showDetail && (
        <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden" aria-label="Conversa">
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

          {selectedId ? <ConversationPlaceholder /> : <ConversationPlaceholder />}
        </main>
      )}

      {/* ── Coluna 3: Contato (collapsible, desktop-only) ─────────────── */}
      {!isMobile && selectedId !== null && (
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
          <ContactPanelPlaceholder />
        </aside>
      )}
    </div>
  );
}
