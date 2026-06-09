// =============================================================================
// features/help/contextual/ContextualHelpDrawer.tsx
//
// Drawer global de ajuda contextual (singleton montado em AppLayout).
//
// Norma 21 §7:
//   - Exibe: título + <VideoTutorial eager> + description + "Ver guia completo".
//   - "Ver guia completo" navega para /ajuda/<articleSlug>:
//       • Nova aba se houver formulário não salvo (data-unsaved global).
//       • Navegação in-app via useNavigate() caso contrário.
//   - Acessível: foco automático ao abrir, Esc fecha, aria-label, role=dialog.
//
// Design System (norma 18):
//   - Posição: direita, largura 400px (md+), 100% em mobile.
//   - box-shadow: var(--elev-5) — nível modal.
//   - bg: var(--bg-elev-1).
//   - border-left: 1px solid var(--border).
//   - border-radius no topo esquerdo: var(--radius-lg).
//   - Overlay semitransparente (backdrop) fecha ao clicar fora.
//   - Transição: translateX 250ms --ease-out.
//   - Header: Bricolage 700, text-xl, tracking -0.028em.
//   - Body: Geist 400, text-sm, --text-2.
//   - Botão primário: azul, hover glow, DS §9.1.
//
// O drawer NÃO tem scroll próprio — o conteúdo (vídeo + texto) cabe na
// viewport em qualquer dispositivo (max-height com overflow-y: auto interno).
// =============================================================================

import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { VideoTutorial } from '../mdx-components/VideoTutorial';

import { useContextualHelpStore } from './contextual-help-store';

// ─── Ícone X (fechar) ────────────────────────────────────────────────────────

function IconClose(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      aria-hidden="true"
      style={{ width: 20, height: 20, display: 'block' }}
    >
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}

// ─── Ícone external link ──────────────────────────────────────────────────────

function IconExternalLink(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      style={{ width: 14, height: 14, display: 'block', flexShrink: 0 }}
    >
      <path d="M6 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" strokeLinecap="round" />
      <path d="M9 2h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 2L8 8" strokeLinecap="round" />
    </svg>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Detecta se há formulário não salvo na página atual.
 * Convenção: qualquer elemento com [data-unsaved="true"] na página.
 * Fallback conservador: false (navega in-app).
 */
function hasUnsavedForm(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[data-unsaved="true"]') !== null;
}

// ─── Drawer ──────────────────────────────────────────────────────────────────

/**
 * Drawer global de ajuda contextual.
 *
 * Deve ser montado UMA ÚNICA VEZ em AppLayout.
 * Controle via useContextualHelpStore (Zustand).
 */
export function ContextualHelpDrawer(): React.JSX.Element {
  const { open, activeTutorial, closeDrawer } = useContextualHelpStore();
  const navigate = useNavigate();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const drawerRef = React.useRef<HTMLDivElement>(null);

  // Foco automático ao abrir — fecha com Esc.
  React.useEffect(() => {
    if (open && closeButtonRef.current) {
      // Pequeno delay para a transição CSS ter iniciado antes do foco.
      const id = setTimeout(() => closeButtonRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Esc fecha.
  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        closeDrawer();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeDrawer]);

  // Trap focus dentro do drawer quando aberto.
  React.useEffect(() => {
    if (!open || !drawerRef.current) return;

    const el = drawerRef.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleTab(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return;
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  function handleGuideClick(): void {
    if (!activeTutorial?.articleSlug) return;
    const slug = activeTutorial.articleSlug;
    closeDrawer();
    if (hasUnsavedForm()) {
      window.open(`/ajuda/${slug}`, '_blank', 'noopener,noreferrer');
    } else {
      void navigate(`/ajuda/${slug}`);
    }
  }

  // ── Provider type guard ────────────────────────────────────────────────────
  type VideoProviderType = 'youtube' | 'vimeo' | 'mp4';
  function isVideoProvider(value: string): value is VideoProviderType {
    return value === 'youtube' || value === 'vimeo' || value === 'mp4';
  }

  return (
    <>
      {/* Keyframes de abertura */}
      <style>{`
        @keyframes ch-drawer-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes ch-drawer-out {
          from { transform: translateX(0);    opacity: 1; }
          to   { transform: translateX(100%); opacity: 0; }
        }
        @keyframes ch-overlay-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>

      {/* Overlay — fecha ao clicar fora */}
      {open && (
        <div
          role="presentation"
          aria-hidden="true"
          onClick={closeDrawer}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 49,
            background: 'rgba(10,18,40,0.35)',
            backdropFilter: 'blur(3px)',
            animation: 'ch-overlay-in 200ms cubic-bezier(0.16,1,0.3,1) forwards',
          }}
        />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={activeTutorial ? `Ajuda: ${activeTutorial.title}` : 'Ajuda contextual'}
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'clamp(320px, 28vw, 440px)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-elev-1)',
          borderLeft: '1px solid var(--border)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderBottomLeftRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elev-5)',
          // Transição via animation ao abrir/fechar.
          animation: open
            ? 'ch-drawer-in 250ms cubic-bezier(0.16,1,0.3,1) forwards'
            : 'ch-drawer-out 200ms cubic-bezier(0.16,1,0.3,1) forwards',
          // Oculto no DOM mas com visibility:hidden quando fechado (preserva foco no conteúdo principal).
          visibility: open ? 'visible' : 'hidden',
          pointerEvents: open ? 'auto' : 'none',
        }}
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '0.75rem',
            padding: '1.25rem 1.25rem 0',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Eyebrow label */}
            <p
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.6875rem',
                fontWeight: 700,
                letterSpacing: '0.07em',
                textTransform: 'uppercase',
                color: 'var(--brand-azul)',
                marginBottom: '0.25rem',
              }}
            >
              Tutorial
            </p>
            {/* Título principal */}
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 700,
                fontSize: '1.125rem',
                lineHeight: 1.25,
                letterSpacing: '-0.028em',
                color: 'var(--text)',
                margin: 0,
                // Trunca em 2 linhas.
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {activeTutorial?.title ?? ''}
            </h2>
          </div>

          {/* Botão fechar */}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeDrawer}
            aria-label="Fechar ajuda"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2rem',
              height: '2rem',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--text-3)',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'color 150ms, background 150ms',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)';
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
              (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
            }}
          >
            <IconClose />
          </button>
        </div>

        {/* Divisor */}
        <div
          style={{
            height: 1,
            background: 'var(--border-subtle)',
            margin: '1rem 0 0',
            flexShrink: 0,
          }}
          aria-hidden="true"
        />

        {/* ── Corpo (scrollável) ────────────────────────────────────────── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 1.25rem 1.5rem',
            // Scroll suave.
            scrollBehavior: 'smooth',
          }}
        >
          {/* Vídeo — eager=true: o drawer já está visível ao montar. */}
          {activeTutorial && isVideoProvider(activeTutorial.provider) && (
            <VideoTutorial
              provider={activeTutorial.provider}
              videoRef={activeTutorial.videoRef}
              hash={activeTutorial.hash}
              title={activeTutorial.title}
              eager
            />
          )}

          {/* Descrição */}
          {activeTutorial?.description && (
            <p
              style={{
                fontFamily: 'var(--font-ui)',
                fontSize: '0.875rem',
                lineHeight: 1.6,
                color: 'var(--text-2)',
                margin: '0 0 1.25rem',
              }}
            >
              {activeTutorial.description}
            </p>
          )}
        </div>

        {/* ── Footer com CTA ────────────────────────────────────────────── */}
        {activeTutorial?.articleSlug && (
          <div
            style={{
              flexShrink: 0,
              padding: '0.875rem 1.25rem 1.25rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <button
              type="button"
              onClick={handleGuideClick}
              aria-label={`Ver guia completo: ${activeTutorial.title}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.375rem',
                width: '100%',
                padding: '0.625rem 1.375rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--brand-azul)',
                color: 'var(--text-on-brand)',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: '0.875rem',
                fontWeight: 600,
                letterSpacing: '-0.005em',
                // DS §9.1: inset highlight superior.
                boxShadow: 'var(--elev-2), inset 0 1px 0 rgba(255,255,255,0.15)',
                transition: 'transform 150ms cubic-bezier(0.16,1,0.3,1), box-shadow 150ms',
              }}
              onMouseEnter={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.transform = 'translateY(-2px)';
                btn.style.background = 'var(--brand-azul-deep)';
                btn.style.boxShadow =
                  'var(--elev-3), inset 0 1px 0 rgba(255,255,255,0.15), 0 0 0 4px rgba(27,58,140,0.15)';
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.transform = 'translateY(0)';
                btn.style.background = 'var(--brand-azul)';
                btn.style.boxShadow = 'var(--elev-2), inset 0 1px 0 rgba(255,255,255,0.15)';
              }}
              onMouseDown={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.transform = 'translateY(0)';
                btn.style.boxShadow = 'var(--elev-1), inset 0 1px 2px rgba(20,33,61,0.12)';
              }}
              onMouseUp={(e) => {
                const btn = e.currentTarget as HTMLButtonElement;
                btn.style.transform = 'translateY(-2px)';
                btn.style.boxShadow =
                  'var(--elev-3), inset 0 1px 0 rgba(255,255,255,0.15), 0 0 0 4px rgba(27,58,140,0.15)';
              }}
            >
              Ver guia completo
              <IconExternalLink />
            </button>
          </div>
        )}
      </div>
    </>
  );
}
