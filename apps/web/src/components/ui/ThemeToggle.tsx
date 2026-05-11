import * as React from 'react';

import { useTheme } from '../../app/ThemeProvider';
import { cn } from '../../lib/cn';

// Ícones SVG inline (14×14) — sem dependência de biblioteca de ícones
function SunIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      className="w-[14px] h-[14px]"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
      className="w-[14px] h-[14px]"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

/**
 * Pill com 2 botões (Claro / Escuro) conforme .theme-toggle do HTML de referência.
 * Botão ativo: bg --brand-azul, texto on-brand, shadow-e2.
 * Botão inativo: transparente, texto ink-3, hover text-ink.
 * Área clicável mínima garantida pelo padding interno (WCAG 2.5.5).
 */
export function ThemeToggle({ className }: { className?: string }): React.JSX.Element {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Alternância de tema"
      className={cn(
        'inline-flex items-center gap-0',
        'bg-surface-1 border border-border rounded-pill p-1',
        'shadow-e2',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        aria-label="Tema claro"
        className={cn(
          'inline-flex items-center gap-1.5',
          'px-4 py-2 rounded-pill',
          'font-sans text-xs font-semibold tracking-[0.08em] uppercase',
          'transition-all duration-fast ease',
          'min-h-[32px]',
          theme === 'light'
            ? 'bg-azul text-[var(--text-on-brand)] shadow-e2'
            : 'bg-transparent text-ink-3 hover:text-ink',
        )}
      >
        <SunIcon />
        Claro
      </button>

      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        aria-label="Tema escuro"
        className={cn(
          'inline-flex items-center gap-1.5',
          'px-4 py-2 rounded-pill',
          'font-sans text-xs font-semibold tracking-[0.08em] uppercase',
          'transition-all duration-fast ease',
          'min-h-[32px]',
          theme === 'dark'
            ? 'bg-azul text-[var(--text-on-brand)] shadow-e2'
            : 'bg-transparent text-ink-3 hover:text-ink',
        )}
      >
        <MoonIcon />
        Escuro
      </button>
    </div>
  );
}
