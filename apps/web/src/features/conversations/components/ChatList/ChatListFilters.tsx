// =============================================================================
// ChatList/ChatListFilters.tsx — Filtros da caixa de entrada (F16-S16).
//
// Controles:
//   - Input de busca com debounce 300ms (filtra por contactName no cliente)
//   - SegmentedTabs de status com contador (substitui o Select anterior)
//
// Abas na ordem: Todas · Abertas · Pendentes · Resolvidas · Adiadas
// Cada aba exibe o rótulo + contagem em tempo real.
//
// DS: tokens de cor, sem hex hardcoded (exceto cores de status sem token DS),
//     SegmentedTabs respeita var(--bg-inset), --elev-1, --radius-sm, --dur-fast.
//
// LGPD (doc 17 §8.1): contactName não é logado.
// =============================================================================

import * as React from 'react';

import { SegmentedTabs } from '../../../../components/ui/SegmentedTabs';
import { STATUS_CONFIG } from '../../statusConfig';
import type { ConversationCountsResponse, ConversationStatus } from '../../types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type StatusFilter = ConversationStatus | 'all';

export interface ChatListFiltersProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly status: StatusFilter;
  readonly onStatusChange: (value: StatusFilter) => void;
  /**
   * Contagens vindas de GET /api/conversations/counts.
   * undefined = ainda carregando ou erro silencioso (tabs exibem sem contador).
   * Aceita undefined explicitamente (exactOptionalPropertyTypes).
   */
  readonly counts?: ConversationCountsResponse | undefined;
  readonly countsLoading?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Definição das abas (ordem canônica)
// ---------------------------------------------------------------------------

function buildTabs(counts?: ConversationCountsResponse) {
  return [
    {
      value: 'all' as StatusFilter,
      label: 'Todas',
      count: counts?.total,
      activeColor: 'var(--brand-azul)',
    },
    {
      value: 'open' as StatusFilter,
      label: STATUS_CONFIG.open.label,
      count: counts?.open,
      activeColor: STATUS_CONFIG.open.color,
    },
    {
      value: 'pending' as StatusFilter,
      label: STATUS_CONFIG.pending.label,
      count: counts?.pending,
      activeColor: STATUS_CONFIG.pending.color,
    },
    {
      value: 'resolved' as StatusFilter,
      label: STATUS_CONFIG.resolved.label,
      count: counts?.resolved,
      activeColor: STATUS_CONFIG.resolved.color,
    },
    {
      value: 'snoozed' as StatusFilter,
      label: STATUS_CONFIG.snoozed.label,
      count: counts?.snoozed,
      activeColor: STATUS_CONFIG.snoozed.color,
    },
  ];
}

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
  counts,
}: ChatListFiltersProps): React.JSX.Element {
  const tabs = buildTabs(counts);

  return (
    <div
      className="flex flex-col gap-3 p-3"
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

      {/* Abas de status com contador */}
      <SegmentedTabs<StatusFilter>
        tabs={tabs}
        value={status}
        onChange={onStatusChange}
        aria-label="Filtrar conversas por status"
      />
    </div>
  );
}
