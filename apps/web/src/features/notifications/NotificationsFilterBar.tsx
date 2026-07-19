// =============================================================================
// features/notifications/NotificationsFilterBar.tsx — Filtros da central (F26-S04).
//
// Categoria (6 do DS) + lidas/não-lidas. A API não suporta esses filtros
// server-side (só paginação) — aplicados client-side sobre as páginas já
// carregadas (ver hooks.ts `useNotificationsInfinite`).
// =============================================================================

import type { NotificationCategory } from '@elemento/shared-schemas';
import * as React from 'react';

import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Select';

import { getNotificationCategoryLabel, NOTIFICATION_CATEGORIES } from './navigation';

export type ReadFilter = 'all' | 'unread' | 'read';
export type CategoryFilter = NotificationCategory | 'all';

const READ_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'unread', label: 'Não lidas' },
  { value: 'read', label: 'Lidas' },
];

const CATEGORY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Todas as categorias' },
  ...NOTIFICATION_CATEGORIES.map((c) => ({ value: c, label: getNotificationCategoryLabel(c) })),
];

interface NotificationsFilterBarProps {
  categoryFilter: CategoryFilter;
  onCategoryFilterChange: (v: CategoryFilter) => void;
  readFilter: ReadFilter;
  onReadFilterChange: (v: ReadFilter) => void;
}

/** Barra de filtros — categoria + status de leitura. */
export function NotificationsFilterBar({
  categoryFilter,
  onCategoryFilterChange,
  readFilter,
  onReadFilterChange,
}: NotificationsFilterBarProps): React.JSX.Element {
  const hasFilters = categoryFilter !== 'all' || readFilter !== 'all';

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <Select
        id="notifications-filter-category"
        label="Categoria"
        value={categoryFilter}
        options={CATEGORY_OPTIONS}
        // Cast justificado: as options do <select> são geradas de CATEGORY_OPTIONS
        // (valores = 'all' | NotificationCategory), então e.target.value nunca
        // escapa a união — o DOM só tipa value como string genérico.
        onChange={(e) => onCategoryFilterChange(e.target.value as CategoryFilter)}
        wrapperClassName="w-56"
      />
      <Select
        id="notifications-filter-read"
        label="Status"
        value={readFilter}
        options={READ_OPTIONS}
        // Cast justificado — mesmo raciocínio: options vêm de READ_OPTIONS.
        onChange={(e) => onReadFilterChange(e.target.value as ReadFilter)}
        wrapperClassName="w-40"
      />
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onCategoryFilterChange('all');
            onReadFilterChange('all');
          }}
        >
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
