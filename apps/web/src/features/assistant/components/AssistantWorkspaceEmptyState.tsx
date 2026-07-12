// =============================================================================
// features/assistant/components/AssistantWorkspaceEmptyState.tsx — Estado
// inicial (sem turnos) do workspace do copiloto interno (F6-S12): chips de
// sugestão por permissão, ou mensagem honesta quando o usuário não tem
// nenhuma das permissões elegíveis. Extraído de AssistantWorkspaceModal para
// manter o componente principal abaixo de 200 linhas.
// =============================================================================

import * as React from 'react';

import { getAvailableAssistantChips } from '../chips';

import { AssistantSuggestionChips } from './AssistantSuggestionChips';
import { SparkleIcon } from './SparkleIcon';

interface AssistantWorkspaceEmptyStateProps {
  hasPermission: (permission: string) => boolean;
  onSelectChip: (question: string) => void;
  disabled: boolean;
}

export function AssistantWorkspaceEmptyState({
  hasPermission,
  onSelectChip,
  disabled,
}: AssistantWorkspaceEmptyStateProps): React.JSX.Element {
  const chips = React.useMemo(() => getAvailableAssistantChips(hasPermission), [hasPermission]);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-5">
      <span
        className="inline-flex items-center justify-center"
        style={{
          width: 52,
          height: 52,
          borderRadius: 'var(--radius-md)',
          color: 'var(--brand-azul)',
          background: 'color-mix(in srgb, var(--brand-azul) 12%, transparent)',
          boxShadow: 'var(--elev-2)',
        }}
      >
        <SparkleIcon className="w-6 h-6" />
      </span>

      {chips.length > 0 ? (
        <>
          <h3 className="font-display font-bold text-ink text-xl tracking-tight">
            Olá! Posso te ajudar com:
          </h3>
          <AssistantSuggestionChips chips={chips} onSelect={onSelectChip} disabled={disabled} />
        </>
      ) : (
        <div className="max-w-[360px]">
          <h3 className="font-display font-bold text-ink text-xl tracking-tight">
            Olá! Sou o assistente interno
          </h3>
          <p className="mt-2 font-sans text-sm text-ink-3 leading-relaxed">
            Pergunte sobre seus dados operacionais — leads, cobranças, simulações — e receba
            respostas com as fontes consultadas, respeitando suas permissões e escopo de cidade.
          </p>
        </div>
      )}
    </div>
  );
}
