// =============================================================================
// features/assistant/components/AssistantSuggestionChips.tsx — Chips de
// sugestão do estado inicial do copiloto interno (F6-S12).
//
// Lista já filtrada por permissão (chips.ts + useAuth().hasPermission no
// caller). Clicar num chip envia a pergunta pronta diretamente — não só
// preenche o composer. Hover: Lift (DS §8) — mesmo padrão de itens de grid.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';
import type { AssistantSuggestionChip } from '../chips';

interface AssistantSuggestionChipsProps {
  chips: AssistantSuggestionChip[];
  onSelect: (question: string) => void;
  disabled?: boolean;
}

export function AssistantSuggestionChips({
  chips,
  onSelect,
  disabled = false,
}: AssistantSuggestionChipsProps): React.JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2 max-w-[600px]"
      role="group"
      aria-label="Sugestões de pergunta"
    >
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onSelect(chip.question)}
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-2 rounded-pill',
            'px-4 py-2',
            'font-sans text-sm font-medium text-ink-2',
            'border border-border-subtle bg-surface-1 shadow-e1',
            'transition-[transform,box-shadow,border-color,color] duration-fast ease-out',
            'hover:-translate-y-0.5 hover:text-ink hover:border-azul/30 hover:shadow-e3',
            'active:translate-y-0 active:shadow-e1',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            'disabled:opacity-50 disabled:pointer-events-none disabled:translate-y-0',
          )}
        >
          <span aria-hidden="true">{chip.emoji}</span>
          <span>{chip.question}</span>
        </button>
      ))}
    </div>
  );
}
