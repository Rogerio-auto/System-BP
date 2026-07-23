// =============================================================================
// MessageComposer/MessageComposer.tsx — Compositor de mensagens.
//
// Funcionalidades:
//   - Textarea auto-resize (1-4 linhas)
//   - Cmd+Enter / Ctrl+Enter para enviar
//   - Botão de attach → preview de mídia → upload via signed-url → envio
//   - Botão de emoji (placeholder)
//   - Botão de microfone → gravação PTT (S21)
//   - Botão enviar
//   - Janela 24h: desativa texto livre quando fechada + exibe WindowNotice
//   - idempotencyKey gerado por submit (crypto.randomUUID())
//
// LGPD (doc 17):
//   - content NUNCA vai para console ou localStorage
//   - Não persistir drafts em localStorage
//   - Não logar fileName, uploadUrl, publicMediaUrl
//   - Blob de áudio PTT apenas em memória — nunca persistido localmente
// =============================================================================

import { formatMaxBytes, maxUploadBytesForMime } from '@elemento/shared-schemas';
import * as React from 'react';

import { useFeatureFlag } from '../../../../hooks/useFeatureFlag';
import { useAuth } from '../../../../lib/auth-store';
import { cn } from '../../../../lib/cn';
import { detectMediaKind, formatBytes, useUploadMedia } from '../../hooks/useUploadMedia';
import type { MediaKind } from '../../hooks/useUploadMedia';

import { AudioRecorder } from './AudioRecorder';
import type { QuickReplyPickerHandle } from './QuickReplyPicker';
import { computeQuickReplyMode, QuickReplyPicker } from './QuickReplyPicker';
import { TemplateSelector } from './TemplateSelector';
import { useSendMessage } from './useSendMessage';
import { useWindowState } from './useWindowState';
import { WindowNotice } from './WindowNotice';

/** Feature flag do seletor de respostas rápidas (doc 25 §14, F28). */
const QUICK_REPLIES_FLAG = 'livechat.quick_replies.enabled';

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface MessageComposerProps {
  conversationId: string;
  /**
   * Callback externo ao clicar em "Usar template".
   * Quando não fornecido, o MessageComposer gerencia internamente.
   */
  onUseTemplate?: (() => void) | undefined;
}

interface MediaPreview {
  file: File;
  objectUrl: string;
  mediaKind: MediaKind;
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

// ─── Ícones de tipo de mídia ──────────────────────────────────────────────────

function IconDocument({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M4 4a2 2 0 012-2h5l5 5v9a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M13 2v5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconAudio({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M9 3H5a2 2 0 00-2 2v4a2 2 0 002 2h4l5 5V7l-5-4z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15.54 8.46a5 5 0 010 7.07" strokeLinecap="round" />
    </svg>
  );
}

function IconVideo({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2 6a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M16 9l4-2v6l-4-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Componente de preview ────────────────────────────────────────────────────

interface MediaPreviewProps {
  preview: MediaPreview;
  uploadPercent: number;
  isUploading: boolean;
  onCancel: () => void;
}

function MediaPreviewArea({
  preview,
  uploadPercent,
  isUploading,
  onCancel,
}: MediaPreviewProps): React.JSX.Element {
  const { file, objectUrl, mediaKind } = preview;

  return (
    <div
      className={cn(
        'mx-3 mt-2 mb-1 rounded-sm border border-border',
        'bg-surface-2 [box-shadow:var(--elev-1)]',
        'overflow-hidden',
      )}
      role="region"
      aria-label="Prévia do arquivo selecionado"
    >
      <div className="flex items-center gap-3 p-2">
        {/* Thumbnail ou ícone */}
        <div
          className={cn(
            'shrink-0 w-[72px] h-[72px] rounded-xs overflow-hidden',
            'border border-border-subtle',
            'flex items-center justify-center',
            mediaKind !== 'image' && 'bg-surface-3',
          )}
        >
          {mediaKind === 'image' ? (
            <img src={objectUrl} alt="" className="w-full h-full object-cover" aria-hidden="true" />
          ) : mediaKind === 'video' ? (
            <IconVideo className="w-8 h-8 text-ink-3" />
          ) : mediaKind === 'audio' ? (
            <IconAudio className="w-8 h-8 text-ink-3" />
          ) : (
            <IconDocument className="w-8 h-8 text-ink-3" />
          )}
        </div>

        {/* Metadados — nome e tamanho (sem PII) */}
        <div className="flex-1 min-w-0">
          <p className="font-sans text-sm text-ink truncate" title={file.name}>
            {file.name}
          </p>
          <p className="font-mono text-xs text-ink-3 mt-0.5">{formatBytes(file.size)}</p>

          {/* Barra de progresso */}
          {isUploading && (
            <div
              className="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden"
              role="progressbar"
              aria-valuenow={uploadPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Progresso do upload: ${uploadPercent}%`}
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-150',
                  '[background:var(--grad-azul)]',
                )}
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Botão cancelar */}
        {!isUploading && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Remover arquivo selecionado"
            className={cn(
              'shrink-0 w-7 h-7 flex items-center justify-center rounded-xs',
              'text-ink-3 transition-colors duration-fast ease',
              'hover:bg-surface-hover hover:text-ink',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
              'active:bg-surface-muted',
            )}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Botão cancelar upload em andamento */}
        {isUploading && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar upload"
            className={cn(
              'shrink-0 w-7 h-7 flex items-center justify-center rounded-xs',
              'text-ink-3 transition-colors duration-fast ease',
              'hover:bg-surface-hover hover:text-danger',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            )}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * MessageComposer — input de envio de mensagem (texto + mídia) com controle de janela 24h.
 */
export function MessageComposer({
  conversationId,
  onUseTemplate,
}: MessageComposerProps): React.JSX.Element {
  const [text, setText] = React.useState('');
  const [showTemplateSelector, setShowTemplateSelector] = React.useState(false);
  const [mediaPreview, setMediaPreview] = React.useState<MediaPreview | null>(null);
  const [fileSizeError, setFileSizeError] = React.useState<string | null>(null);
  const [isRecording, setIsRecording] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // ── Respostas rápidas (F28-S06) ────────────────────────────────────────────
  const [manualQuickReplyOpen, setManualQuickReplyOpen] = React.useState(false);
  const [slashDismissed, setSlashDismissed] = React.useState(false);
  const [quickReplyActiveDescendant, setQuickReplyActiveDescendant] = React.useState<string | null>(
    null,
  );
  const quickReplyButtonRef = React.useRef<HTMLButtonElement>(null);
  const quickReplyPickerRef = React.useRef<QuickReplyPickerHandle>(null);

  useAutoResize(textareaRef, text);

  const { windowOpen, windowKind, isLoading } = useWindowState(conversationId);
  const sendMutation = useSendMessage(conversationId);
  const { upload, progress, abort } = useUploadMedia(conversationId);
  const { hasPermission } = useAuth();
  const quickRepliesFlag = useFeatureFlag(QUICK_REPLIES_FLAG);

  const canSendMessages = hasPermission('livechat:message:send');
  const isUploading = progress.phase === 'uploading' || progress.phase === 'signing';
  const isDisabled =
    !windowOpen || isLoading || sendMutation.isPending || isUploading || !canSendMessages;

  // canSend: tem texto OU tem preview pronto (e não está em fase de erro nem uploading)
  const hasMedia = mediaPreview !== null && !isUploading && progress.phase !== 'error';
  const canSend = (!isDisabled && text.trim().length > 0) || hasMedia;

  // Motivo visível de indisponibilidade (doc 25 §11.1) — independente de
  // `isDisabled` (que outros botões já usam) para não alterar o comportamento
  // deles; a flag controla só a RENDERIZAÇÃO do botão (doc 25 §14 item 1).
  const quickRepliesDisabledReason: 'permission' | 'window' | 'loading' | null = !canSendMessages
    ? 'permission'
    : isLoading
      ? 'loading'
      : !windowOpen
        ? 'window'
        : null;
  const quickRepliesAvailable = quickRepliesFlag.enabled && quickRepliesDisabledReason === null;

  // Modo do painel: manual (botão/atalho) tem prioridade; "/" como primeiro
  // caractere do textarea abre no modo slash (doc 25 §11.1). Ambos exigem
  // `quickRepliesAvailable` — garante que NENHUM envio parte com a janela
  // fechada, pois o QuickReplyPicker só monta quando o modo é não-nulo.
  const quickReplyMode = computeQuickReplyMode({
    available: quickRepliesAvailable,
    manualOpen: manualQuickReplyOpen,
    text,
    slashDismissed,
  });

  // Fecha o painel se a disponibilidade cair (ex.: janela fechou durante o uso).
  React.useEffect(() => {
    if (!quickRepliesAvailable) setManualQuickReplyOpen(false);
  }, [quickRepliesAvailable]);

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
    // Qualquer digitação reabilita o modo slash (ex.: reabrir depois de Tab
    // ter dispensado o painel — ver handleKeyDown / caso 'Tab').
    setSlashDismissed(false);
  }

  // ── Respostas rápidas (F28-S06) ──────────────────────────────────────────

  function handleToggleQuickReplyPicker(): void {
    if (quickRepliesDisabledReason !== null) return;
    setManualQuickReplyOpen((v) => !v);
    setSlashDismissed(false);
  }

  function handleQuickReplyClose(): void {
    setManualQuickReplyOpen(false);
    // Modo slash: a query É o texto do campo — sem limpar, o painel reabriria
    // no próximo render (text ainda começa com "/").
    if (quickReplyMode === 'slash') setText('');
    setSlashDismissed(false);
    setQuickReplyActiveDescendant(null);
    textareaRef.current?.focus();
  }

  function handleQuickReplyInsertText(insertedText: string): void {
    setText(insertedText);
    setManualQuickReplyOpen(false);
    setSlashDismissed(false);
    setQuickReplyActiveDescendant(null);
    // Foco após o próximo paint — o painel acabou de desmontar.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleQuickReplySent(): void {
    setText('');
    setManualQuickReplyOpen(false);
    setSlashDismissed(false);
    setQuickReplyActiveDescendant(null);
    textareaRef.current?.focus();
  }

  function handleComposerShortcut(e: React.KeyboardEvent<HTMLDivElement>): void {
    // Ctrl/Cmd+Shift+E — abre/fecha o painel manual (doc 25 §11.1).
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
      if (quickRepliesDisabledReason !== null || !quickRepliesFlag.enabled) return;
      e.preventDefault();
      setManualQuickReplyOpen((v) => !v);
      setSlashDismissed(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Modo slash: foco permanece no textarea — encaminha a navegação para o
    // painel via ref (padrão de acessibilidade de ChatListFilters.tsx).
    if (quickReplyMode === 'slash') {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          quickReplyPickerRef.current?.moveActive(1);
          return;
        case 'ArrowUp':
          e.preventDefault();
          quickReplyPickerRef.current?.moveActive(-1);
          return;
        case 'Enter':
          e.preventDefault();
          quickReplyPickerRef.current?.activateSelected(e.altKey ? 'insert' : 'send');
          return;
        case 'Escape':
          e.preventDefault();
          setText('');
          setSlashDismissed(false);
          textareaRef.current?.focus();
          return;
        case 'Tab':
          // Não bloqueia o Tab padrão — só dispensa o painel.
          setSlashDismissed(true);
          return;
        default:
          break;
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSend) void handleSend();
    }
  }

  function handleAttachClick(): void {
    // Limpa erro anterior antes de nova seleção
    setFileSizeError(null);
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    // Limpar input imediatamente para não manter referência (LGPD)
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (!file) return;

    // Validação de tamanho — inline, antes de qualquer chamada de rede.
    // Limite POR TIPO de mídia (imagem 5MB · áudio/vídeo 16MB · documento 50MB).
    const mime = file.type || 'application/octet-stream';
    const maxBytes = maxUploadBytesForMime(mime);
    if (file.size > maxBytes) {
      setFileSizeError(
        `Arquivo muito grande. O limite é ${formatMaxBytes(maxBytes)} para este tipo.`,
      );
      return;
    }

    setFileSizeError(null);

    // Criar object URL para preview local (nunca enviado ao servidor)
    const objectUrl = URL.createObjectURL(file);
    const mediaKind = detectMediaKind(mime);
    setMediaPreview({ file, objectUrl, mediaKind });
  }

  function handleCancelMedia(): void {
    if (isUploading) {
      abort();
    }
    if (mediaPreview) {
      // Liberar memória do object URL (evita leak)
      URL.revokeObjectURL(mediaPreview.objectUrl);
    }
    setMediaPreview(null);
    setFileSizeError(null);
  }

  function handleMicClick(): void {
    setIsRecording(true);
  }

  async function handleSend(): Promise<void> {
    if (!canSend || isDisabled) return;

    const idempotencyKey = crypto.randomUUID();

    if (mediaPreview) {
      // ── Envio de mídia ───────────────────────────────────────────────────
      let uploadResult: Awaited<ReturnType<typeof upload>>;
      try {
        uploadResult = await upload(mediaPreview.file);
      } catch {
        // Erro já registrado no `progress.error` — componente exibe inline.
        return;
      }

      sendMutation.mutate(
        {
          type: 'media',
          mediaKind: uploadResult.mediaKind,
          publicMediaUrl: uploadResult.publicMediaUrl,
          mime: uploadResult.mime,
          fileName: uploadResult.fileName,
          idempotencyKey,
        },
        {
          onSuccess: () => {
            URL.revokeObjectURL(mediaPreview.objectUrl);
            setMediaPreview(null);
            textareaRef.current?.focus();
          },
        },
      );
    } else {
      // ── Envio de texto ───────────────────────────────────────────────────
      const trimmed = text.trim();
      if (!trimmed) return;

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
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        'relative flex flex-col border-t border-border bg-surface-1',
        '[box-shadow:inset_0_1px_0_rgba(255,255,255,0.06)]',
      )}
      aria-label="Compositor de mensagem"
      onKeyDown={handleComposerShortcut}
    >
      {/* Seletor de template (S19) — aparece acima do compositor */}
      {showTemplateSelector && (
        <TemplateSelector
          conversationId={conversationId}
          onClose={() => setShowTemplateSelector(false)}
          onSend={handleTemplateSend}
        />
      )}

      {/* Respostas rápidas (F28-S06) — aparece acima do compositor */}
      {quickReplyMode !== null && (
        <QuickReplyPicker
          ref={quickReplyPickerRef}
          conversationId={conversationId}
          mode={quickReplyMode}
          slashQuery={quickReplyMode === 'slash' ? text.slice(1) : ''}
          triggerRef={quickReplyButtonRef}
          onClose={handleQuickReplyClose}
          onInsertText={handleQuickReplyInsertText}
          onSent={handleQuickReplySent}
          onActiveDescendantChange={setQuickReplyActiveDescendant}
        />
      )}

      {/* Sem permissão de envio */}
      {!canSendMessages && (
        <div
          className="px-4 py-2 font-sans text-xs text-ink-3 text-center border-b border-border"
          role="status"
          aria-label="Você não tem permissão para enviar mensagens nesta conversa"
        >
          Sem permissão para enviar mensagens.
        </div>
      )}

      {/* Aviso de janela expirada */}
      {canSendMessages && !windowOpen && !isLoading && (
        <WindowNotice windowKind={windowKind} onUseTemplate={onUseTemplate ?? handleUseTemplate} />
      )}

      {/* Erro de tamanho de arquivo */}
      {fileSizeError && (
        <p
          className="mx-3 mt-2 px-3 py-1.5 rounded-xs bg-danger/10 text-danger font-sans text-xs"
          role="alert"
        >
          {fileSizeError}
        </p>
      )}

      {/* Erro de upload */}
      {progress.phase === 'error' && progress.error && (
        <p
          className="mx-3 mt-2 px-3 py-1.5 rounded-xs bg-danger/10 text-danger font-sans text-xs"
          role="alert"
        >
          {progress.error}
        </p>
      )}

      {/* Preview de mídia (com barra de progresso embutida) */}
      {mediaPreview && (
        <MediaPreviewArea
          preview={mediaPreview}
          uploadPercent={progress.percent}
          isUploading={isUploading}
          onCancel={handleCancelMedia}
        />
      )}

      {/* Área de composição — substituída pelo AudioRecorder quando em modo PTT */}
      {isRecording ? (
        <AudioRecorder
          conversationId={conversationId}
          onSent={() => setIsRecording(false)}
          onCancel={() => setIsRecording(false)}
        />
      ) : (
        <div className="flex items-end gap-2 px-3 py-2 min-w-0">
          {/* Botão de attach */}
          <button
            type="button"
            onClick={handleAttachClick}
            disabled={isDisabled || mediaPreview !== null}
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

          {/* Input file oculto — accept inclui tipos suportados */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx"
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
            onChange={handleFileChange}
          />

          {/* Botão de respostas rápidas (F28-S06) — nem renderiza com a flag desligada */}
          {quickRepliesFlag.enabled && (
            <button
              ref={quickReplyButtonRef}
              type="button"
              onClick={handleToggleQuickReplyPicker}
              disabled={isDisabled || mediaPreview !== null}
              aria-label="Respostas rápidas"
              aria-haspopup="dialog"
              aria-expanded={quickReplyMode !== null}
              title={
                quickRepliesDisabledReason === 'permission'
                  ? 'Sem permissão para enviar mensagens.'
                  : quickRepliesDisabledReason === 'window'
                    ? 'Janela de 24h fechada — respostas rápidas indisponíveis.'
                    : quickRepliesDisabledReason === 'loading'
                      ? 'Carregando...'
                      : 'Respostas rápidas (/ ou Ctrl+Shift+E)'
              }
              className={cn(
                'shrink-0 w-9 h-9 flex items-center justify-center rounded-sm',
                'text-ink-3 transition-colors duration-fast ease',
                'hover:bg-surface-hover hover:text-ink',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
                'active:bg-surface-muted',
                quickReplyMode !== null && 'bg-azul/10 text-azul',
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
                  d="M11 2L4 12h5l-1 6 7-10h-5l1-6z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}

          {/* Textarea auto-resize */}
          <div className="flex-1 min-w-0 relative">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              disabled={isDisabled || mediaPreview !== null}
              placeholder={
                !canSendMessages
                  ? 'Sem permissão para enviar mensagens'
                  : isLoading
                    ? 'Carregando...'
                    : !windowOpen
                      ? 'Janela expirada — use um template'
                      : mediaPreview !== null
                        ? 'Pronto para enviar arquivo...'
                        : 'Digite uma mensagem... (Ctrl+Enter para enviar, / para respostas rápidas)'
              }
              rows={1}
              aria-label="Campo de mensagem"
              aria-describedby={!windowOpen ? 'composer-window-notice' : undefined}
              role={quickReplyMode === 'slash' ? 'combobox' : undefined}
              aria-expanded={quickReplyMode === 'slash' ? true : undefined}
              aria-activedescendant={
                quickReplyMode === 'slash' ? (quickReplyActiveDescendant ?? undefined) : undefined
              }
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

          {/* Botão de microfone (PTT) */}
          <button
            type="button"
            onClick={handleMicClick}
            disabled={isDisabled || mediaPreview !== null}
            aria-label="Gravar áudio"
            title="Gravar áudio (push-to-talk)"
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
              <rect x="7" y="2" width="6" height="9" rx="3" />
              <path
                d="M4 10a6 6 0 0012 0M10 16v3M7 19h6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* Botão enviar */}
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            aria-label={mediaPreview ? 'Enviar arquivo' : 'Enviar mensagem'}
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
      )}

      {/* Dica de teclado — oculta durante gravação */}
      {windowOpen && !mediaPreview && !isRecording && (
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
