// =============================================================================
// features/conversations/components/StatusSideMenu.tsx
//
// Menu lateral vertical colapsável de filtro por status — substitui as abas
// horizontais SegmentedTabs no inbox live chat.
//
// Funcionalidades:
//   - Um item por status (Todas · Abertas · Pendentes · Resolvidas · Adiadas)
//   - Ícone SVG inline + nome + pill de contagem
//   - Item ativo: fundo var(--bg-elev-1) + var(--elev-1) + barra lateral colorida
//   - Colapsável: estado persistido em localStorage 'livechat.statusmenu.collapsed'
//   - Expandido: ícone + nome + contagem (~188px)
//   - Colapsado: só ícone + contagem (~60px), nome no title/tooltip
//   - Transição suave 150ms
//   - Acessível: role="navigation", aria-current, aria-label, focus-visible ring
//   - Light-first + dark first-class via tokens CSS
//
// DS: tokens canônicos — sem hex hardcoded exceto cores de status sem token DS
//     (herdadas de statusConfig.ts).
// =============================================================================

import * as React from 'react';

import { STATUS_CONFIG } from '../statusConfig';
import type { ConversationCountsResponse } from '../types';

import type { StatusFilter } from './ChatList/ChatListFilters';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'livechat.statusmenu.collapsed';
const MENU_WIDTH_EXPANDED = 188;
const MENU_WIDTH_COLLAPSED = 60;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface StatusSideMenuProps {
  readonly value: StatusFilter;
  readonly onChange: (value: StatusFilter) => void;
  readonly counts?: ConversationCountsResponse | undefined;
  readonly countsLoading?: boolean | undefined;
  /**
   * Quando true, força o menu colapsado (apenas ícones) e oculta o botão de
   * toggle. Usado em mobile para não consumir espaço horizontal da lista.
   */
  readonly forceCollapsed?: boolean | undefined;
}

interface MenuItemDef {
  readonly value: StatusFilter;
  readonly label: string;
  readonly color: string;
  readonly icon: React.JSX.Element;
  readonly getCount: (counts?: ConversationCountsResponse) => number | undefined;
}

// ---------------------------------------------------------------------------
// Ícones SVG inline — grade 20px, strokeWidth 1.5
// ---------------------------------------------------------------------------

/** Todas — inbox / caixa com camadas */
function IconAll(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path d="M2 13h4l1.5 2.5h5L14 13h4" />
      <rect x="2" y="4" width="16" height="9" rx="1.5" />
    </svg>
  );
}

/** Abertas — balão de chat aberto */
function IconOpen(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path d="M17 10.5c0 3.038-3.134 5.5-7 5.5-1.04 0-2.026-.185-2.91-.515L3 17l1.2-3.2C2.832 12.72 2 11.67 2 10.5 2 7.462 5.134 5 9 5s8 2.462 8 5.5z" />
      <circle cx="7" cy="10.5" r=".75" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10.5" r=".75" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10.5" r=".75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Pendentes — relógio */
function IconPending(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4.5l3 1.5" />
    </svg>
  );
}

/** Resolvidas — check-circle */
function IconResolved(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="7.5" />
      <path d="M6.5 10l2.5 2.5 4.5-5" />
    </svg>
  );
}

/** Adiadas — lua crescente / soneca */
function IconSnoozed(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={20}
      height={20}
      aria-hidden="true"
    >
      <path d="M15.5 13.5A7 7 0 0 1 6.5 4.5 7 7 0 1 0 15.5 13.5z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Definição dos itens do menu
// ---------------------------------------------------------------------------

const MENU_ITEMS: MenuItemDef[] = [
  {
    value: 'all',
    label: 'Todas',
    color: 'var(--brand-azul)',
    icon: <IconAll />,
    getCount: (c) => c?.total,
  },
  {
    value: 'open',
    label: STATUS_CONFIG.open.label,
    color: STATUS_CONFIG.open.color,
    icon: <IconOpen />,
    getCount: (c) => c?.open,
  },
  {
    value: 'pending',
    label: STATUS_CONFIG.pending.label,
    color: STATUS_CONFIG.pending.color,
    icon: <IconPending />,
    getCount: (c) => c?.pending,
  },
  {
    value: 'resolved',
    label: STATUS_CONFIG.resolved.label,
    color: STATUS_CONFIG.resolved.color,
    icon: <IconResolved />,
    getCount: (c) => c?.resolved,
  },
  {
    value: 'snoozed',
    label: STATUS_CONFIG.snoozed.label,
    color: STATUS_CONFIG.snoozed.color,
    icon: <IconSnoozed />,
    getCount: (c) => c?.snoozed,
  },
];

// ---------------------------------------------------------------------------
// Sub-componente: pill de contagem
// ---------------------------------------------------------------------------

function CountPill({
  count,
  active,
  color,
  collapsed,
}: {
  count: number | undefined;
  active: boolean;
  color: string;
  collapsed: boolean;
}): React.JSX.Element | null {
  if (count === undefined) return null;
  return (
    <span
      aria-label={`${count} conversas`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: collapsed ? 18 : 20,
        height: collapsed ? 16 : 18,
        padding: '0 5px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        background: active
          ? `color-mix(in srgb, ${color} 20%, transparent)`
          : 'var(--surface-muted)',
        color: active ? color : 'var(--text-3)',
        flexShrink: 0,
        transition: `background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)`,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: botão de toggle colapso
// ---------------------------------------------------------------------------

function CollapseToggle({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expandir menu de status' : 'Recolher menu de status'}
      title={collapsed ? 'Expandir' : 'Recolher'}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-azul"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: 36,
        border: 'none',
        background: 'transparent',
        color: 'var(--text-3)',
        cursor: 'pointer',
        borderRadius: 'var(--radius-sm)',
        transition: `color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease)`,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface-muted)';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
      }}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={16}
        height={16}
        aria-hidden="true"
        style={{
          transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
          transition: `transform var(--dur-fast) var(--ease)`,
        }}
      >
        {/* chevron-right quando collapsed, chevron-left quando expandido */}
        <path d="M6 3l5 5-5 5" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * StatusSideMenu — menu lateral vertical colapsável de filtro por status.
 *
 * Montado à esquerda do ChatList no ConversationsLayout.
 * Recebe `value` e `onChange` do pai (estado hoistado em ConversationsLayout).
 * Recebe `counts` também do pai (useConversationCounts hoistado).
 */
export function StatusSideMenu({
  value,
  onChange,
  counts,
  forceCollapsed = false,
}: StatusSideMenuProps): React.JSX.Element {
  // Persiste estado colapsado
  const [collapsedLocal, setCollapsedLocal] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // forceCollapsed sobrepõe o estado local (mobile)
  const collapsed = forceCollapsed || collapsedLocal;

  const toggleCollapsed = React.useCallback(() => {
    setCollapsedLocal((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage pode estar bloqueado em alguns contextos
      }
      return next;
    });
  }, []);

  const width = collapsed ? MENU_WIDTH_COLLAPSED : MENU_WIDTH_EXPANDED;

  return (
    <nav
      aria-label="Filtrar conversas por status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width,
        minWidth: width,
        height: '100%',
        background: 'var(--bg)',
        borderRight: '1px solid var(--border-subtle)',
        transition: `width var(--dur-fast) var(--ease), min-width var(--dur-fast) var(--ease)`,
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Itens de status */}
      <ul
        role="list"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: '8px 6px 0',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {MENU_ITEMS.map((item) => {
          const isActive = value === item.value;
          const count = item.getCount(counts);

          return (
            <li key={item.value} role="listitem">
              <button
                type="button"
                onClick={() => onChange(item.value)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={
                  collapsed ? `${item.label}${count !== undefined ? ` (${count})` : ''}` : undefined
                }
                title={collapsed ? item.label : undefined}
                className="focus:outline-none focus-visible:ring-2 focus-visible:ring-azul"
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: collapsed ? 0 : 10,
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  width: '100%',
                  padding: collapsed ? '10px 0' : '10px 10px 10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  cursor: 'pointer',
                  // Estado ativo: fundo elevado + elev-1
                  background: isActive ? 'var(--bg-elev-1)' : 'transparent',
                  boxShadow: isActive ? 'var(--elev-1)' : 'none',
                  color: isActive ? item.color : 'var(--text-3)',
                  transition: [
                    `background var(--dur-fast) var(--ease)`,
                    `color var(--dur-fast) var(--ease)`,
                    `box-shadow var(--dur-fast) var(--ease)`,
                  ].join(', '),
                  textAlign: 'left',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'var(--surface-muted)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-2)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--text-3)';
                  }
                }}
              >
                {/* Barra de indicador lateral quando ativo */}
                {isActive && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3,
                      height: '60%',
                      borderRadius: '0 var(--radius-xs) var(--radius-xs) 0',
                      background: item.color,
                    }}
                  />
                )}

                {/* Ícone */}
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    color: isActive ? item.color : 'var(--text-3)',
                    transition: `color var(--dur-fast) var(--ease)`,
                  }}
                >
                  {item.icon}
                </span>

                {/* Nome — só quando expandido */}
                {!collapsed && (
                  <span
                    style={{
                      flex: 1,
                      fontFamily: 'var(--font-sans, Geist, sans-serif)',
                      fontSize: 'var(--text-sm)',
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? item.color : 'var(--text-2)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      transition: `color var(--dur-fast) var(--ease), font-weight var(--dur-fast) var(--ease)`,
                    }}
                  >
                    {item.label}
                  </span>
                )}

                {/* Contagem */}
                <CountPill
                  count={count}
                  active={isActive}
                  color={item.color}
                  collapsed={collapsed}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {/* Rodapé: botão de toggle colapso — oculto quando forçado por mobile */}
      {!forceCollapsed && (
        <div
          style={{
            padding: '6px 6px 8px',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <CollapseToggle collapsed={collapsedLocal} onToggle={toggleCollapsed} />
        </div>
      )}
    </nav>
  );
}
