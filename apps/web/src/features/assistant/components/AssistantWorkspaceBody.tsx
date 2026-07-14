// =============================================================================
// features/assistant/components/AssistantWorkspaceBody.tsx — Área rolável do
// workspace do copiloto interno: decide entre skeleton de abertura de
// conversa (F6-S28), estado "conversa indisponível" (F6-S28), estado vazio
// (F6-S12) ou a lista de turnos (F6-S09/S22). Extraído de
// AssistantWorkspaceModal para manter o componente principal abaixo de 200
// linhas.
// =============================================================================

import * as React from 'react';

import type { AssistantTurn } from '../types';

import { AssistantConversationLoadingState } from './AssistantConversationLoadingState';
import { AssistantConversationUnavailableState } from './AssistantConversationUnavailableState';
import { AssistantTurnItem } from './AssistantTurnItem';
import { AssistantWorkspaceEmptyState } from './AssistantWorkspaceEmptyState';

interface AssistantWorkspaceBodyProps {
  scrollRef: React.RefObject<HTMLDivElement>;
  isOpeningConversation: boolean;
  isConversationUnavailable: boolean;
  turns: AssistantTurn[];
  hasPermission: (permission: string) => boolean;
  onSelectChip: (question: string) => void;
  onRetry: (turn: AssistantTurn) => void;
  onClose: () => void;
  disabled: boolean;
}

export function AssistantWorkspaceBody({
  scrollRef,
  isOpeningConversation,
  isConversationUnavailable,
  turns,
  hasPermission,
  onSelectChip,
  onRetry,
  onClose,
  disabled,
}: AssistantWorkspaceBodyProps): React.JSX.Element {
  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
      {isOpeningConversation ? (
        <AssistantConversationLoadingState />
      ) : isConversationUnavailable ? (
        <AssistantConversationUnavailableState onClose={onClose} />
      ) : turns.length === 0 ? (
        <AssistantWorkspaceEmptyState
          hasPermission={hasPermission}
          onSelectChip={onSelectChip}
          disabled={disabled}
        />
      ) : (
        <div className="flex flex-col gap-4 max-w-[860px] mx-auto">
          {turns.map((turn) => (
            <AssistantTurnItem key={turn.id} turn={turn} onRetry={onRetry} />
          ))}
        </div>
      )}
    </div>
  );
}
