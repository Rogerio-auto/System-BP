// =============================================================================
// features/quick-replies/admin/QuickReplyBodySection.tsx — Corpo da mensagem:
// textarea + contador + variáveis + aviso LGPD + mídia + preview ao vivo
// (F28-S07, doc 25 §6, §7, §11.2, §12).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';
import { QUICK_REPLY_BODY_MAX_LENGTH } from '../types';
import type { QuickReplyUploadResult } from '../types';

import { QuickReplyMediaField } from './QuickReplyMediaField';
import { QuickReplyPreview } from './QuickReplyPreview';
import { QuickReplyVariablePicker } from './QuickReplyVariablePicker';
import { computeQuickReplyVariableHint } from './variableHint';

interface QuickReplyBodySectionProps {
  body: string;
  onBodyChange: (value: string) => void;
  bodyError: string | undefined;
  media: QuickReplyUploadResult | null;
  onMediaChange: (media: QuickReplyUploadResult | null) => void;
  agentName: string;
  disabled?: boolean;
}

export function QuickReplyBodySection({
  body,
  onBodyChange,
  bodyError,
  media,
  onMediaChange,
  agentName,
  disabled = false,
}: QuickReplyBodySectionProps): React.JSX.Element {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const hint = React.useMemo(() => computeQuickReplyVariableHint(body), [body]);

  /** Insere o token no ponto do cursor (ou no fim, se não houver foco). */
  function insertToken(token: string): void {
    const el = textareaRef.current;
    if (!el) {
      onBodyChange(body + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    onBodyChange(next);
    // Restaura foco e cursor após o token inserido (próximo tick — o value
    // controlado precisa re-renderizar antes de mover a seleção).
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  const charCount = body.length;
  const overLimit = charCount > QUICK_REPLY_BODY_MAX_LENGTH;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label
            htmlFor="quick-reply-body"
            className="font-sans text-sm font-semibold text-ink tracking-[-0.005em]"
          >
            Corpo da mensagem
          </label>
          <span
            className={`font-mono text-xs ${overLimit ? 'text-danger' : 'text-ink-4'}`}
            style={{ letterSpacing: '-0.01em' }}
          >
            {charCount}/{QUICK_REPLY_BODY_MAX_LENGTH}
          </span>
        </div>

        <textarea
          ref={textareaRef}
          id="quick-reply-body"
          rows={5}
          placeholder="Ex: Olá {{contato.primeiro_nome|tudo bem}}, aqui é {{atendente.primeiro_nome|a equipe}} do Banco do Povo..."
          value={body}
          disabled={disabled}
          onChange={(e) => onBodyChange(e.target.value)}
          aria-invalid={Boolean(bodyError) || undefined}
          aria-describedby={bodyError ? 'quick-reply-body-error' : undefined}
          className={cn(
            'w-full font-sans text-sm font-medium text-ink',
            'bg-surface-1 rounded-sm px-[14px] py-[11px]',
            'border border-border-strong',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease',
            'placeholder:text-ink-4 resize-y',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            bodyError && [
              'border-danger',
              'focus:border-danger',
              'focus:shadow-[0_0_0_3px_rgba(200,52,31,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            ],
          )}
        />

        {bodyError && (
          <span id="quick-reply-body-error" role="alert" className="text-xs text-danger">
            {bodyError}
          </span>
        )}

        <QuickReplyVariablePicker onInsert={insertToken} hint={hint} disabled={disabled} />
      </div>

      {/* Aviso LGPD — doc 25 §12: rejeição server-side de CPF/CNPJ/e-mail/telefone */}
      <div
        className="flex items-start gap-3 px-4 py-3 rounded-sm border"
        style={{
          background: 'var(--warning-bg)',
          borderColor: 'var(--warning)',
          borderLeftWidth: 3,
        }}
        role="note"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          className="w-4 h-4 shrink-0 mt-0.5"
          style={{ color: 'var(--warning)' }}
          aria-hidden="true"
        >
          <path d="M8 2l6 10H2L8 2Z" />
          <path d="M8 7v3M8 11.5v.5" />
        </svg>
        <p className="font-sans text-xs text-ink-3 leading-relaxed">
          Não inclua dado pessoal do cidadão neste texto — CPF, CNPJ, e-mail ou telefone. O cadastro
          é bloqueado automaticamente se detectar esses padrões. Para personalizar a mensagem, use
          as variáveis acima (resolvidas no momento do envio, nunca gravadas aqui).
        </p>
      </div>

      <QuickReplyMediaField value={media} onChange={onMediaChange} disabled={disabled} />

      <QuickReplyPreview body={body} media={media} agentName={agentName} />
    </div>
  );
}
