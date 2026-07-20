// =============================================================================
// components/layout/sidebar-icons.tsx — Ícones SVG inline (20×20) da navegação.
//
// Extraído de Sidebar.tsx (F27-S03) para manter os componentes de shell abaixo
// do limite de 200 linhas. Puro — sem estado, sem hooks.
// =============================================================================

import * as React from 'react';

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

function IconHelp(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.6 7.5a2.4 2.4 0 1 1 3.6 2.07c-.7.4-1.2.85-1.2 1.68v.25" strokeLinecap="round" />
      <circle cx="10" cy="14.6" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconConversas(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      <path d="M17 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3v3l4-3h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z" />
      <path d="M6 8h8M6 11h5" strokeLinecap="round" />
    </svg>
  );
}

function IconSimulator(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-5 h-5 shrink-0"
    >
      {/* Calculadora */}
      <rect x="4" y="2" width="12" height="16" rx="2" />
      <rect x="6.5" y="4.5" width="7" height="3.5" rx="1" />
      <circle cx="7" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="13" cy="11" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="7" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="13" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

// ─── Mapa iconKey → JSX ───────────────────────────────────────────────────────
//
// Fonte canônica: navigation.ts declara iconKey (string); aqui resolvemos para
// o JSX correspondente. Adicionar entradas ao crescer o APP_NAV.

const ICON_MAP: Record<string, React.ReactNode> = {
  dashboard: <IconDashboard />,
  crm: <IconCrm />,
  analise: <IconAnalise />,
  contratos: <IconContratos />,
  conversas: <IconConversas />,
  relatorios: <IconRelatorios />,
  simulator: <IconSimulator />,
  configuracoes: <IconConfiguracoes />,
  help: <IconHelp />,
};

/** Resolve iconKey para JSX; fallback neutro se a chave não estiver no mapa. */
export function resolveIcon(iconKey: string): React.ReactNode {
  return (
    ICON_MAP[iconKey] ?? (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        className="w-5 h-5 shrink-0"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="7" />
      </svg>
    )
  );
}
