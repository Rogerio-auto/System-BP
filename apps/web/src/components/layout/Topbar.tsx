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
// =============================================================================

import * as React from 'react';

import { ThemeToggle } from '../ui/ThemeToggle';

import { UserMenu } from './UserMenu';

interface TopbarProps {
  fullName: string;
  email: string;
  onLogout: () => void;
}

/**
 * Topbar fixa.
 * Espaço reservado: `pt-14` no layout pai para não cobrir conteúdo.
 */
export function Topbar({ fullName, email, onLogout }: TopbarProps): React.JSX.Element {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-40 h-14 flex items-center px-4 gap-4"
      style={{
        background: 'var(--bg-elev-1)',
        borderBottom: '1px solid var(--border)',
        boxShadow: 'var(--elev-2)',
      }}
    >
      {/* Logo — Bricolage Grotesque, tracking negativo (DS §4.2) */}
      <div className="flex items-center gap-2 mr-auto">
        <span
          className="font-display font-bold text-ink"
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

      {/* Ações à direita */}
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <div
          className="w-px h-5 shrink-0"
          style={{ background: 'var(--border)' }}
          aria-hidden="true"
        />
        <UserMenu fullName={fullName} email={email} onLogout={onLogout} />
      </div>
    </header>
  );
}
