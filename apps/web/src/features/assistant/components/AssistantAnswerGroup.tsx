// =============================================================================
// features/assistant/components/AssistantAnswerGroup.tsx — Resposta de sucesso
// de um turno do copiloto interno (F6-S22): narrativa (markdown) + cards de
// dados por bloco, com fallback para o `answer` legado em texto plano.
//
// Transição do contrato (F6-S21 backend → F6-S22 frontend): a partir daqui o
// consumo é narrative + blocks diretamente. `answer` só é usado quando AMBOS
// narrative e blocks vêm vazios (ex.: erro não-fatal no agent_node do
// LangGraph que ainda retorna 200 com texto solto) — nunca em paralelo ao
// contrato estruturado.
// =============================================================================

import * as React from 'react';

import type { AssistantBlock } from '../../../hooks/assistant/useAssistantQuery';
import { AssistantBlockCard } from '../blocks/AssistantBlockCard';

import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantSourcesRow } from './AssistantSourcesRow';

interface AssistantAnswerGroupProps {
  narrative: string | undefined;
  blocks: AssistantBlock[] | undefined;
  sources: string[];
  legacyAnswer: string;
}

function NarrativeBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      className="rounded-md border px-[14px] py-3"
      style={{
        background: 'var(--bg-elev-1)',
        borderColor: 'var(--border-subtle)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <AssistantMarkdown source={text} />
    </div>
  );
}

export function AssistantAnswerGroup({
  narrative,
  blocks,
  sources,
  legacyAnswer,
}: AssistantAnswerGroupProps): React.JSX.Element {
  const hasNarrative = Boolean(narrative?.trim());
  const items = blocks ?? [];

  // Fallback: contrato estruturado veio vazio — cai no texto plano legado.
  if (!hasNarrative && items.length === 0) {
    return (
      <div className="flex flex-col gap-2 max-w-[85%]">
        <NarrativeBubble text={legacyAnswer} />
        <AssistantSourcesRow sources={sources} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 max-w-[85%] w-full">
      {hasNarrative && <NarrativeBubble text={narrative ?? ''} />}
      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          {items.map((block, i) => (
            // Blocos não têm id estável no contrato (efêmeros, F6-S21) — a posição
            // no array é o único identificador disponível dentro de um turno.
            <AssistantBlockCard key={i} block={block} />
          ))}
        </div>
      )}
      <AssistantSourcesRow sources={sources} />
    </div>
  );
}
