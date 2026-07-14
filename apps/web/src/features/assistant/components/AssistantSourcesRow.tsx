// =============================================================================
// features/assistant/components/AssistantSourcesRow.tsx — Fontes consultadas
// pelo copiloto interno (F6-S12). Extraído de AssistantTurnItem em F6-S22
// para ser reutilizado tanto na resposta estruturada (narrative + blocks)
// quanto no fallback legado (answer).
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';

interface AssistantSourcesRowProps {
  sources: string[];
}

export function AssistantSourcesRow({
  sources,
}: AssistantSourcesRowProps): React.JSX.Element | null {
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 max-w-[85%]">
      <span className="font-sans text-xs text-ink-4 mr-0.5">Fontes:</span>
      {sources.map((source, i) => (
        <Badge key={`${source}-${i}`} variant="info">
          {source}
        </Badge>
      ))}
    </div>
  );
}
