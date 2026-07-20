// =============================================================================
// components/layout/Topbar.tsx — Barra de navegação superior do app autenticado.
//
// DS:
//   - Altura 56px (h-14), fixed no topo
//   - elev-2 (DS §7 — "Padrão. Botões em repouso, cards ativos, tabelas")
//   - border-bottom: var(--border)
//   - bg-surface-1 com inset highlight superior
//   - Logo à esquerda (Bricolage, tracking -0.03em)
//   - ThemeToggle + UserMenu à direita
//
// Responsividade (F27-S03, doc 24 §6): compacta no mobile — botão de menu
// (hambúrguer, `md:hidden`, alvo de toque 44×44) abre o `MobileNavDrawer`
// via `useMobileNavStore`; gaps/paddings reduzem em telas pequenas; o sino
// de notificações (`NotificationDropdown`) permanece sempre visível/acessível.
// =============================================================================

import * as React from 'react';

import { InternalAssistantButton } from '../../features/assistant/InternalAssistantButton';
import { HelpButton } from '../../features/help/HelpButton';
import { NotificationDropdown } from '../../features/notifications';
import { cn } from '../../lib/cn';
import { ThemeToggle } from '../ui/ThemeToggle';

import { useMobileNavStore } from './mobile-nav-store';
import { UserMenu } from './UserMenu';

interface TopbarProps {
  fullName: string;
  email: string;
  onLogout: () => void;
}

function IconMenu(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5"
      aria-hidden="true"
    >
      <path d="M3 6h14M3 10h14M3 14h14" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Botão hambúrguer — abre o drawer de navegação mobile.
 * Registra sua ref no store para que o drawer devolva o foco ao fechar.
 */
function MobileNavToggle(): React.JSX.Element {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const open = useMobileNavStore((s) => s.open);
  const toggleDrawer = useMobileNavStore((s) => s.toggleDrawer);
  const setTriggerRef = useMobileNavStore((s) => s.setTriggerRef);

  React.useEffect(() => {
    setTriggerRef(buttonRef as React.RefObject<HTMLButtonElement>);
  }, [setTriggerRef]);

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={toggleDrawer}
      aria-label={open ? 'Fechar menu' : 'Abrir menu'}
      aria-expanded={open}
      aria-controls="mobile-nav-drawer"
      className={cn(
        'md:hidden w-11 h-11 -ml-2 shrink-0 flex items-center justify-center',
        'rounded-sm text-ink-2',
        'hover:text-ink hover:bg-surface-hover',
        'transition-all duration-fast ease',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
      )}
    >
      <IconMenu />
    </button>
  );
}

/**
 * Topbar fixa.
 * Espaço reservado: `pt-14` no layout pai para não cobrir conteúdo.
 */
export function Topbar({ fullName, email, onLogout }: TopbarProps): React.JSX.Element {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center px-3 sm:px-4 gap-2 sm:gap-4"
      style={{
        background: 'var(--bg-elev-1)',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--elev-2)',
      }}
    >
      {/* Menu mobile — abre o drawer de navegação (oculto a partir de `md`) */}
      <MobileNavToggle />

      {/* Logo — Bricolage Grotesque, tracking negativo (DS §4.2) */}
      <div className="flex items-center gap-2 mr-auto min-w-0">
        <span
          className="font-display font-bold text-ink truncate"
          style={{
            fontSize: '1rem',
            letterSpacing: '-0.03em',
            fontVariationSettings: "'opsz' 24",
          }}
        >
          Elemento
        </span>
        <span
          className="hidden sm:inline font-sans text-xs font-semibold text-verde uppercase tracking-[0.12em]"
          aria-label="Banco do Povo Rondônia"
        >
          · BDP-RO
        </span>
      </div>

      {/* Ações à direita — sino de notificações sempre acessível */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Assistente IA interno — visível-mas-desabilitado no MVP (doc 05 §7) */}
        <InternalAssistantButton />
        {/* Notificações — agora MEMBRO da topbar (antes flutuava por cima via
            position:fixed no App.tsx, embaralhando com os dados do usuário) */}
        <NotificationDropdown />
        <HelpButton />
        <ThemeToggle />
        <div
          className="hidden sm:block w-px h-5 shrink-0"
          style={{ background: 'var(--border)' }}
          aria-hidden="true"
        />
        <UserMenu fullName={fullName} email={email} onLogout={onLogout} />
      </div>
    </header>
  );
}
