// =============================================================================
// features/conversations/hooks/useAudioRecorder.ts — Gravação de áudio PTT.
//
// Fluxo:
//   start() → getUserMedia → AudioContext+AnalyserNode+MediaRecorder →
//   loop rAF de amplitude → (max 5 min) → stop()/cancel()
//
// Formatos suportados (em ordem de preferência):
//   audio/webm;codecs=opus (Chrome/Edge) → audio/ogg;codecs=opus (Firefox) → '' (fallback)
//
// LGPD (doc 17):
//   - Áudio gravado apenas em memória (Blob) — nunca persistido localmente.
//   - Stream de mídia é encerrado imediatamente após stop/cancel.
// =============================================================================

import * as React from 'react';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type RecordingState =
  | { phase: 'idle' }
  | { phase: 'permission_denied' }
  | { phase: 'recording'; startedAt: number; amplitude: number }
  | { phase: 'stopped'; blob: Blob; mime: string; duration: number };

export interface UseAudioRecorderReturn {
  state: RecordingState;
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  analyserRef: React.RefObject<AnalyserNode | null>;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Duração máxima de gravação em ms (5 minutos). */
const MAX_DURATION_MS = 5 * 60 * 1000;

/** Preferência de MIME types para MediaRecorder. */
const MIME_PREFERENCE = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', ''] as const;

function chooseMimeType(): string {
  for (const mime of MIME_PREFERENCE) {
    if (mime === '') return ''; // deixa o browser decidir
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useAudioRecorder — encapsula captura de microfone, análise de amplitude e
 * gravação via MediaRecorder. Ciclo de vida gerenciado por start/stop/cancel.
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [state, setState] = React.useState<RecordingState>({ phase: 'idle' });

  // Refs internos — não causam re-render
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const analyserRef = React.useRef<AnalyserNode | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const startedAtRef = React.useRef<number>(0);
  const rafIdRef = React.useRef<number | null>(null);
  const maxTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Controle de cancelamento — evita setar "stopped" após cancel
  const cancelledRef = React.useRef(false);

  // ── Helpers internos ────────────────────────────────────────────────────────

  function stopStream(): void {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function stopAudioContext(): void {
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      void audioCtxRef.current.close();
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }

  function stopRaf(): void {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }

  function stopMaxTimer(): void {
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }

  // ── Amplitude loop via rAF ──────────────────────────────────────────────────

  function startAmplitudeLoop(analyser: AnalyserNode, startedAt: number): void {
    const bufferLength = analyser.fftSize;
    const dataArray = new Uint8Array(bufferLength);

    function tick(): void {
      analyser.getByteTimeDomainData(dataArray);

      // Calcula o pico de amplitude normalizado (0-100)
      let peak = 0;
      for (let i = 0; i < bufferLength; i++) {
        // Cada valor é 0-255; 128 é silêncio
        const v = Math.abs((dataArray[i] ?? 128) - 128);
        if (v > peak) peak = v;
      }
      const amplitude = Math.min(Math.round((peak / 128) * 100), 100);

      setState({ phase: 'recording', startedAt, amplitude });
      rafIdRef.current = requestAnimationFrame(tick);
    }

    rafIdRef.current = requestAnimationFrame(tick);
  }

  // ── start ───────────────────────────────────────────────────────────────────

  const start = React.useCallback(async (): Promise<void> => {
    cancelledRef.current = false;

    // Solicita permissão de microfone
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState({ phase: 'permission_denied' });
      return;
    }

    // AudioContext + AnalyserNode para amplitude em tempo real
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(analyser);

    streamRef.current = stream;
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;
    chunksRef.current = [];

    // Escolhe MIME type e cria MediaRecorder
    const mimeType = chooseMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      // Limpar recursos de stream/audio
      stopStream();
      stopAudioContext();
      stopRaf();
      stopMaxTimer();

      if (cancelledRef.current) {
        // Cancel foi chamado — volta ao idle
        setState({ phase: 'idle' });
        return;
      }

      const duration = Date.now() - startedAtRef.current;
      const finalMime = recorder.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type: finalMime });
      chunksRef.current = [];

      setState({ phase: 'stopped', blob, mime: finalMime, duration });
    };

    // Inicia gravação
    const startedAt = Date.now();
    startedAtRef.current = startedAt;
    recorder.start(100); // Coleta chunks a cada 100ms

    // Estado inicial de recording
    setState({ phase: 'recording', startedAt, amplitude: 0 });

    // Loop de amplitude
    startAmplitudeLoop(analyser, startedAt);

    // Limite de 5 minutos
    maxTimerRef.current = setTimeout(() => {
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    }, MAX_DURATION_MS);
  }, []);

  // ── stop ────────────────────────────────────────────────────────────────────

  const stop = React.useCallback((): void => {
    cancelledRef.current = false;
    stopRaf();
    stopMaxTimer();
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      // Não estava gravando — limpa diretamente
      stopStream();
      stopAudioContext();
    }
  }, []);

  // ── cancel ──────────────────────────────────────────────────────────────────

  const cancel = React.useCallback((): void => {
    cancelledRef.current = true;
    stopRaf();
    stopMaxTimer();
    chunksRef.current = [];
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      stopStream();
      stopAudioContext();
      setState({ phase: 'idle' });
    }
  }, []);

  // ── Cleanup no unmount ──────────────────────────────────────────────────────

  React.useEffect(() => {
    return () => {
      cancelledRef.current = true;
      stopRaf();
      stopMaxTimer();
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      stopStream();
      stopAudioContext();
    };
  }, []);

  return { state, start, stop, cancel, analyserRef };
}
