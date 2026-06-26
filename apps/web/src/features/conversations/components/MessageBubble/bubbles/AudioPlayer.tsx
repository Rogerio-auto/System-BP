// =============================================================================
// bubbles/AudioPlayer.tsx — Player de áudio custom estilo WhatsApp.
//
// - Botão play/pause circular.
// - Waveform real: peaks computados do próprio áudio (Web Audio API) com
//   fallback estático se o decode falhar (codec não suportado / CORS).
// - Seek clicando/arrastando na onda; barras "tocadas" coloridas.
// - Tempo decorrido (mostra duração total quando parado) + velocidade 1x/1.5x/2x.
//
// Robustez:
//   - duration Infinity (comum em webm/opus do MediaRecorder) é resolvido com o
//     hack de currentTime=1e101 forçando o browser a calcular a duração real.
//   - decodeAudioData roda 1x por src; erros caem no waveform de fallback.
//
// DS: tokens canônicos (var(--brand-azul), ink). Light + dark.
// =============================================================================

import * as React from 'react';

const BARS = 40;

// Waveform de fallback (padrão agradável e determinístico) quando o decode falha.
const FALLBACK_PEAKS: number[] = [
  0.2, 0.35, 0.5, 0.4, 0.65, 0.8, 0.55, 0.7, 0.45, 0.6, 0.85, 0.5, 0.3, 0.45, 0.7, 0.9, 0.6, 0.4,
  0.55, 0.75, 1.0, 0.7, 0.5, 0.65, 0.45, 0.6, 0.8, 0.55, 0.35, 0.5, 0.7, 0.45, 0.6, 0.3, 0.5, 0.65,
  0.4, 0.55, 0.3, 0.25,
];

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Decodifica o áudio e reduz para `bars` picos normalizados (0.08–1). */
async function computePeaks(url: string, bars: number): Promise<number[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const Ctx = window.AudioContext;
  const ctx = new Ctx();
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf);
    const data = audioBuf.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / bars));
    const peaks: number[] = [];
    for (let i = 0; i < bars; i++) {
      let sum = 0;
      const start = i * block;
      for (let j = 0; j < block; j++) sum += Math.abs(data[start + j] ?? 0);
      peaks.push(sum / block);
    }
    const max = Math.max(...peaks, 0.0001);
    return peaks.map((p) => Math.max(0.08, p / max));
  } finally {
    void ctx.close();
  }
}

interface AudioPlayerProps {
  src: string;
  isOutbound: boolean;
}

export function AudioPlayer({ src, isOutbound }: AudioPlayerProps): React.JSX.Element {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const waveRef = React.useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [peaks, setPeaks] = React.useState<number[]>(FALLBACK_PEAKS);
  const [rate, setRate] = React.useState(1);

  // Computa o waveform real (1x por src).
  React.useEffect(() => {
    let alive = true;
    computePeaks(src, BARS)
      .then((p) => {
        if (alive) setPeaks(p);
      })
      .catch(() => {
        if (alive) setPeaks(FALLBACK_PEAKS);
      });
    return () => {
      alive = false;
    };
  }, [src]);

  // Resolve duration Infinity (webm/opus do MediaRecorder).
  function handleLoadedMetadata(): void {
    const a = audioRef.current;
    if (!a) return;
    if (a.duration === Infinity || Number.isNaN(a.duration)) {
      const onSeeked = (): void => {
        a.currentTime = 0;
        setDuration(Number.isFinite(a.duration) ? a.duration : 0);
        a.removeEventListener('timeupdate', onSeeked);
      };
      a.addEventListener('timeupdate', onSeeked);
      a.currentTime = 1e101;
    } else {
      setDuration(a.duration);
    }
  }

  function toggle(): void {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play();
    else a.pause();
  }

  function cycleRate(): void {
    const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  function seekFromEvent(clientX: number): void {
    const el = waveRef.current;
    const a = audioRef.current;
    if (!el || !a || !Number.isFinite(duration) || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    a.currentTime = frac * duration;
    setCurrent(frac * duration);
  }

  const progress = duration > 0 ? current / duration : 0;
  const playedBars = Math.round(progress * BARS);

  // Cores por direção (DS).
  const accent = 'var(--brand-azul)';
  const mutedBar = isOutbound
    ? 'color-mix(in srgb, var(--brand-azul) 28%, transparent)'
    : 'color-mix(in srgb, var(--ink-3) 38%, transparent)';

  return (
    <div className="flex items-center gap-2.5 min-w-[230px] select-none">
      {/* Play / Pause */}
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
        className="shrink-0 grid place-items-center w-9 h-9 rounded-full text-white transition-transform active:scale-95"
        style={{ background: accent, boxShadow: 'var(--elev-1)' }}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
            <path d="M8 5.5v13l11-6.5-11-6.5z" />
          </svg>
        )}
      </button>

      {/* Waveform + tempo */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div
          ref={waveRef}
          onClick={(e) => seekFromEvent(e.clientX)}
          className="flex items-center gap-[2px] h-7 cursor-pointer"
          role="slider"
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
          tabIndex={0}
        >
          {peaks.map((p, i) => (
            <span
              key={i}
              className="flex-1 rounded-full transition-colors"
              style={{
                height: `${Math.max(10, p * 100)}%`,
                minWidth: '2px',
                background: i < playedBars ? accent : mutedBar,
              }}
            />
          ))}
        </div>
        <div className="flex items-center justify-between">
          <time className="font-sans text-[11px] text-ink-3 tabular-nums">
            {fmt(playing || current > 0 ? current : duration)}
          </time>
          <button
            type="button"
            onClick={cycleRate}
            aria-label="Velocidade de reprodução"
            className="font-sans text-[11px] font-semibold text-ink-3 hover:text-ink tabular-nums px-1.5 py-0.5 rounded transition-colors"
            style={{ background: 'color-mix(in srgb, var(--ink-3) 12%, transparent)' }}
          >
            {rate}×
          </button>
        </div>
      </div>

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={() => setCurrent(audioRef.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        className="hidden"
      >
        Seu navegador não suporta reprodução de áudio.
      </audio>
    </div>
  );
}
