// =============================================================================
// features/notifications/NotificationsBulkBar.tsx — Ações em lote (F26-S04).
//
// "Selecionar todas as visíveis" (checkbox) + "marcar selecionadas como
// lidas" (loop de POST :id/read em paralelo, ver hooks.ts useMarkManyRead) +
// "marcar todas como lidas" (endpoint global, mesmo do dropdown).
// =============================================================================

import * as React from 'react';

import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

interface NotificationsBulkBarProps {
  selectedCount: number;
  /** Nº de itens carregados+filtrados que são elegíveis para seleção (não lidos). */
  selectableCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onMarkSelectedRead: () => void;
  markSelectedPending: boolean;
  unreadTotal: number;
  onMarkAllRead: () => void;
  markAllPending: boolean;
}

/** Barra de ações em lote — acima da lista da central. */
export function NotificationsBulkBar({
  selectedCount,
  selectableCount,
  allSelected,
  onToggleSelectAll,
  onMarkSelectedRead,
  markSelectedPending,
  unreadTotal,
  onMarkAllRead,
  markAllPending,
}: NotificationsBulkBarProps): React.JSX.Element {
  return (
    <div
      className="flex flex-wrap items-center gap-3 px-4 py-2.5 rounded-sm"
      style={{
        background: 'var(--bg-elev-2)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={allSelected}
          disabled={selectableCount === 0}
          onChange={onToggleSelectAll}
          aria-label="Selecionar todas as notificações não lidas visíveis"
          className={cn(
            'rounded-sm border cursor-pointer',
            'outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
          style={{
            width: 16,
            height: 16,
            accentColor: 'var(--brand-azul)',
            borderColor: 'var(--border-strong)',
          }}
        />
        <span className="font-sans" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-2)' }}>
          {selectedCount > 0
            ? `${selectedCount} selecionada${selectedCount !== 1 ? 's' : ''}`
            : 'Selecionar visíveis'}
        </span>
      </label>

      <div className="flex-1" />

      <Button
        variant="outline"
        size="sm"
        onClick={onMarkSelectedRead}
        disabled={selectedCount === 0 || markSelectedPending}
      >
        {markSelectedPending ? 'Marcando…' : 'Marcar selecionadas como lidas'}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={onMarkAllRead}
        disabled={unreadTotal === 0 || markAllPending}
      >
        {markAllPending ? 'Marcando…' : 'Marcar todas como lidas'}
      </Button>
    </div>
  );
}
