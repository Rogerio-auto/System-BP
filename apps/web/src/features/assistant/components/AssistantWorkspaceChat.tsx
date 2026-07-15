// =============================================================================
// features/assistant/components/AssistantWorkspaceChat.tsx — Coluna de chat
// do workspace do copiloto interno: cabeçalho + corpo rolável + composer.
// Extraído de AssistantWorkspaceModal.tsx (F6-S29, barra lateral) para
// manter o componente principal abaixo de 200 linhas e para poder ser
// remontado (`key`) a cada troca de conversa selecionada na barra lateral —
// o caller (AssistantWorkspaceModal) usa `key={conversationId ?? 'new'}`
// porque todo o estado de turnos vive em useState (nunca persistido,
// LGPD doc 17) e precisa reiniciar do zero ao trocar de conversa.
// =============================================================================

import * as React from 'react';

import { useAssistantConversation } from '../../../hooks/assistant/useAssistantConversation';
import { useAssistantWorkspaceTurns } from '../hooks/useAssistantWorkspaceTurns';

import { AssistantComposer } from './AssistantComposer';
import { AssistantWorkspaceBody } from './AssistantWorkspaceBody';
import { AssistantWorkspaceHeader } from './AssistantWorkspaceHeader';

interface AssistantWorkspaceChatProps {
  conversationId: string | null;
  hasPermission: (permission: string) => boolean;
  onClose: () => void;
  onOpenHistoryMobile: () => void;
}

export function AssistantWorkspaceChat({
  conversationId,
  hasPermission,
  onClose,
  onOpenHistoryMobile,
}: AssistantWorkspaceChatProps): React.JSX.Element {
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

  return (
    <div className="flex flex-col flex-1 min-w-0">
      <AssistantWorkspaceHeader
        onClose={onClose}
        conversationTitle={conversation?.title}
        onOpenHistoryMobile={onOpenHistoryMobile}
      />

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
  );
}
