// =============================================================================
// features/assistant/InternalAssistantButton.tsx — Botão do Assistente IA interno.
//
// Doc 05 §7: "Assistente IA interno (visível-mas-desabilitado no MVP)".
// Aqui entregamos a SUPERFÍCIE: um botão na Topbar que abre um popover de teaser
// deixando explícito que o recurso está em desenvolvimento. A conversa real com o
// grafo `internal_assistant` (flag ai.internal_assistant.enabled) será implementada
// depois — este componente é o ponto de entrada visível.
// =============================================================================

import * as React from 'react';

/** Ícone de "sparkle" (IA). */
function SparkleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 2.5l1.6 4.1 4.1 1.6-4.1 1.6L10 14l-1.6-4.2L4.3 8.2l4.1-1.6L10 2.5z" />
      <path d="M15.5 12.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  );
}

/**
 * Botão do Assistente interno na Topbar + popover de teaser ("em desenvolvimento").
 * Fecha ao clicar fora ou Escape.
 */
export function InternalAssistantButton(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Assistente interno (em desenvolvimento)"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-sm transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
        style={{
          height: 32,
          paddingLeft: 'var(--space-2)',
          paddingRight: 'var(--space-2)',
          color: open ? 'var(--brand-azul)' : 'var(--text-3)',
          background: open
            ? 'color-mix(in srgb, var(--brand-azul) 10%, transparent)'
            : 'transparent',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.color = 'var(--text)';
            (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
            (e.currentTarget as HTMLElement).style.background = 'transparent';
          }
        }}
      >
        <SparkleIcon className="w-[18px] h-[18px] shrink-0" />
        <span className="hidden md:inline font-sans" style={{ fontSize: 'var(--text-sm)' }}>
          Assistente
        </span>
        <span
          className="hidden sm:inline font-sans font-semibold uppercase"
          style={{
            fontSize: '9px',
            letterSpacing: '0.06em',
            lineHeight: 1,
            padding: '2px 5px',
            borderRadius: 'var(--radius-pill)',
            color: 'var(--verde)',
            background: 'color-mix(in srgb, var(--verde) 14%, transparent)',
          }}
        >
          em breve
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Assistente interno"
          className="absolute right-0 top-full mt-2 z-50 rounded-md overflow-hidden"
          style={{
            width: 300,
            background: 'var(--bg-elev-1)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--elev-3)',
          }}
        >
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span
              className="inline-flex items-center justify-center shrink-0"
              style={{
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                color: 'var(--brand-azul)',
                background: 'color-mix(in srgb, var(--brand-azul) 12%, transparent)',
              }}
            >
              <SparkleIcon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p
                className="font-sans font-semibold text-ink leading-tight"
                style={{ fontSize: 'var(--text-sm)' }}
              >
                Assistente interno
              </p>
              <p
                className="font-sans font-semibold uppercase"
                style={{ fontSize: '9px', letterSpacing: '0.08em', color: 'var(--verde)' }}
              >
                Em desenvolvimento
              </p>
            </div>
          </div>

          <div className="px-4 py-3">
            <p
              className="font-sans"
              style={{ fontSize: 'var(--text-sm)', color: 'var(--text-2)', lineHeight: 1.5 }}
            >
              Em breve você poderá perguntar sobre seus dados operacionais em linguagem natural —
              leads, cobranças, simulações — respeitando suas permissões e escopo de cidade.
            </p>
            <div
              className="mt-3 flex items-center gap-2 px-3 py-2 rounded-sm"
              style={{
                border: '1px dashed var(--border)',
                color: 'var(--text-3)',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-sans)',
              }}
              aria-hidden="true"
            >
              <SparkleIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Pergunte ao assistente…</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
