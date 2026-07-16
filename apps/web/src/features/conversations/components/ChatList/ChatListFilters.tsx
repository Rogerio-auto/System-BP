// =============================================================================
// ChatList/ChatListFilters.tsx — Busca + filtro de status do inbox (F16-S16).
//
// Redesign (F24, revertido): o filtro de status voltou a ser um DROPDOWN no
// header da lista (era um StatusSideMenu — menu lateral vertical, removido
// por ser código morto e por comer largura horizontal da lista de 280px).
//
// Contém:
//   - Campo de busca (debounce fica no ChatList via useDebounce)
//   - StatusDropdown: combobox acessível (button + listbox, aria-activedescendant)
//     com as 5 opções canônicas (Todas · Aberta · Pendente · Resolvida · Adiada),
//     cores de statusConfig.ts, contagem ao lado de cada opção.
//
// LGPD (doc 17 §8.1): contactName não é logado.
// =============================================================================

import * as React from 'react';

import { STATUS_CONFIG } from '../../statusConfig';
import type { ConversationCountsResponse, ConversationStatus } from '../../types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type StatusFilter = ConversationStatus | 'all';

export interface ChatListFiltersProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  /** Status ativo do filtro (padrão 'all' — gerenciado pelo ChatList). */
  readonly status: StatusFilter;
  readonly onStatusChange: (status: StatusFilter) => void;
  /** Contagens por status — undefined enquanto carregam (pill de contagem oculta). */
  readonly counts?: ConversationCountsResponse | undefined;
}

// ---------------------------------------------------------------------------
// Opções do dropdown — fonte única de verdade: statusConfig.ts
// ---------------------------------------------------------------------------

export interface StatusOption {
  readonly value: StatusFilter;
  readonly label: string;
  readonly color: string;
  readonly getCount: (counts: ConversationCountsResponse | undefined) => number | undefined;
}

/**
 * Opções canônicas do dropdown, na ordem de exibição: Todas · Aberta ·
 * Pendente · Resolvida · Adiada. Exportado para testes (ver
 * `__tests__/ChatListFilters.test.ts`) — fonte única de verdade é
 * statusConfig.ts (rótulos/cores dos 4 status reais).
 */
export const STATUS_OPTIONS: readonly StatusOption[] = [
  { value: 'all', label: 'Todas', color: 'var(--brand-azul)', getCount: (c) => c?.total },
  {
    value: 'open',
    label: STATUS_CONFIG.open.label,
    color: STATUS_CONFIG.open.color,
    getCount: (c) => c?.open,
  },
  {
    value: 'pending',
    label: STATUS_CONFIG.pending.label,
    color: STATUS_CONFIG.pending.color,
    getCount: (c) => c?.pending,
  },
  {
    value: 'resolved',
    label: STATUS_CONFIG.resolved.label,
    color: STATUS_CONFIG.resolved.color,
    getCount: (c) => c?.resolved,
  },
  {
    value: 'snoozed',
    label: STATUS_CONFIG.snoozed.label,
    color: STATUS_CONFIG.snoozed.color,
    getCount: (c) => c?.snoozed,
  },
];

// ---------------------------------------------------------------------------
// Sub-componentes visuais
// ---------------------------------------------------------------------------

function StatusDot({ color }: { readonly color: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        minWidth: 8,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 18%, transparent)`,
      }}
    />
  );
}

function StatusCountPill({
  count,
  color,
  active,
}: {
  readonly count: number | undefined;
  readonly color: string;
  readonly active: boolean;
}): React.JSX.Element | null {
  if (count === undefined) return null;
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 18,
        padding: '0 5px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: '-0.01em',
        flexShrink: 0,
        background: active
          ? `color-mix(in srgb, ${color} 18%, transparent)`
          : 'var(--surface-muted)',
        color: active ? color : 'var(--text-3)',
        transition: `background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease)`,
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function ChevronIcon({ open }: { readonly open: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      className="w-4 h-4 flex-shrink-0"
      aria-hidden="true"
      style={{
        color: 'var(--text-3)',
        transform: open ? 'rotate(180deg)' : 'none',
        transition: `transform var(--dur-fast) var(--ease)`,
      }}
    >
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// StatusDropdown — combobox acessível (button + listbox)
// ---------------------------------------------------------------------------

interface StatusDropdownProps {
  readonly status: StatusFilter;
  readonly onStatusChange: (status: StatusFilter) => void;
  readonly counts?: ConversationCountsResponse | undefined;
}

function StatusDropdown({
  status,
  onStatusChange,
  counts,
}: StatusDropdownProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(() =>
    Math.max(
      STATUS_OPTIONS.findIndex((o) => o.value === status),
      0,
    ),
  );

  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const selectedIndex = STATUS_OPTIONS.findIndex((o) => o.value === status);
  const selected = STATUS_OPTIONS[selectedIndex] ?? STATUS_OPTIONS[0]!;

  // Fecha ao clicar fora ou Escape (padrão do NotificationDropdown).
  React.useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current !== null && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  // Ao abrir, sincroniza o índice ativo com o valor atual e foca a listbox.
  React.useEffect(() => {
    if (!open) return;
    setActiveIndex(
      Math.max(
        STATUS_OPTIONS.findIndex((o) => o.value === status),
        0,
      ),
    );
    listRef.current?.focus();
  }, [open, status]);

  const commit = React.useCallback(
    (value: StatusFilter) => {
      onStatusChange(value);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onStatusChange],
  );

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, STATUS_OPTIONS.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(STATUS_OPTIONS.length - 1);
        break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const opt = STATUS_OPTIONS[activeIndex];
        if (opt) commit(opt.value);
        break;
      }
      case 'Tab':
        setOpen(false);
        break;
      default:
        break;
    }
  };

  const activeOptionId = `status-filter-option-${STATUS_OPTIONS[activeIndex]?.value ?? 'all'}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Filtrar por status: ${selected.label}`}
        className={[
          'w-full flex items-center gap-2 font-sans text-sm font-medium',
          'bg-surface-1 rounded-sm pl-3 pr-2.5 py-[9px]',
          'border border-border',
          'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
          'transition-[border-color,box-shadow,background] duration-fast ease-out',
          'hover:border-ink-3 hover:bg-surface-hover',
          'focus:outline-none focus:border-azul',
          'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
        ].join(' ')}
        style={{ color: 'var(--text)' }}
      >
        <StatusDot color={selected.color} />
        <span className="flex-1 text-left truncate">{selected.label}</span>
        <StatusCountPill count={selected.getCount(counts)} color={selected.color} active />
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label="Status da conversa"
          aria-activedescendant={activeOptionId}
          tabIndex={-1}
          onKeyDown={handleListKeyDown}
          className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-md overflow-hidden py-1 outline-none"
          style={{
            background: 'var(--bg-elev-1)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--elev-3)',
          }}
        >
          {STATUS_OPTIONS.map((opt, i) => {
            const isSelected = opt.value === status;
            const isActive = i === activeIndex;
            const count = opt.getCount(counts);

            return (
              <div
                key={opt.value}
                id={`status-filter-option-${opt.value}`}
                role="option"
                aria-selected={isSelected}
                onClick={() => commit(opt.value)}
                onMouseEnter={() => setActiveIndex(i)}
                className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                style={{
                  background: isActive ? 'var(--surface-hover)' : 'transparent',
                  color: isSelected ? opt.color : 'var(--text-2)',
                  fontWeight: isSelected ? 600 : 500,
                  transition: `background var(--dur-fast) var(--ease)`,
                }}
              >
                <StatusDot color={opt.color} />
                <span className="flex-1 font-sans truncate" style={{ fontSize: 'var(--text-sm)' }}>
                  {opt.label}
                </span>
                <StatusCountPill count={count} color={opt.color} active={isSelected} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatListFilters
// ---------------------------------------------------------------------------

/**
 * ChatListFilters — busca + dropdown de status do inbox.
 *
 * O debounce de 300ms da busca fica no hook pai (ChatList) via useDebounce.
 * O statusFilter e as contagens também são gerenciados pelo ChatList
 * (useState local + useConversationCounts) — este componente é controlado.
 */
export function ChatListFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
  counts,
}: ChatListFiltersProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-2 p-3"
      style={{
        borderBottom: '1px solid var(--border-subtle)',
        background: 'var(--bg-elev-1)',
      }}
    >
      {/* Campo de busca */}
      <div className="relative">
        {/* Ícone lupa */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--text-3)' }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            className="w-4 h-4"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5l3 3" strokeLinecap="round" />
          </svg>
        </span>
        <input
          type="search"
          aria-label="Buscar conversa por nome do contato"
          placeholder="Buscar conversa..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className={[
            'w-full font-sans text-sm font-medium',
            'bg-surface-1 rounded-sm pl-9 pr-4 py-[9px]',
            'border border-border',
            'shadow-[inset_0_1px_2px_var(--border-inner-dark)]',
            'transition-[border-color,box-shadow,background] duration-fast ease-out',
            'placeholder:text-ink-4',
            'hover:border-ink-3 hover:bg-surface-hover',
            'focus:outline-none focus:border-azul',
            'focus:shadow-[0_0_0_3px_rgba(27,58,140,0.15),inset_0_1px_2px_var(--border-inner-dark)]',
            'focus:bg-surface-1',
          ].join(' ')}
          style={{ color: 'var(--text)' }}
        />
      </div>

      {/* Dropdown de status — abaixo da busca (largura fixa de 280px na coluna) */}
      <StatusDropdown status={status} onStatusChange={onStatusChange} counts={counts} />
    </div>
  );
}
