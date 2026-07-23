// =============================================================================
// features/quick-replies/admin/QuickReplyVariablePicker.tsx — Botões de
// inserção de variável + hint ao vivo (F28-S07, doc 25 §6.1 e §11.2).
// =============================================================================

import * as React from 'react';

import { QUICK_REPLY_VARIABLES } from '../types';

import type { QuickReplyVariableHint } from './variableHint';

interface QuickReplyVariablePickerProps {
  onInsert: (token: string) => void;
  hint: QuickReplyVariableHint | null;
  disabled?: boolean;
}

/**
 * Fileira de chips que inserem `{{chave}}` (ou `{{chave|fallback}}` quando o
 * catálogo exige fallback, doc 25 §6.1 D3) no ponto de inserção do textarea.
 */
export function QuickReplyVariablePicker({
  onInsert,
  hint,
  disabled = false,
}: QuickReplyVariablePickerProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REPLY_VARIABLES.map((variable) => {
          const token = variable.requiresFallback
            ? `{{${variable.key}|valor}}`
            : `{{${variable.key}}}`;
          return (
            <button
              key={variable.key}
              type="button"
              disabled={disabled}
              title={variable.label}
              onClick={() => onInsert(token)}
              className="inline-flex items-center px-2 py-1 rounded-xs font-mono text-xs text-azul border border-azul/25 bg-azul/5 hover:bg-azul/10 hover:border-azul/40 transition-colors duration-fast disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
            >
              {`{{${variable.key}}}`}
            </button>
          );
        })}
      </div>

      {hint && (
        <p className="font-sans text-xs text-warning flex items-start gap-1.5">
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-3.5 h-3.5 shrink-0 mt-0.5"
            aria-hidden="true"
          >
            <path d="M8 2l6 10H2L8 2Z" />
            <path d="M8 7v3M8 11.5v.5" />
          </svg>
          {hint.message}
        </p>
      )}
    </div>
  );
}
