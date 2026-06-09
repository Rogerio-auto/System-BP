/**
 * VideoTutorial — componente provider-aware para tutoriais em vídeo.
 *
 * Norma 21 §6. Realiza o <VideoEmbed> reservado pela norma 20 §6.
 * Não criar dois componentes — este é o único.
 *
 * MVP: provider="youtube" via youtube-nocookie.com (iframe nativo, sem dependência
 * extra). Vimeo e MP4 preparados na interface mas marcados como "upgrade futuro".
 *
 * Lazy-load: o iframe só é injetado no DOM quando o wrapper entra no viewport
 * (IntersectionObserver) ou quando `eager` é passado explicitamente (drawer abre
 * o componente já visível — F12-S04 pode passar eager=true).
 *
 * Design System (norma 18):
 *   - aspect-ratio 16:9 (wrapper padding-top 56.25%)
 *   - border: 1px solid var(--border)
 *   - border-radius: var(--radius-md)
 *   - box-shadow: var(--elev-2)
 *   - skeleton no estado pré-load (bg-elev-2 + shimmer)
 *   - Sem autoplay.
 *   - title em aria-label + <iframe title>.
 */

import * as React from 'react';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type VideoProvider = 'youtube' | 'vimeo' | 'mp4';

export interface VideoTutorialProps {
  /** Provider do vídeo. MVP suporta "youtube"; vimeo/mp4 preparados. */
  provider: VideoProvider;
  /**
   * Identificador do vídeo no provider.
   * - youtube: ID do vídeo (ex.: "dQw4w9WgXcQ")
   * - vimeo:   ID numérico do vídeo (ex.: "123456789")
   * - mp4:     URL absoluta ou relativa do arquivo (ex.: "/videos/criar-lead.mp4")
   */
  videoRef: string;
  /**
   * Hash de privacidade do Vimeo (parâmetro `h`).
   * Obrigatório para vídeos Vimeo com privacy=hide-from-vimeo.
   */
  hash?: string;
  /** Título exibido no aria-label e no title do iframe. */
  title?: string;
  /**
   * Força carregamento imediato (sem IntersectionObserver).
   * Use true quando o componente já está visível ao ser montado (ex.: drawer aberto).
   */
  eager?: boolean;
  /** Chamado na primeira reprodução (proxy via postMessage para YouTube). */
  onPlay?: () => void;
  /** Chamado quando o vídeo termina (proxy via postMessage para YouTube). */
  onEnded?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers de URL
// ---------------------------------------------------------------------------

function buildYouTubeUrl(videoRef: string): string {
  const params = new URLSearchParams({
    // Sem autoplay — norma 21 §6.
    rel: '0',
    modestbranding: '1',
    // enablejsapi=1 para capturar eventos via postMessage.
    enablejsapi: '1',
    // origin será validado pelo browser automaticamente.
  });
  return `https://www.youtube-nocookie.com/embed/${videoRef}?${params.toString()}`;
}

function buildVimeoUrl(videoRef: string, hash?: string): string {
  const params = new URLSearchParams({ autopause: '1' });
  if (hash) params.set('h', hash);
  return `https://player.vimeo.com/video/${videoRef}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Skeleton (estado pré-load)
// ---------------------------------------------------------------------------

function VideoSkeleton(): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        background: 'var(--bg-elev-2)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      {/* Shimmer overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%)',
          backgroundSize: '200% 100%',
          animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
        }}
      />
      {/* Ícone play centralizado */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          viewBox="0 0 48 48"
          fill="none"
          style={{ width: 48, height: 48, opacity: 0.2 }}
          aria-hidden="true"
        >
          <circle cx="24" cy="24" r="23" stroke="var(--text)" strokeWidth="2" />
          <path d="M19 14l18 10-18 10V14z" fill="var(--text)" />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player YouTube (iframe nativo, sem lib)
// ---------------------------------------------------------------------------

interface YouTubePlayerProps {
  videoRef: string;
  title: string;
  onPlay: (() => void) | undefined;
  onEnded: (() => void) | undefined;
}

function YouTubePlayer({
  videoRef,
  title,
  onPlay,
  onEnded,
}: YouTubePlayerProps): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  // Escuta mensagens postMessage da API YT iFrame (YT.PlayerState).
  React.useEffect(() => {
    if (!onPlay && !onEnded) return;

    function handleMessage(event: MessageEvent): void {
      // YouTube envia JSON ou string JSON.
      if (!event.data) return;
      let data: unknown;
      try {
        data = typeof event.data === 'string' ? (JSON.parse(event.data) as unknown) : event.data;
      } catch {
        return;
      }
      if (typeof data !== 'object' || data === null) return;
      const msg = data as Record<string, unknown>;
      if (msg['event'] !== 'onStateChange') return;
      const info = msg['info'];
      // YT.PlayerState.PLAYING = 1, ENDED = 0
      if (info === 1 && onPlay) onPlay();
      if (info === 0 && onEnded) onEnded();
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onPlay, onEnded]);

  return (
    <iframe
      ref={iframeRef}
      src={buildYouTubeUrl(videoRef)}
      title={title}
      aria-label={title}
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      loading="lazy"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        borderRadius: 'var(--radius-md)',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Player Vimeo — preparado para upgrade futuro, não depende de SDK externo
// ---------------------------------------------------------------------------

interface VimeoPlayerProps {
  videoRef: string;
  hash: string | undefined;
  title: string;
}

function VimeoPlayer({ videoRef, hash, title }: VimeoPlayerProps): React.JSX.Element {
  return (
    <iframe
      src={buildVimeoUrl(videoRef, hash)}
      title={title}
      aria-label={title}
      allow="autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      loading="lazy"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 'none',
        borderRadius: 'var(--radius-md)',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Player MP4 — elemento <video> nativo
// ---------------------------------------------------------------------------

interface Mp4PlayerProps {
  videoRef: string;
  title: string;
  onPlay: (() => void) | undefined;
  onEnded: (() => void) | undefined;
}

function Mp4Player({ videoRef, title, onPlay, onEnded }: Mp4PlayerProps): React.JSX.Element {
  return (
    <video
      src={videoRef}
      title={title}
      aria-label={title}
      controls
      preload="metadata"
      onPlay={onPlay}
      onEnded={onEnded}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        borderRadius: 'var(--radius-md)',
        background: 'var(--bg-inset)',
        objectFit: 'contain',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// VideoTutorial — componente raiz
// ---------------------------------------------------------------------------

/**
 * Renderiza um tutorial em vídeo provider-aware com lazy-load,
 * skeleton durante carregamento e respeito total ao Design System.
 *
 * @example
 * <VideoTutorial provider="youtube" videoRef="abc123" title="Como criar um lead" />
 * <VideoTutorial provider="vimeo" videoRef="987654" hash="xyz" />
 * <VideoTutorial provider="mp4" videoRef="/videos/criar-lead.mp4" />
 */
export function VideoTutorial({
  provider,
  videoRef,
  hash,
  title = 'Tutorial em vídeo',
  eager = false,
  onPlay,
  onEnded,
}: VideoTutorialProps): React.JSX.Element {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState<boolean>(eager);

  // IntersectionObserver — carrega o player só quando entra no viewport.
  React.useEffect(() => {
    if (eager || visible) return;

    const el = wrapperRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry && entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, visible]);

  return (
    <>
      {/* Keyframes de shimmer — injetados inline uma vez */}
      <style>{`
        @keyframes skeleton-shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>

      {/* Wrapper com aspect-ratio 16:9 via padding-top trick */}
      <div
        ref={wrapperRef}
        role="figure"
        aria-label={title}
        style={{
          position: 'relative',
          width: '100%',
          paddingTop: '56.25%' /* 16:9 */,
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          boxShadow: 'var(--elev-2)',
          overflow: 'hidden',
          background: 'var(--bg-elev-2)',
          marginTop: '1.25rem',
          marginBottom: '1.25rem',
        }}
      >
        {/* Skeleton exibido enquanto iframe/video não foi injetado */}
        {!visible && <VideoSkeleton />}

        {/* Player — só montado quando visible=true */}
        {visible && provider === 'youtube' && (
          <YouTubePlayer videoRef={videoRef} title={title} onPlay={onPlay} onEnded={onEnded} />
        )}

        {visible && provider === 'vimeo' && (
          <VimeoPlayer videoRef={videoRef} hash={hash} title={title} />
        )}

        {visible && provider === 'mp4' && (
          <Mp4Player videoRef={videoRef} title={title} onPlay={onPlay} onEnded={onEnded} />
        )}
      </div>
    </>
  );
}
