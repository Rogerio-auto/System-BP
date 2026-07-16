// =============================================================================
// features/assistant/components/AssistantWorkspaceModal.tsx — Workspace
// fullscreen do copiloto interno (F6-S12).
//
// Substitui o drawer lateral de F6-S09 por um modal flutuante fullscreen
// (~93-95% da viewport), chat-centric: backdrop escurecido, fecha em Esc /
// clique fora / botão X. Renderizado via portal (document.body) para não
// herdar containing block de ancestral com transform/filter na Topbar.
//
// Barra lateral de histórico (F6-S29, último slot da Fase 2): duas colunas —
// AssistantHistorySidebar (lista/nova/renomear/excluir conversas salvas) +
// AssistantWorkspaceChat (a conversa ativa). A seleção de conversa vive
// aqui (`selectedConversationId`) e é passada como `key` para
// AssistantWorkspaceChat — trocar de conversa precisa REMONTAR a coluna de
// chat, porque todo o estado de turnos vive em useState (nunca persistido,
// LGPD doc 17), sem lógica de "trocar conversa em andamento".
//
// Responsivo: em telas ≥ sm a barra lateral é persistente (coluna fixa); em
// telas estreitas fica atrás de um overlay, aberto pelo ícone de histórico
// no cabeçalho do chat (AssistantWorkspaceHeader).
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../lib/cn';

import { AssistantHistorySidebar } from './AssistantHistorySidebar';
import { AssistantWorkspaceChat } from './AssistantWorkspaceChat';

interface AssistantWorkspaceModalProps {
  onClose: () => void;
  hasPermission: (permission: string) => boolean;
}

export function AssistantWorkspaceModal({
  onClose,
  hasPermission,
}: AssistantWorkspaceModalProps): React.JSX.Element {
  const [selectedConversationId, setSelectedConversationId] = React.useState<string | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-4"
      style={{ background: 'rgba(10, 18, 40, 0.5)', backdropFilter: 'blur(3px)' }}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistente interno"
        className={cn(
          'relative z-50 flex',
          'w-[95vw] sm:w-[94vw] h-[94vh] sm:h-[93vh]',
          'max-w-[1760px] max-h-[1200px] min-h-[420px]',
          'rounded-lg border border-border overflow-hidden',
        )}
        style={{
          background: 'var(--bg)',
          boxShadow: 'var(--elev-5)',
          animation: 'fade-up var(--dur-slow) var(--ease-out) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <AssistantHistorySidebar
          selectedId={selectedConversationId}
          onSelect={setSelectedConversationId}
          onNewConversation={() => setSelectedConversationId(null)}
          onSelectedConversationDeleted={() => setSelectedConversationId(null)}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />

        <AssistantWorkspaceChat
          key={selectedConversationId ?? 'new'}
          conversationId={selectedConversationId}
          hasPermission={hasPermission}
          onClose={onClose}
          onOpenHistoryMobile={() => setMobileSidebarOpen(true)}
        />
      </div>
    </div>,
    document.body,
  );
}
