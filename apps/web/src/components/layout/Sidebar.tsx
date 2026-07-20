// =============================================================================
// components/layout/Sidebar.tsx — Sidebar colapsável do app autenticado.
//
// DS:
//   - elev-1 (sidebar fundo)
//   - Colapsado: mostra apenas ícones (64px), expandido: ícone + label (240px)
//
// Responsividade (F27-S03, doc 24 §6):
//   - Este componente é a sidebar FIXA de desktop (visível a partir de `md`,
//     controlada pelo wrapper `hidden md:flex` em AppLayout — inalterado).
//   - No mobile, `MobileNavDrawer` (portalizado para `document.body`) assume
//     a navegação como drawer off-canvas — montado aqui para não exigir
//     nenhuma mudança em AppLayout.tsx (fora de `files_allowed` deste slot).
//   - Conteúdo de navegação (marca + links) é compartilhado via
//     `SidebarNavList`/`SidebarBrand` — nunca duplicar rotas.
//
// Fonte de dados: APP_NAV + FOOTER_NAV de app/navigation.ts (F4-S07), via
// sidebar-nav-data.ts.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

import { MobileNavDrawer } from './MobileNavDrawer';
import { useFooterNav, useNavSections } from './sidebar-nav-data';
import { SidebarBrand, SidebarNavList } from './SidebarNavList';

// Re-exportado para compatibilidade com testes existentes
// (__tests__/Sidebar.test.tsx importa `isNavItemVisible` de `../Sidebar`).
export { isNavItemVisible } from './sidebar-nav-data';

// ─── Sidebar principal ────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Sidebar colapsável (desktop) + drawer off-canvas (mobile, portalizado).
 * - Expandida: 240px (w-60)
 * - Colapsada: 64px (w-16)
 * - DS: elev-1, borda direita, brand em topo, nav sections com headings.
 */
export function Sidebar({ collapsed, onToggle }: SidebarProps): React.JSX.Element {
  const navSections = useNavSections();
  const footerNav = useFooterNav();

  return (
    <>
      <aside
        aria-label="Navegação principal"
        className={cn(
          'flex flex-col h-full',
          'bg-surface-1 border-r border-border',
          'transition-[width] duration-[250ms] ease-out',
          'overflow-hidden shrink-0',
          collapsed ? 'w-16' : 'w-60',
        )}
        style={{ boxShadow: 'var(--elev-1)' }}
      >
        <SidebarBrand collapsed={collapsed} />

        <SidebarNavList navSections={navSections} footerNav={footerNav} collapsed={collapsed} />

        {/* Toggle collapse — botão na base (apenas desktop; o drawer mobile fecha via X/backdrop/ESC) */}
        <div className="shrink-0 border-t border-border p-2">
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? 'Expandir menu' : 'Colapsar menu'}
            className={cn(
              'w-full flex items-center justify-center gap-2 min-h-11',
              'rounded-sm py-2 px-3',
              'font-sans text-xs font-medium text-ink-3',
              'hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className={cn(
                'w-4 h-4 transition-transform duration-[250ms] ease-out',
                collapsed ? 'rotate-180' : 'rotate-0',
              )}
              aria-hidden="true"
            >
              <path d="M13 5l-5 5 5 5" />
            </svg>
            {!collapsed && <span>Colapsar</span>}
          </button>
        </div>
      </aside>

      {/* Drawer off-canvas mobile — portalizado, independente da visibilidade
          `hidden md:flex` desta aside desktop. */}
      <MobileNavDrawer navSections={navSections} footerNav={footerNav} />
    </>
  );
}
