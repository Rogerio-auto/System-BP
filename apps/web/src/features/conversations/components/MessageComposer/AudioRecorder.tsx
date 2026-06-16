// =============================================================================
// MessageComposer/AudioRecorder.tsx — Gravação de áudio PTT (push-to-talk).
//
// Renderizado pelo MessageComposer quando isRecording=true.
// Chama start() no mount e gerencia o ciclo de gravação → upload → envio.
//
// Estados visuais:
//   recording  → timer + barra de amplitude + botões cancelar/enviar
//   stopped    → barra de progresso de upload
//   permission_denied → mensagem inline de erro
//   idle       → não renderiza (pai controla visibilidade)
//
// LGPD (doc 17):
//   - Blob de áudio apenas em memória — não persiste localmente.
//   - Não loga publicMediaUrl, fileName.
// =============================================================================

import * as React from 'react';

import { cn } from '../../../../lib/cn';
import { useAudioRecorder } from '../../hooks/useAudioRecorder';
import { useUploadMedia } from '../../hooks/useUploadMedia';

import { useSendMessage } from './useSendMessage';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AudioRecorderProps {
  conversationId: string;
  onSent: () => void;
  onCancel: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formata ms → "MM:SS". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ─── Ícones ───────────────────────────────────────────────────────────────────

function IconTrash(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-5 h-5"
      aria-hidden="true"
    >
      <path
        d="M5 7h10M8 7V5a1 1 0 011-1h2a1 1 0 011 1v2M7 7l1 9h4l1-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCheck(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M4 10l5 5 7-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Timer live ───────────────────────────────────────────────────────────────

interface LiveTimerProps {
  startedAt: number;
}

function LiveTimer({ startedAt }: LiveTimerProps): React.JSX.Element {
  const [elapsed, setElapsed] = React.useState(() => Date.now() - startedAt);

  React.useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 500);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className="font-mono text-sm tabular-nums text-ink" aria-live="off">
      {formatDuration(elapsed)}
    </span>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

/**
 * AudioRecorder — modo de gravação do composer.
 * Inicia gravação automaticamente no mount via useEffect.
 */
export function AudioRecorder({
  conversationId,
  onSent,
  onCancel,
}: AudioRecorderProps): React.JSX.Element {
  const { state, start, stop, cancel } = useAudioRecorder();
  const { upload, progress, abort } = useUploadMedia(conversationId);
  const sendMutation = useSendMessage(conversationId);

  const isUploading = progress.phase === 'uploading' || progress.phase === 'signing';
  const isBusy = isUploading || sendMutation.isPending;

  // Inicia gravação no mount
  React.useEffect(() => {
    void start();
  }, [start]);

  // Quando o estado muda para "stopped", faz upload e envia
  React.useEffect(() => {
    if (state.phase !== 'stopped') return;
    const { blob, mime } = state;

    async function uploadAndSend(): Promise<void> {
      // Gera nome de arquivo com extensão correta
      const ext = mime.includes('ogg') ? 'ogg' : 'webm';
      const file = new File([blob], `audio.${ext}`, { type: mime });

      let uploadResult: Awaited<ReturnType<typeof upload>>;
      try {
        uploadResult = await upload(file);
      } catch {
        // Erro já refletido em progress.error — componente exibe inline
        return;
      }

      const idempotencyKey = crypto.randomUUID();
      sendMutation.mutate(
        {
          type: 'media',
          mediaKind: 'audio',
          publicMediaUrl: uploadResult.publicMediaUrl,
          mime: uploadResult.mime,
          fileName: uploadResult.fileName,
          idempotencyKey,
        },
        {
          onSuccess: () => {
            onSent();
          },
        },
      );
    }

    void uploadAndSend();
  }, [state.phase]);

  // Cleanup de upload ao desmontar (se cancelar durante upload)
  React.useEffect(() => {
    return () => {
      abort();
    };
  }, []);

  // ── Permission denied ───────────────────────────────────────────────────────

  if (state.phase === 'permission_denied') {
    return (
      <div className="flex items-center gap-3 px-3 py-2">
        <p className="flex-1 font-sans text-sm text-danger" role="alert" aria-live="polite">
          Permissão de microfone negada. Habilite nas configurações do navegador.
        </p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Fechar aviso de permissão"
          className={cn(
            'shrink-0 font-sans text-xs text-ink-3 underline',
            'hover:text-ink transition-colors duration-fast ease',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
          )}
        >
          Fechar
        </button>
      </div>
    );
  }

  // ── Stopped / uploading ─────────────────────────────────────────────────────

  if (state.phase === 'stopped') {
    return (
      <div className="flex items-center gap-3 px-3 py-2" aria-label="Enviando áudio...">
        {/* Indicador REC */}
        <span className="shrink-0 font-mono text-xs text-ink-3">
          {formatDuration(state.duration)}
        </span>

        {/* Barra de progresso de upload */}
        <div className="flex-1 flex flex-col gap-1">
          <div
            className="h-1.5 rounded-full bg-surface-3 overflow-hidden"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Upload do áudio: ${progress.percent}%`}
          >
            <div
              className="h-full rounded-full [background:var(--grad-azul)] transition-[width] duration-150"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          {/* Erro de upload */}
          {progress.phase === 'error' && progress.error && (
            <p className="font-sans text-xs text-danger" role="alert">
              {progress.error}
            </p>
          )}
        </div>

        {/* Botão cancelar (desabilitado durante upload ativo) */}
        <button
          type="button"
          onClick={onCancel}
          disabled={isBusy}
          aria-label="Cancelar envio de áudio"
          className={cn(
            'shrink-0 w-9 h-9 flex items-center justify-center rounded-sm',
            'text-ink-3 transition-colors duration-fast ease',
            'hover:bg-surface-hover hover:text-danger',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
            'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
          )}
        >
          <IconTrash />
        </button>
      </div>
    );
  }

  // ── Recording (estado principal) ────────────────────────────────────────────

  const amplitude = state.phase === 'recording' ? state.amplitude : 0;
  const startedAt = state.phase === 'recording' ? state.startedAt : Date.now();

  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      role="region"
      aria-label="Gravação de áudio em andamento"
    >
      {/* Botão cancelar */}
      <button
        type="button"
        onClick={() => {
          cancel();
          onCancel();
        }}
        aria-label="Cancelar gravação"
        className={cn(
          'shrink-0 w-9 h-9 flex items-center justify-center rounded-sm',
          'text-ink-3 transition-colors duration-fast ease',
          'hover:bg-surface-hover hover:text-danger',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
          'active:bg-surface-muted',
        )}
      >
        <IconTrash />
      </button>

      {/* Indicador REC + timer */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Ponto vermelho pulsante */}
        <span className="w-2 h-2 rounded-full bg-danger animate-pulse" aria-hidden="true" />
        <LiveTimer startedAt={startedAt} />
      </div>

      {/* Barra de amplitude */}
      <div className="flex-1 h-4 bg-surface-3 rounded-full overflow-hidden" aria-hidden="true">
        <div
          className="h-full rounded-full bg-danger transition-[width] duration-75"
          style={{ width: `${Math.max(amplitude, 4)}%` }}
        />
      </div>

      {/* Botão enviar */}
      <button
        type="button"
        onClick={stop}
        aria-label="Enviar áudio gravado"
        className={cn(
          'shrink-0 w-9 h-9 flex items-center justify-center rounded-sm',
          'transition-[transform,box-shadow,background] duration-fast ease',
          '[background:var(--grad-azul)] text-white',
          '[box-shadow:var(--elev-2),inset_0_1px_0_rgba(255,255,255,0.15)]',
          'hover:-translate-y-0.5',
          'hover:[box-shadow:var(--glow-azul),inset_0_1px_0_rgba(255,255,255,0.2)]',
          'active:translate-y-0',
          'active:[box-shadow:var(--elev-1),inset_0_2px_4px_rgba(0,0,0,0.2)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/30',
        )}
      >
        <IconCheck />
      </button>
    </div>
  );
}
