// =============================================================================
// features/quick-replies/admin/QuickReplyMediaField.tsx — Upload de mídia da
// biblioteca (F28-S07, doc 25 §7).
//
// Usa useUploadQuickReplyMedia (F28-S05) — 2 fases (signed-url + PUT direto),
// progresso real via XHR, cancelamento. Limite por MIME já validado dentro
// do hook (imagem 5MB, áudio/vídeo 16MB, documento 50MB).
// =============================================================================

import { formatMaxBytes, maxUploadBytesForMime } from '@elemento/shared-schemas';
import * as React from 'react';

import type { QuickReplyMediaKind, QuickReplyUploadResult } from '../types';
import { useUploadQuickReplyMedia } from '../useUploadQuickReplyMedia';

interface QuickReplyMediaFieldProps {
  value: QuickReplyUploadResult | null;
  onChange: (media: QuickReplyUploadResult | null) => void;
  disabled?: boolean;
}

const KIND_LABEL: Record<QuickReplyMediaKind, string> = {
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Campo de anexo de mídia com preview, progresso e cancelamento. */
export function QuickReplyMediaField({
  value,
  onChange,
  disabled = false,
}: QuickReplyMediaFieldProps): React.JSX.Element {
  const { upload, progress, abort } = useUploadQuickReplyMedia();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);

  const handleFile = (file: File): void => {
    setLocalError(null);
    upload(file)
      .then((result) => onChange(result))
      .catch((err: unknown) => {
        setLocalError(err instanceof Error ? err.message : 'Falha ao enviar o arquivo.');
      });
  };

  const isBusy = progress.phase === 'signing' || progress.phase === 'uploading';

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-xs font-semibold text-ink-3 uppercase tracking-[0.1em]">
        Mídia <span className="normal-case tracking-normal text-ink-4">(opcional)</span>
      </span>

      {value ? (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-sm border border-border"
          style={{ background: 'var(--bg-elev-1)' }}
        >
          <div
            className="w-10 h-10 rounded-sm flex items-center justify-center shrink-0"
            style={{ background: 'var(--info-bg)', color: 'var(--info)' }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-5 h-5"
            >
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
              <path d="M2 11l3.5-3.5L8 10l2.5-2.5L14 11" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-sans text-sm font-medium text-ink truncate">{value.mediaFileName}</p>
            <p className="font-mono text-xs text-ink-4">
              {KIND_LABEL[value.mediaKind]} · {formatBytes(value.mediaSizeBytes)}
            </p>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Remover mídia"
              className="w-8 h-8 flex items-center justify-center rounded-sm text-ink-3 hover:text-danger hover:bg-danger/10 transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                className="w-4 h-4"
              >
                <path d="M3 4h10M6 4V2h4v2M5 4l.7 9.1a1 1 0 0 0 1 .9h2.6a1 1 0 0 0 1-.9L11 4" />
              </svg>
            </button>
          )}
        </div>
      ) : isBusy ? (
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-sm border border-border-subtle"
          style={{ background: 'var(--bg-elev-1)' }}
        >
          <div className="flex-1">
            <p className="font-sans text-xs text-ink-3 mb-1.5">
              {progress.phase === 'signing'
                ? 'Preparando envio...'
                : `Enviando... ${progress.percent}%`}
            </p>
            <div
              className="h-1.5 rounded-pill overflow-hidden"
              style={{ background: 'var(--surface-muted)' }}
            >
              <div
                className="h-full rounded-pill transition-[width] duration-fast ease"
                style={{ width: `${progress.percent}%`, background: 'var(--grad-azul)' }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={abort}
            className="font-sans text-xs font-semibold text-danger hover:underline focus-visible:outline-none focus-visible:underline"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-4 py-4 rounded-sm border border-dashed border-border-strong text-ink-3 hover:border-azul hover:text-azul transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-4 h-4"
          >
            <path d="M8 2v8M4 6l4-4 4 4M3 12h10" />
          </svg>
          <span className="font-sans text-sm font-medium">
            Anexar imagem, vídeo, áudio ou documento
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = '';
        }}
      />

      <p className="font-sans text-xs text-ink-4">
        Imagem até {formatMaxBytes(maxUploadBytesForMime('image/jpeg'))} · vídeo/áudio até{' '}
        {formatMaxBytes(maxUploadBytesForMime('video/mp4'))} · documento até{' '}
        {formatMaxBytes(maxUploadBytesForMime('application/pdf'))}.
      </p>

      {(localError ?? (progress.phase === 'error' ? progress.error : undefined)) && (
        <span role="alert" className="text-xs text-danger">
          {localError ?? progress.error}
        </span>
      )}
    </div>
  );
}
