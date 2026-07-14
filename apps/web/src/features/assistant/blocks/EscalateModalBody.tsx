// =============================================================================
// features/assistant/blocks/EscalateModalBody.tsx — Corpo do modal de
// confirmação de escalação (F6-S31): aviso de "é notificação, não decisão",
// campo de nota opcional e alerta de erro inline. Extraído de
// EscalateToCreditModal.tsx para manter cada componente < 200 linhas.
// =============================================================================

import * as React from 'react';

import { ESCALATE_NOTE_MAX_LENGTH } from '../../../hooks/assistant/useEscalateLead';
import { cn } from '../../../lib/cn';

interface EscalateModalBodyProps {
  note: string;
  onNoteChange: (value: string) => void;
  disabled: boolean;
  inlineError: string | null;
}

export function EscalateModalBody({
  note,
  onNoteChange,
  disabled,
  inlineError,
}: EscalateModalBodyProps): React.JSX.Element {
  return (
    <div className="p-5 flex flex-col gap-4">
      <p
        id="escalate-modal-desc"
        className="font-sans text-sm text-ink"
        style={{ lineHeight: 1.5 }}
      >
        Este lead será notificado ao{' '}
        <strong className="font-semibold">Departamento de Crédito</strong> para que um analista
        assuma a análise.
      </p>

      <div
        className="flex items-start gap-3 p-3 rounded-md border"
        style={{ background: 'var(--info-bg)', borderColor: 'var(--info)' }}
        role="note"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="w-4 h-4 shrink-0 mt-0.5"
          style={{ color: 'var(--info)' }}
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" />
          <path d="M8 7v4M8 5.5v.5" strokeLinecap="round" />
        </svg>
        <p className="font-sans text-xs leading-relaxed" style={{ color: 'var(--info)' }}>
          Isto é apenas uma <strong>notificação</strong>: o lead não muda de status no Kanban e
          nenhuma decisão de crédito é tomada automaticamente.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label
          htmlFor="escalate-note"
          className="font-sans font-semibold text-ink-2 uppercase"
          style={{ fontSize: 'var(--text-xs)', letterSpacing: '0.1em' }}
        >
          Nota <span className="font-normal text-ink-4 normal-case">(opcional)</span>
        </label>
        <textarea
          id="escalate-note"
          rows={3}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          disabled={disabled}
          placeholder="Contexto para o analista de crédito — ex.: renda já comprovada, falta revisão documental..."
          maxLength={ESCALATE_NOTE_MAX_LENGTH}
          className={cn(
            'w-full font-sans font-medium text-ink',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow] duration-fast ease',
            'placeholder:text-ink-4',
            'hover:border-ink-3',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'disabled:opacity-60 disabled:cursor-not-allowed',
            'resize-none',
          )}
          style={{ fontSize: 'var(--text-sm)' }}
        />
        <span className="font-mono text-ink-4 self-end" style={{ fontSize: 'var(--text-xs)' }}>
          {note.length}/{ESCALATE_NOTE_MAX_LENGTH}
        </span>
      </div>

      {inlineError && (
        <div
          className="flex items-start gap-2 px-3 py-2.5 rounded-xs"
          role="alert"
          style={{
            background: 'var(--danger-bg)',
            border: '1px solid var(--danger)',
            borderLeftWidth: 3,
          }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-4 h-4 shrink-0 mt-px"
            style={{ color: 'var(--danger)' }}
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v4M8 11v.5" />
          </svg>
          <p className="font-sans text-sm text-ink">{inlineError}</p>
        </div>
      )}
    </div>
  );
}
