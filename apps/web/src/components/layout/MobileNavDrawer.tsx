// =============================================================================
// components/layout/MobileNavDrawer.tsx — Drawer off-canvas de navegação (mobile).
//
// Doc 24 §6: `Sidebar` vira drawer no mobile (overlay + backdrop, fecha por
// toque/ESC), fixa no desktop. Este componente é a metade "drawer" — a
// metade "fixa" continua em Sidebar.tsx.
//
// Portalizado para `document.body`: assim aparece corretamente mesmo estando
// aninhado sob o wrapper `hidden md:flex` de AppLayout.tsx (que só controla a
// sidebar fixa de desktop) — evita qualquer alteração em AppLayout.tsx.
//
// DS:
//   - elev-5 (overlay — anti-padrão §9.11: "modal/popover sem elev-5")
//   - Backdrop: bg-[var(--text)]/20 + blur, mesmo padrão de PublishRuleDrawer
//   - Fecha por: botão X, clique no backdrop, ESC, navegação (NavLink),
//     resize para >= md
//   - Foco: move para o drawer ao abrir, devolve ao trigger ao fechar
//     (via mobile-nav-store), trap de Tab enquanto aberto, `inert` quando
//     fechado (mas ainda montado para a transição de saída).
//   - Alvo de toque ≥44px (botão fechar 44×44)
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';

import logoUrl from '../../assets/brand/logo.webp';
import { cn } from '../../lib/cn';

import { useMobileNavStore } from './mobile-nav-store';
import type { ResolvedNavItem, ResolvedNavSection } from './sidebar-nav-data';
import { SidebarNavList } from './SidebarNavList';

interface MobileNavDrawerProps {
  navSections: ResolvedNavSection[];
  footerNav: ResolvedNavItem[];
}

function IconClose(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-4 h-4"
      aria-hidden="true"
    >
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}

export function MobileNavDrawer({
  navSections,
  footerNav,
}: MobileNavDrawerProps): React.JSX.Element | null {
  const open = useMobileNavStore((s) => s.open);
  const closeDrawer = useMobileNavStore((s) => s.closeDrawer);
  const location = useLocation();
  const drawerRef = React.useRef<HTMLDivElement>(null);

  // Fecha automaticamente ao navegar (link clicado, back/forward do navegador).
  // closeDrawer() é no-op se já estiver fechado (guard no store) e é estável
  // (ação Zustand) — dep list restrita de propósito a `location.pathname`.
  React.useEffect(() => {
    closeDrawer();
  }, [location.pathname]);

  // Fecha com ESC
  React.useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') closeDrawer();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, closeDrawer]);

  // Trava o scroll do body enquanto o drawer está aberto
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Fecha automaticamente se a viewport crescer para desktop (resize/rotate)
  React.useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList): void => {
      if (e.matches) closeDrawer();
    };
    handleChange(mql);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [closeDrawer]);

  // Move o foco para dentro do drawer ao abrir
  React.useEffect(() => {
    if (!open) return;
    const first = drawerRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])');
    first?.focus();
  }, [open]);

  // Trap de Tab enquanto aberto — mantém o foco dentro do drawer
  React.useEffect(() => {
    if (!open) return;
    function handleTab(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return;
      const container = drawerRef.current;
      if (!container) return;
      const focusables = container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  // `inert` remove o drawer (ainda montado para a transição de saída) da
  // árvore de acessibilidade e da ordem de tabulação enquanto fechado.
  // Setado via ref (não via prop JSX) para evitar a inconsistência do React
  // 18 ao serializar atributos booleanos desconhecidos como `inert="false"`.
  // `useLayoutEffect` (não `useEffect`) para aplicar antes do paint — evita
  // uma janela focável no primeiro frame.
  React.useLayoutEffect(() => {
    if (drawerRef.current) {
      drawerRef.current.inert = !open;
    }
  }, [open]);

  return createPortal(
    <>
      {/* Backdrop — só existe fisicamente enquanto aberto (some do DOM ao fechar) */}
      {open && (
        <div
          role="presentation"
          aria-hidden="true"
          onClick={closeDrawer}
          className="md:hidden fixed inset-x-0 top-14 bottom-0 z-40 bg-[var(--text)]/20 backdrop-blur-[2px]"
          style={{ animation: 'fade-in 200ms ease both' }}
        />
      )}

      {/* Drawer — sempre montado (permite animar a saída via transform) */}
      <div
        id="mobile-nav-drawer"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navegação principal"
        className={cn(
          'md:hidden fixed left-0 top-14 z-50',
          'h-[calc(100vh-3.5rem)] w-72 max-w-[85vw]',
          'flex flex-col bg-surface-1 border-r border-border overflow-hidden',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ boxShadow: 'var(--elev-5)' }}
      >
        {/* Header: logo + fechar */}
        <div className="flex items-center justify-between pl-4 pr-2 py-3 shrink-0 border-b border-border">
          <img
            src={logoUrl}
            alt="Banco do Povo de Rondônia"
            loading="eager"
            style={{ height: '28px', width: 'auto', maxWidth: '160px', objectFit: 'contain' }}
          />
          <button
            type="button"
            onClick={closeDrawer}
            aria-label="Fechar menu"
            className={cn(
              'w-11 h-11 shrink-0 flex items-center justify-center',
              'rounded-sm text-ink-3',
              'hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            <IconClose />
          </button>
        </div>

        <SidebarNavList
          navSections={navSections}
          footerNav={footerNav}
          collapsed={false}
          onNavigate={closeDrawer}
        />
      </div>
    </>,
    document.body,
  );
}
