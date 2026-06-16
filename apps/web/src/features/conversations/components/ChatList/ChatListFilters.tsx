// =============================================================================
// ChatList/ChatListFilters.tsx — Filtros da caixa de entrada (F16-S16).
//
// Controles:
//   - Input de busca com debounce 300ms (filtra por contactName no cliente)
//   - Select de status: all / open / pending / resolved
//
// DS: tokens de cor, sem hex hardcoded, inset shadow no input via Input canônico.
//
// LGPD (doc 17 §8.1): contactName não é logado.
// =============================================================================

import * as React from 'react';

import { Select } from '../../../../components/ui/Select';
import type { ConversationStatus } from '../../types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type StatusFilter = ConversationStatus | 'all';

export interface ChatListFiltersProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly status: StatusFilter;
  readonly onStatusChange: (value: StatusFilter) => void;
}

// ---------------------------------------------------------------------------
// Opções de status
// ---------------------------------------------------------------------------

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'open', label: 'Abertas' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'resolved', label: 'Resolvidas' },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * ChatListFilters — barra de filtros do inbox.
 *
 * Debounce externo: o pai passa `onSearchChange` já com debounce ou
 * o componente pode receber diretamente (sem debounce interno para evitar
 * double-debounce). O debounce de 300ms fica no hook pai via useDebounce.
 */
export function ChatListFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
}: ChatListFiltersProps): React.JSX.Element {
  return (
    <div
      className="flex flex-col gap-3 p-4"
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

      {/* Filtro de status */}
      <Select
        id="chat-status-filter"
        aria-label="Filtrar por status"
        value={status}
        options={STATUS_OPTIONS}
        onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
        wrapperClassName="w-full"
      />
    </div>
  );
}
