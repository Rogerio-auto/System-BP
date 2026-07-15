// =============================================================================
// features/assistant/components/AssistantHistorySidebarStates.tsx — Estados
// de loading/erro/vazio da barra lateral de histórico (F6-S29). Extraído de
// AssistantHistorySidebar.tsx para manter o componente principal abaixo de
// 200 linhas.
// =============================================================================

import * as React from 'react';

export function AssistantHistorySidebarSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 px-3 py-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={String(i)}
          className="h-[52px] rounded-sm animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
        />
      ))}
    </div>
  );
}

interface AssistantHistorySidebarErrorStateProps {
  onRetry: () => void;
}

export function AssistantHistorySidebarErrorState({
  onRetry,
}: AssistantHistorySidebarErrorStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <p className="font-sans" style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)' }}>
        Não foi possível carregar seu histórico.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans font-medium underline transition-opacity duration-fast hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30 rounded-xs"
        style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-azul)' }}
      >
        Tentar novamente
      </button>
    </div>
  );
}

/**
 * Sem conversas ainda — inclui o caso "flag assistant.history.enabled
 * desligada" (a API sempre responde 200 com lista vazia nesse cenário,
 * nunca erro). Mensagem discreta, sem prometer um histórico que ainda não
 * existe.
 */
export function AssistantHistorySidebarEmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
      <p
        className="font-sans font-medium"
        style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)' }}
      >
        Nenhuma conversa ainda
      </p>
      <p className="font-sans" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
        Suas conversas com o assistente aparecerão aqui.
      </p>
    </div>
  );
}
