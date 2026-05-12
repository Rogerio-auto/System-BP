// =============================================================================
// components/layout/UserMenu.tsx — Avatar + dropdown de usuário na topbar.
//
// DS:
//   - Avatar usa --grad-rondonia (NUNCA fundo sólido — DS §9 anti-padrão #9)
//   - Dropdown com elev-5 (DS §9 anti-padrão #11 — modal/popover sem elev-5)
//   - hover Scale no avatar (DS §8 padrão Scale)
//   - Items com hover Ghost
//   - Focus ring azul em tudo (WCAG AA)
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface UserMenuProps {
  fullName: string;
  email: string;
  onLogout: () => void;
}

// ─── Iniciais do nome ─────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({ initials }: { initials: string }): React.JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'w-8 h-8 rounded-pill flex items-center justify-center shrink-0',
        // Scale hover (DS §8)
        'transition-transform duration-fast ease',
        'group-hover:scale-105',
      )}
      style={{
        // NUNCA fundo sólido — sempre --grad-* (DS anti-padrão #9)
        background: 'var(--grad-rondonia)',
        boxShadow: 'var(--elev-2)',
      }}
    >
      <span className="font-sans text-xs font-bold text-white leading-none">{initials}</span>
    </div>
  );
}

// ─── Ícones ───────────────────────────────────────────────────────────────────

function IconLogout(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-4 h-4 shrink-0"
      aria-hidden="true"
    >
      <path d="M7 3H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h3" />
      <path d="M13 7l4 3-4 3M7 10h10" />
    </svg>
  );
}

function IconChevron(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-3.5 h-3.5 shrink-0"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────

/**
 * Botão de usuário com dropdown de ações.
 * Click fora fecha o dropdown (useEffect com listener).
 */
export function UserMenu({ fullName, email, onLogout }: UserMenuProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const initials = getInitials(fullName);

  // Fecha ao clicar fora
  React.useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  // Fecha com Escape
  React.useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Menu do usuário — ${fullName}`}
        className={cn(
          'group flex items-center gap-2 rounded-sm px-2 py-1.5',
          'font-sans text-sm font-medium text-ink-2',
          'hover:text-ink hover:bg-surface-hover',
          'transition-all duration-fast ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
        )}
      >
        <Avatar initials={initials} />
        <span className="hidden sm:block max-w-[140px] truncate">{fullName}</span>
        <IconChevron />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          aria-label="Opções do usuário"
          className={cn(
            'absolute right-0 top-full mt-2 z-50',
            'w-[220px]',
            'rounded-md border border-border',
            'bg-surface-1',
            'overflow-hidden',
            'animate-[fade-up_150ms_var(--ease-out)_both]',
          )}
          style={{ boxShadow: 'var(--elev-5)' }}
        >
          {/* Identificação */}
          <div className="px-4 py-3 border-b border-border">
            <p className="font-sans text-sm font-semibold text-ink truncate">{fullName}</p>
            <p className="font-mono text-xs text-ink-3 truncate mt-0.5">{email}</p>
          </div>

          {/* Ações */}
          <div className="py-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLogout();
              }}
              className={cn(
                'w-full flex items-center gap-3',
                'px-4 py-2.5',
                'font-sans text-sm font-medium text-ink-2',
                'hover:bg-surface-hover hover:text-ink',
                'transition-colors duration-fast ease',
                'focus-visible:outline-none focus-visible:bg-surface-hover',
              )}
            >
              <IconLogout />
              Sair da plataforma
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
