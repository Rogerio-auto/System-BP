// =============================================================================
// MessageComposer/MessageComposer.tsx — Compositor de mensagens.
//
// Funcionalidades:
//   - Textarea auto-resize (1-4 linhas)
//   - Cmd+Enter / Ctrl+Enter para enviar
//   - Botão de attach (input file oculto)
//   - Botão de emoji (placeholder)
//   - Botão enviar
//   - Janela 24h: desativa texto livre quando fechada + exibe WindowNotice
//   - idempotencyKey gerado por submit (crypto.randomUUID())
//
// LGPD (doc 17):
//   - content NUNCA vai para console ou localStorage
//   - Não persistir drafts em localStorage
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../lib/cn';

import { TemplateSelector } from './TemplateSelector';
import { useSendMessage } from './useSendMessage';
import { useWindowState } from './useWindowState';
import { WindowNotice } from './WindowNotice';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface MessageComposerProps {
  conversationId: string;
  /**
   * Callback externo ao clicar em "Usar template".
   * Quando não fornecido, o MessageComposer gerencia internamente (S19).
   */
  onUseTemplate?: (() => void) | undefined;
}

// ─── Hook de auto-resize do textarea ──────────────────────────────────────────

function useAutoResize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string): void {
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reset para recalcular
    el.style.height = 'auto';
    // Clamp: mínimo 1 linha (40px), máximo 4 linhas (~96px)
    const newHeight = Math.min(Math.max(el.scrollHeight, 40), 96);
    el.style.height = `${newHeight}px`;
  }, [ref, value]);
}

// ─── Componente ──────────────────────────────────────────────────────────────

/**
 * MessageComposer — input de envio de mensagem com controle de janela 24h.
 *
 * Não gerencia upload de mídia neste slot (S17 cobre texto; mídia = S18+).
 */
export function MessageComposer({
  conversationId,
  onUseTemplate,
}: MessageComposerProps): React.JSX.Element {
  const [text, setText] = React.useState('');
  const [showTemplateSelector, setShowTemplateSelector] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useAutoResize(textareaRef, text);

  const { windowOpen, windowKind, isLoading } = useWindowState(conversationId);
  const sendMutation = useSendMessage(conversationId);

  const isDisabled = !windowOpen || isLoading || sendMutation.isPending;
  const canSend = text.trim().length > 0 && !isDisabled;

  // Callback interno do seletor de template (S19)
  const handleUseTemplate = React.useCallback(() => {
    setShowTemplateSelector(true);
  }, []);

  // Callback ao confirmar envio no TemplateSelector
  function handleTemplateSend(
    templateName: string,
    languageCode: string,
    components: unknown[],
    _variables: Record<string, string>,
  ): void {
    const idempotencyKey = crypto.randomUUID();
    sendMutation.mutate(
      { type: 'template', templateName, languageCode, components, idempotencyKey },
      {
        onSuccess: () => {
          setShowTemplateSelector(false);
        },
      },
    );
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setText(e.target.value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Cmd+Enter (Mac) ou Ctrl+Enter (Windows/Linux) — envia
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSend) handleSend();
    }
    // Enter sozinho: nova linha (comportamento padrão de textarea)
  }

  function handleSend(): void {
    const trimmed = text.trim();
    if (!trimmed || isDisabled) return;

    // Novo UUID por tentativa — idempotência
    const idempotencyKey = crypto.randomUUID();

    sendMutation.mutate(
      { type: 'text', content: trimmed, idempotencyKey },
      {
        onSuccess: () => {
          setText('');
          textareaRef.current?.focus();
        },
      },
    );
  }

  function handleAttachClick(): void {
    fileInputRef.current?.click();
  }

  // Arquivo selecionado — placeholder para S18 (upload via signed URL)
  function handleFileChange(_e: React.ChangeEvent<HTMLInputElement>): void {
    // TODO S18: upload via POST /api/livechat/media/upload-url
    // Por ora, limpa o input para não manter referência ao arquivo (LGPD)
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        'relative flex flex-col border-t border-border bg-surface-1',
        '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.06)]',
      )}
      aria-label="Compositor de mensagem"
    >
      {/* Seletor de template (S19) — aparece acima do compositor */}
      {showTemplateSelector && (
        <TemplateSelector
          conversationId={conversationId}
          onClose={() => setShowTemplateSelector(false)}
          onSend={handleTemplateSend}
        />
      )}

      {/* Aviso de janela expirada */}
      {!windowOpen && !isLoading && (
        <WindowNotice
          windowKind={windowKind}
          onUseTemplate={onUseTemplate ?? handleUseTemplate}
        />
      )}

      {/* Área de composição */}
      <div className="flex items-end gap-2 px-3 py-2">
        {/* Botão de attach */}
        <button
          type="button"
          onClick={handleAttachClick}
          disabled={isDisabled}
          aria-label="Anexar arquivo"
          className={cn(
            'shrink-0 w-9 h-9 flex items-center justify-center rounded-sm',
            'text-ink-3 transition-colors duration-fast ease',
            'hover:bg-surface-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            'active:bg-surface-muted',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
          )}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-5 h-5"
            aria-hidden="true"
          >
            <path
              d="M14.5 11.5l-5 5a4 4 0 01-5.66-5.66l6.36-6.36a2.5 2.5 0 013.54 3.54l-6.36 6.36a1 1 0 01-1.41-1.41l5.65-5.66"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Input file oculto */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*,application/pdf,.doc,.docx"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={handleFileChange}
        />

        {/* Textarea auto-resize */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            disabled={isDisabled}
            placeholder={
              isLoading
                ? 'Carregando...'
                : !windowOpen
                  ? 'Janela expirada — use um template'
                  : 'Digite uma mensagem... (Ctrl+Enter para enviar)'
            }
            rows={1}
            aria-label="Campo de mensagem"
            aria-describedby={!windowOpen ? 'composer-window-notice' : undefined}
            className={cn(
              'w-full resize-none rounded-sm px-3 py-2',
              'font-sans text-sm text-ink',
              'bg-surface-inset border border-border',
              // Inset shadow interno — campo real, não "sticker"
              '[box-shadow:inset_0_1px_3px_rgba(20,33,61,0.06),inset_0_0_0_1px_var(--border)]',
              'placeholder:text-ink-3',
              'transition-[border-color,box-shadow] duration-fast ease',
              'focus:outline-none focus:border-azul',
              'focus:[box-shadow:inset_0_1px_3px_rgba(20,33,61,0.06),0_0_0_2px_rgba(27,58,140,0.12)]',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'min-h-[40px] max-h-24',
              'overflow-y-auto',
            )}
          />
        </div>

        {/* Botão de emoji (placeholder) */}
        <button
          type="button"
          disabled={isDisabled}
          aria-label="Inserir emoji (em breve)"
          title="Emoji (em breve)"
          className={cn(
            'shrink-0 w-9 h-9 flex items-center justify-center rounded-sm',
            'text-ink-3 transition-colors duration-fast ease',
            'hover:bg-surface-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            'active:bg-surface-muted',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
          )}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-5 h-5"
            aria-hidden="true"
          >
            <circle cx="10" cy="10" r="8" />
            <path d="M7 12s1 2 3 2 3-2 3-2" strokeLinecap="round" />
            <circle cx="7.5" cy="8.5" r=".75" fill="currentColor" stroke="none" />
            <circle cx="12.5" cy="8.5" r=".75" fill="currentColor" stroke="none" />
          </svg>
        </button>

        {/* Botão enviar */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Enviar mensagem"
          className={cn(
            'shrink-0 w-9 h-9 flex items-center justify-center rounded-sm',
            'transition-[transform,box-shadow,background,color] duration-fast ease',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
            // Default: cinza
            !canSend
              ? 'bg-surface-muted text-ink-3'
              : [
                  // Ativo: azul com glow
                  '[background:var(--grad-azul)] text-white',
                  '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
                  'hover:-translate-y-0.5',
                  'hover:[box-shadow:var(--glow-azul),inset_0_1px_0_rgba(255,255,255,0.2)]',
                  'active:translate-y-0',
                  'active:[box-shadow:var(--elev-1),inset_0_2px_4px_rgba(0,0,0,0.2)]',
                ],
          )}
        >
          {sendMutation.isPending ? (
            // Spinner de envio
            <svg
              viewBox="0 0 20 20"
              className="w-4 h-4 animate-spin"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="7" strokeOpacity="0.3" />
              <path d="M10 3a7 7 0 017 7" strokeLinecap="round" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M18 10L2 3l3 7-3 7 16-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      </div>

      {/* Dica de teclado */}
      {windowOpen && (
        <p className="px-4 pb-2 font-sans text-xs text-ink-4">
          <kbd className="px-1 py-0.5 rounded-xs border border-border-subtle font-mono text-xs bg-surface-2">
            Ctrl+Enter
          </kbd>{' '}
          para enviar
        </p>
      )}
    </div>
  );
}
