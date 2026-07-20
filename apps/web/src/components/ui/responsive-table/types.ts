// =============================================================================
// components/ui/responsive-table/types.ts — Contrato de colunas do
// ResponsiveTable (DS §9.7 + doc 24 §6) + helpers puros (testáveis sem
// JSDOM — este projeto não tem ambiente DOM configurado em `vitest`).
// =============================================================================

import type * as React from 'react';

export type ResponsiveTableBreakpoint = 'md' | 'lg' | 'xl';

export interface ResponsiveTableColumn<T> {
  /** Chave única — usada como React key e para achar a coluna primária. */
  key: string;
  /** Cabeçalho (th no desktop, rótulo do par no card mobile). */
  header: string;
  /**
   * Render da célula — reusado nos dois modos (DRY: sem duplicar por tela).
   * `index` é a posição na lista `data` (útil p/ ranking, ex: "#1"). */
  cell: (row: T, index: number) => React.ReactNode;
  /** Alinhamento no desktop (th/td) e do valor no card. Default: 'left'. */
  align?: 'left' | 'right';
  /** Some no desktop até este breakpoint (`hidden {bp}:table-cell`). Não afeta o card. */
  hideBelow?: ResponsiveTableBreakpoint;
  /** Classe de largura da coluna (th) no modo tabela. */
  widthClassName?: string;
  /** Marca a coluna como título do card mobile (1 por tabela; default = 1ª coluna). */
  primary?: boolean;
  /** Esconde a coluna também no card mobile (colunas puramente decorativas do desktop). */
  hideInCard?: boolean;
}

const HIDE_BELOW_CLASS: Record<ResponsiveTableBreakpoint, string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

/** Classe utilitária pura — testável sem JSDOM (ver __tests__). */
export function hideBelowClassName(bp?: ResponsiveTableBreakpoint): string | undefined {
  return bp ? HIDE_BELOW_CLASS[bp] : undefined;
}

/**
 * Separa a coluna "título do card" (mobile) das demais (pares rótulo/valor).
 * Pura — testável sem JSDOM (ver __tests__).
 */
export function splitCardColumns<T>(columns: ResponsiveTableColumn<T>[]): {
  primary: ResponsiveTableColumn<T> | undefined;
  secondary: ResponsiveTableColumn<T>[];
} {
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const secondary = columns.filter((c) => c !== primary && !c.hideInCard);
  return { primary, secondary };
}
