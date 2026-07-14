// =============================================================================
// features/assistant/components/AssistantConversationLoadingState.tsx —
// Skeleton exibido enquanto uma conversa salva do histórico é aberta
// (F6-S28: GET /api/assistant/conversations/:id). Nunca spinner sozinho
// (DS §13) — placeholders animados no formato de bolhas de turno.
// =============================================================================

import * as React from 'react';

interface SkeletonBubbleProps {
  align: 'start' | 'end';
  width: string;
}

function SkeletonBubble({ align, width }: SkeletonBubbleProps): React.JSX.Element {
  return (
    <div className={align === 'end' ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className="rounded-md animate-pulse"
        style={{ height: 44, width, background: 'var(--surface-muted)' }}
      />
    </div>
  );
}

export function AssistantConversationLoadingState(): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-4 max-w-[860px] mx-auto w-full"
      aria-busy="true"
      aria-live="polite"
    >
      <p className="font-sans text-xs text-ink-3 text-center">Abrindo conversa…</p>
      <SkeletonBubble align="end" width="45%" />
      <SkeletonBubble align="start" width="70%" />
      <SkeletonBubble align="end" width="35%" />
      <SkeletonBubble align="start" width="60%" />
    </div>
  );
}
