// =============================================================================
// components/layout/sidebar-nav-data.ts — Gates de navegação + hooks de dados.
//
// Extraído de Sidebar.tsx (F27-S03) para reuso entre a sidebar fixa (desktop)
// e o drawer off-canvas (mobile) sem duplicar a leitura de APP_NAV/FOOTER_NAV.
//
// Fonte de dados: APP_NAV + FOOTER_NAV de app/navigation.ts (F4-S07) — fonte
// única, apenas consumida aqui (nunca duplicar rotas).
// =============================================================================

import * as React from 'react';

import { APP_NAV, FOOTER_NAV } from '../../app/navigation';
import type { NavItem as NavItemMeta } from '../../app/navigation';
import { useFeatureFlags } from '../../hooks/useFeatureFlag';
import { useAuth } from '../../lib/auth-store';

import { resolveIcon } from './sidebar-icons';

// ─── Tipos internos (com icon JSX resolvido) ──────────────────────────────────

export interface ResolvedNavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

export interface ResolvedNavSection {
  heading?: string;
  items: ResolvedNavItem[];
}

// ─── Helpers de gate (exportados para teste) ──────────────────────────────────

/**
 * Verifica se um NavItem deve ser exibido dado o estado de permissões e flags.
 * Puro — recebe os mapas por parâmetro para facilitar testes unitários.
 */
export function isNavItemVisible(
  item: NavItemMeta,
  opts: {
    hasPermission: (perm: string) => boolean;
    flagEnabled: (key: string) => boolean;
  },
): boolean {
  if (item.permission !== undefined && !opts.hasPermission(item.permission)) {
    return false;
  }
  if (item.featureFlag !== undefined && !opts.flagEnabled(item.featureFlag)) {
    return false;
  }
  return true;
}

// ─── Hooks de dados ───────────────────────────────────────────────────────────

/**
 * Deriva as nav sections de APP_NAV aplicando gates de permissão e feature flag.
 * Remove seções cujos items foram todos filtrados.
 */
export function useNavSections(): ResolvedNavSection[] {
  const { hasPermission } = useAuth();
  const { flags } = useFeatureFlags();

  return React.useMemo(() => {
    const flagEnabled = (key: string): boolean => {
      const status = flags[key];
      return status === 'enabled' || status === 'internal_only';
    };

    const resolved: ResolvedNavSection[] = [];

    for (const section of APP_NAV) {
      const visibleItems = section.items
        .filter((item) => isNavItemVisible(item, { hasPermission, flagEnabled }))
        .map((item) => ({
          href: item.href,
          label: item.label,
          icon: resolveIcon(item.iconKey),
        }));

      // Remove seções vazias
      if (visibleItems.length > 0) {
        const resolvedSection: ResolvedNavSection = { items: visibleItems };
        if (section.heading !== undefined) {
          resolvedSection.heading = section.heading;
        }
        resolved.push(resolvedSection);
      }
    }

    return resolved;
  }, [hasPermission, flags]);
}

/** Resolve FOOTER_NAV (sem gates — Configurações é sempre visível). */
export function useFooterNav(): ResolvedNavItem[] {
  return React.useMemo(
    () =>
      FOOTER_NAV.map((item) => ({
        href: item.href,
        label: item.label,
        icon: resolveIcon(item.iconKey),
      })),
    [],
  );
}
