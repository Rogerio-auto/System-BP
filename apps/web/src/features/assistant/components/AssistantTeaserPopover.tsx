// =============================================================================
// features/assistant/components/AssistantTeaserPopover.tsx — Popover de teaser
// ("em breve") exibido quando o usuário não tem flag + permissão para o chat
// real do copiloto interno. Comportamento original de F1 (placeholder honesto).
// =============================================================================

import * as React from 'react';

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

export function AssistantTeaserPopover(): React.JSX.Element {
  return (
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
          Em breve você poderá perguntar sobre seus dados operacionais em linguagem natural — leads,
          cobranças, simulações — respeitando suas permissões e escopo de cidade.
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
  );
}
