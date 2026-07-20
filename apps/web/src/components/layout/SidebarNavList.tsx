// =============================================================================
// components/layout/SidebarNavList.tsx — Marca + lista de navegação da sidebar.
//
// Compartilhado entre a sidebar fixa (desktop, Sidebar.tsx) e o drawer
// off-canvas (mobile, MobileNavDrawer.tsx) — conteúdo único, sem duplicar
// rotas nem a leitura de APP_NAV/FOOTER_NAV (fonte: sidebar-nav-data.ts).
//
// DS:
//   - Hover Lift nos nav-links: translateY(-2px) + sobe de elev-0 a elev-2
//   - Indicador ativo: borda esquerda azul + bg verde com glow verde sutil
//   - Nav labels em caption-style (Geist, uppercase, tracking, text-ink-3)
//   - Alvo de toque ≥44px (py-2.5 + ícone 20px ≈ 44px de altura efetiva)
// =============================================================================

import * as React from 'react';
import { NavLink } from 'react-router-dom';

import iconeUrl from '../../assets/brand/icone-bp.png';
import logoUrl from '../../assets/brand/logo.webp';
import { cn } from '../../lib/cn';

import type { ResolvedNavItem, ResolvedNavSection } from './sidebar-nav-data';

// ─── Marca da sidebar ─────────────────────────────────────────────────────────

export function SidebarBrand({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex items-center px-4 py-4 shrink-0', 'border-b border-border')}>
      {collapsed ? (
        /* Colapsado: apenas o ícone em container com sombra */
        <div
          className="w-8 h-8 rounded-sm shrink-0 flex items-center justify-center overflow-hidden"
          style={{ boxShadow: 'var(--elev-2)' }}
        >
          <img
            src={iconeUrl}
            alt="Banco do Povo"
            loading="eager"
            className="w-full h-full object-contain"
          />
        </div>
      ) : (
        /* Expandido: logo completa */
        <img
          src={logoUrl}
          alt="Banco do Povo de Rondônia"
          loading="eager"
          style={{ height: '32px', width: 'auto', maxWidth: '168px', objectFit: 'contain' }}
        />
      )}
    </div>
  );
}

// ─── Nav link individual ──────────────────────────────────────────────────────

function SidebarNavLink({
  item,
  collapsed,
  onNavigate,
}: {
  item: ResolvedNavItem;
  collapsed: boolean;
  /** Chamado ao navegar — usado pelo drawer mobile para se fechar. No-op no desktop. */
  onNavigate?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <NavLink
      to={item.href}
      end={item.href === '/'}
      title={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          // Base — min-h-11 garante alvo de toque ≥44px mesmo no drawer mobile
          'group relative flex items-center gap-3 min-h-11',
          'rounded-sm mx-2 px-3 py-2.5',
          'font-sans text-sm font-medium',
          'transition-all duration-fast ease',
          // Hover: Lift (translateY -2px) + sobe elev-0 → elev-2 (DS §8)
          'hover:-translate-y-0.5',
          'hover:shadow-e2',
          // Focus visível (teclado)
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
          // Default state
          isActive
            ? [
                // Ativo: bg verde suave + glow verde + borda esquerda azul
                'text-azul bg-verde/10',
                'shadow-[var(--glow-verde),inset_4px_0_0_var(--brand-azul)]',
              ]
            : ['text-ink-2 hover:text-ink', 'hover:bg-surface-hover'],
          // Collapsed: centralizado (apenas desktop — mobile nunca colapsa)
          collapsed && 'md:justify-center md:px-2',
        )
      }
    >
      {item.icon}
      <span className={cn('truncate', collapsed && 'md:hidden')}>{item.label}</span>
    </NavLink>
  );
}

// ─── Lista completa (seções + rodapé) ─────────────────────────────────────────

interface SidebarNavListProps {
  navSections: ResolvedNavSection[];
  footerNav: ResolvedNavItem[];
  collapsed: boolean;
  /** Chamado ao clicar em um item — usado pelo drawer mobile para se fechar. */
  onNavigate?: (() => void) | undefined;
}

/**
 * Corpo de navegação (seções com heading + rodapé isolado com Configurações).
 * Puramente apresentacional — recebe os dados já resolvidos (gates aplicados).
 */
export function SidebarNavList({
  navSections,
  footerNav,
  collapsed,
  onNavigate,
}: SidebarNavListProps): React.JSX.Element {
  return (
    <>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 flex flex-col gap-4">
        {navSections.map((section, sIdx) => (
          <div key={sIdx} className="flex flex-col gap-0.5">
            {section.heading && (
              <p
                className={cn(
                  'px-5 pb-1 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3',
                  collapsed && 'md:hidden',
                )}
              >
                {section.heading}
              </p>
            )}
            {section.items.map((item) => (
              <SidebarNavLink
                key={item.href}
                item={item}
                collapsed={collapsed}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* Configurações — item isolado no rodapé (padrão Linear/F8-S08) */}
      <div className="shrink-0 border-t border-border pt-2 px-0">
        {footerNav.map((item) => (
          <SidebarNavLink
            key={item.href}
            item={item}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </>
  );
}
