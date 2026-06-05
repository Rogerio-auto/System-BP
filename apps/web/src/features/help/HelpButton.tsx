import * as React from 'react';

import { useHelpPaletteStore } from './help-palette-store';

/**
 * Botão "?" da topbar — abre o palette de busca da Central de Ajuda.
 *
 * Atributo `data-help-button` reservado como âncora para o tour guiado
 * que chega em F11.
 */
export function HelpButton(): React.JSX.Element {
  const openPalette = useHelpPaletteStore((s) => s.openPalette);

  return (
    <button
      type="button"
      onClick={openPalette}
      data-help-button=""
      aria-label="Buscar na ajuda"
      title="Buscar na ajuda (Ctrl+K)"
      className="inline-flex items-center justify-center rounded-sm transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
      style={{
        width: '2rem',
        height: '2rem',
        color: 'var(--text-3)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.color = 'var(--text)';
        (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.color = 'var(--text-3)';
        (e.currentTarget as HTMLElement).style.background = 'transparent';
      }}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        className="w-5 h-5"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7.5" />
        <path d="M7.6 7.5a2.4 2.4 0 1 1 3.6 2.07c-.7.4-1.2.85-1.2 1.68v.25" strokeLinecap="round" />
        <circle cx="10" cy="14.6" r="0.6" fill="currentColor" stroke="none" />
      </svg>
    </button>
  );
}
