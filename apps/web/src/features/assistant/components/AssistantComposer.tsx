// =============================================================================
// features/assistant/components/AssistantComposer.tsx — Campo de pergunta do
// chat do copiloto interno (F6-S09).
//
// Textarea com contorno + profundidade interna (DS §9.2), contador de
// caracteres (limite espelha AssistantQueryBodySchema.question no backend) e
// botão de enviar (Glow — DS §8). Enter envia; Shift+Enter quebra linha.
// =============================================================================

import * as React from 'react';

import { ASSISTANT_QUESTION_MAX_LENGTH } from '../../../hooks/assistant/useAssistantQuery';
import { cn } from '../../../lib/cn';

interface AssistantComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}

function SendIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M14 2L7.5 8.5M14 2L9.5 14l-2-5.5L2 6.5 14 2z" />
    </svg>
  );
}

export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  disabled,
}: AssistantComposerProps): React.JSX.Element {
  const trimmedLength = value.trim().length;
  const canSend = !disabled && trimmedLength > 0 && value.length <= ASSISTANT_QUESTION_MAX_LENGTH;
  const nearLimit = value.length > ASSISTANT_QUESTION_MAX_LENGTH - 200;

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSubmit();
    }
  }

  return (
    <div
      className="shrink-0 p-3 border-t"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elev-2)' }}
    >
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={ASSISTANT_QUESTION_MAX_LENGTH}
          rows={2}
          placeholder="Pergunte sobre leads, cobranças, simulações…"
          aria-label="Pergunta para o assistente interno"
          className={cn(
            'flex-1 resize-none font-sans text-sm font-medium text-ink',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'placeholder:text-ink-4',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />

        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSend}
          aria-label="Enviar pergunta"
          className={cn(
            'inline-flex items-center justify-center shrink-0',
            'w-10 h-10 rounded-sm',
            '[background:var(--grad-azul)] text-[var(--text-on-brand)]',
            '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
            'transition-[transform,box-shadow,opacity] duration-fast ease',
            'hover:-translate-y-0.5 hover:[box-shadow:var(--glow-azul),inset_0_1px_0_rgba(255,255,255,0.2)]',
            'active:translate-y-0 active:[box-shadow:var(--elev-1),inset_0_2px_4px_rgba(0,0,0,0.2)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-elev-2)]',
            'disabled:opacity-40 disabled:pointer-events-none disabled:translate-y-0',
          )}
        >
          <SendIcon />
        </button>
      </div>

      <div className="flex items-center justify-between mt-1.5 px-0.5">
        <span className="font-sans text-xs text-ink-4">Enter envia · Shift+Enter quebra linha</span>
        <span
          className={cn('font-mono text-xs', nearLimit ? 'text-warning' : 'text-ink-4')}
          aria-live="polite"
        >
          {value.length}/{ASSISTANT_QUESTION_MAX_LENGTH}
        </span>
      </div>
    </div>
  );
}
