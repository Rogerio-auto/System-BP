// =============================================================================
// features/assistant/components/AssistantWorkspaceModal.tsx — Workspace
// fullscreen do copiloto interno (F6-S12).
//
// Substitui o drawer lateral de F6-S09 por um modal flutuante fullscreen
// (~85% da viewport), chat-centric: backdrop escurecido, fecha em Esc /
// clique fora / botão X. Renderizado via portal (document.body) para não
// herdar containing block de ancestral com transform/filter na Topbar.
//
// Estado inicial (sem turnos): AssistantWorkspaceEmptyState mostra chips de
// sugestão por permissão — clicar num chip envia a pergunta pronta.
//
// Histórico de turnos vive só em React state (useState) — desmonta ao
// fechar (o caller condiciona a renderização), então nunca sobrevive em
// localStorage/sessionStorage (LGPD doc 17).
//
// Memória de conversa (F6-S19): cada pergunta enviada ao backend carrega os
// turnos anteriores bem-sucedidos (buildAssistantHistory), para o copiloto
// ter continuidade — sem persistir nada além do useState acima.
//
// Abrir conversa salva do histórico (F6-S28): quando `conversationId` é
// informado, busca a conversa (narrativa + cards já hidratados ao vivo pelo
// backend, F6-S27) e semeia os turnos uma única vez
// (useAssistantWorkspaceTurns) — depois disso o usuário continua a conversa
// normalmente, com os turnos reabertos alimentando a memória de sessão.
// Trocar de conversa deve remontar este componente (prop `key` no caller) —
// o estado vive só em useState, não há lógica de "trocar conversa em
// andamento".
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { useAssistantConversation } from '../../../hooks/assistant/useAssistantConversation';
import { cn } from '../../../lib/cn';
import { useAssistantWorkspaceTurns } from '../hooks/useAssistantWorkspaceTurns';

import { AssistantComposer } from './AssistantComposer';
import { AssistantWorkspaceBody } from './AssistantWorkspaceBody';
import { AssistantWorkspaceHeader } from './AssistantWorkspaceHeader';

interface AssistantWorkspaceModalProps {
  onClose: () => void;
  hasPermission: (permission: string) => boolean;
  /** Abre a conversa salva com este id (F6-S28). `null`/omitido = conversa nova. */
  conversationId?: string | null;
}

export function AssistantWorkspaceModal({
  onClose,
  hasPermission,
  conversationId = null,
}: AssistantWorkspaceModalProps): React.JSX.Element {
  const {
    data: conversation,
    isLoading: isLoadingConversation,
    isNotFound: isConversationNotFound,
  } = useAssistantConversation(conversationId);

  const { turns, isPending, sendQuestion, retry } = useAssistantWorkspaceTurns(conversation);
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function handleSubmit(): void {
    if (!draft.trim() || isPending) return;
    sendQuestion(draft);
    setDraft('');
  }

  // Só relevantes enquanto os turnos da conversa salva ainda não chegaram —
  // depois de semeados, a conversa segue como um chat normal mesmo que a
  // query recarregue em segundo plano.
  const isOpeningConversation =
    conversationId !== null && isLoadingConversation && turns.length === 0;
  const isConversationUnavailable =
    conversationId !== null && isConversationNotFound && turns.length === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8"
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
          'relative z-50 flex flex-col',
          'w-[92vw] sm:w-[85vw] h-[88vh] sm:h-[85vh]',
          'max-w-[1200px] max-h-[880px] min-h-[420px]',
          'rounded-lg border border-border overflow-hidden',
        )}
        style={{
          background: 'var(--bg)',
          boxShadow: 'var(--elev-5)',
          animation: 'fade-up var(--dur-slow) var(--ease-out) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <AssistantWorkspaceHeader onClose={onClose} conversationTitle={conversation?.title} />

        <AssistantWorkspaceBody
          scrollRef={scrollRef}
          isOpeningConversation={isOpeningConversation}
          isConversationUnavailable={isConversationUnavailable}
          turns={turns}
          hasPermission={hasPermission}
          onSelectChip={sendQuestion}
          onRetry={retry}
          onClose={onClose}
          disabled={isPending}
        />

        <AssistantComposer
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          disabled={isPending || isConversationUnavailable}
        />
      </div>
    </div>,
    document.body,
  );
}
