// =============================================================================
// components/layout/Sidebar.tsx — Sidebar colapsável do app autenticado.
//
// DS:
//   - elev-1 (sidebar fundo)
//   - Hover Lift nos nav-links: translateY(-2px) + sobe de elev-0 a elev-2
//   - Indicador ativo: borda esquerda azul + bg verde com glow verde sutil
//   - Logo/marca com gradient da bandeira (--grad-rondonia)
//   - Nav labels em caption-style (Geist, uppercase, tracking, text-ink-3)
//   - Colapsado: mostra apenas ícones (64px), expandido: ícone + label (240px)
// =============================================================================

import * as React from 'react';
import { NavLink } from 'react-router-dom';

import { cn } from '../../lib/cn';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

interface NavSection {
  heading?: string;
  items: NavItem[];
}

// ─── Ícones SVG inline (20×20) ───────────────────────────────────────────────

function IconDashboard(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  );
}

function IconLeads(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <path d="M13 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M7 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
      <path d="M1 17c0-2.8 2.69-5 6-5" />
      <path d="M10.5 12.1C11.3 12 12.1 12 13 12c3.31 0 6 2.2 6 5" />
    </svg>
  );
}

function IconAnalise(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <path d="M2 15l4.5-5.5 4 3.5 3.5-5 4 3.5" />
      <rect x="2" y="2" width="16" height="16" rx="2" />
    </svg>
  );
}

function IconCrm(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <path d="M13 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M7 10a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z" />
      <path d="M1 17c0-2.8 2.69-5 6-5h6c3.31 0 6 2.2 6 5" />
    </svg>
  );
}

function IconContratos(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <path d="M6 2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
      <path d="M8 6h4M8 10h4M8 14h2" />
    </svg>
  );
}

function IconRelatorios(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <rect x="2" y="2" width="16" height="16" rx="2" />
      <path d="M6 14V9M10 14V6M14 14v-3" />
    </svg>
  );
}

function IconConfiguracoes(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
    </svg>
  );
}

// ─── Nav sections ─────────────────────────────────────────────────────────────

const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/', label: 'Dashboard', icon: <IconDashboard /> }],
  },
  {
    heading: 'Operações',
    items: [
      { href: '/crm', label: 'CRM', icon: <IconCrm /> },
      { href: '/leads', label: 'Leads', icon: <IconLeads /> },
      { href: '/analise', label: 'Análise', icon: <IconAnalise /> },
      { href: '/contratos', label: 'Contratos', icon: <IconContratos /> },
    ],
  },
  {
    heading: 'Gestão',
    items: [
      { href: '/relatorios', label: 'Relatórios', icon: <IconRelatorios /> },
      { href: '/configuracoes', label: 'Configurações', icon: <IconConfiguracoes /> },
    ],
  },
];

// ─── Marca da sidebar ─────────────────────────────────────────────────────────

function SidebarBrand({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-3 px-4 py-4 shrink-0', 'border-b border-border')}>
      {/* Estrela — gradient da bandeira de Rondônia */}
      <div
        className="w-8 h-8 rounded-sm shrink-0 flex items-center justify-center"
        style={{ background: 'var(--grad-rondonia)', boxShadow: 'var(--elev-2)' }}
        aria-hidden="true"
      >
        <svg viewBox="0 0 20 20" fill="none" className="w-4 h-4">
          <path
            d="M10 1 L12.2 7 L18.5 7.3 L13.5 11.3 L15.5 17.5 L10 13.8 L4.5 17.5 L6.5 11.3 L1.5 7.3 L7.8 7 Z"
            fill="white"
            opacity="0.9"
          />
        </svg>
      </div>

      {!collapsed && (
        <div className="min-w-0">
          <p
            className="font-display font-bold text-ink leading-none"
            style={{ letterSpacing: '-0.03em', fontSize: '0.9375rem' }}
          >
            Banco do Povo
          </p>
          <p className="font-sans text-[10px] text-verde font-semibold uppercase tracking-[0.14em] mt-0.5">
            Rondônia
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Nav link individual ──────────────────────────────────────────────────────

function SidebarNavLink({
  item,
  collapsed,
}: {
  item: NavItem;
  collapsed: boolean;
}): React.JSX.Element {
  return (
    <NavLink
      to={item.href}
      end={item.href === '/'}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          // Base
          'group relative flex items-center gap-3',
          'rounded-sm mx-2 px-3 py-2.5',
          'font-sans text-sm font-medium',
          'transition-all duration-fast ease',
          // Hover: Lift (translateY -2px) + sobe elev-0 → elev-2 (DS §8)
          'hover:-translate-y-0.5',
          'hover:shadow-e2',
          // Default state
          isActive
            ? [
                // Ativo: bg verde suave + glow verde + borda esquerda azul
                'text-azul bg-verde/10',
                'shadow-[var(--glow-verde),inset_4px_0_0_var(--brand-azul)]',
              ]
            : ['text-ink-2 hover:text-ink', 'hover:bg-surface-hover'],
          // Collapsed: centralizado
          collapsed && 'justify-center px-2',
        )
      }
    >
      {item.icon}
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
}

// ─── Sidebar principal ────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Sidebar colapsável.
 * - Expandida: 240px (w-60)
 * - Colapsada: 64px (w-16)
 * - DS: elev-1, borda direita, brand em topo, nav sections com headings.
 */
export function Sidebar({ collapsed, onToggle }: SidebarProps): React.JSX.Element {
  return (
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

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 flex flex-col gap-4">
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={sIdx} className="flex flex-col gap-0.5">
            {section.heading && !collapsed && (
              <p className="px-5 pb-1 font-sans text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                {section.heading}
              </p>
            )}
            {section.items.map((item) => (
              <SidebarNavLink key={item.href} item={item} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      {/* Toggle collapse — botão na base */}
      <div className="shrink-0 border-t border-border p-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expandir menu' : 'Colapsar menu'}
          className={cn(
            'w-full flex items-center justify-center gap-2',
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
  );
}
