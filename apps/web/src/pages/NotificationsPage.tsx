// =============================================================================
// pages/NotificationsPage.tsx — Rota /notificacoes: central de notificações
// (F26-S04, doc 23 §14 gaps G6/G7).
//
// Lista TODAS as notificações do usuário (além das 10 do dropdown) com
// paginação (via "carregar mais" — API é offset-based, sem filtro
// server-side), filtro por categoria + lidas/não-lidas (client-side sobre as
// páginas carregadas — ver features/notifications/hooks.ts) e ação em lote de
// marcar como lidas. Reusa `NotificationItem` (F26-S01) — não duplica.
//
// Estados explícitos: loading (skeleton), empty (com contexto de filtro),
// error (retry), success. Tokens do DS, sem cor hardcoded.
// =============================================================================

import type { Notification } from '@elemento/shared-schemas';
import * as React from 'react';

import { Button } from '../components/ui/Button';
import {
  useMarkAllRead,
  useMarkManyRead,
  useNotificationsInfinite,
} from '../features/notifications/hooks';
import { resolveNotificationCategory } from '../features/notifications/navigation';
import { NotificationItem } from '../features/notifications/NotificationItem';
import { NotificationsBulkBar } from '../features/notifications/NotificationsBulkBar';
import type { CategoryFilter, ReadFilter } from '../features/notifications/NotificationsFilterBar';
import { NotificationsFilterBar } from '../features/notifications/NotificationsFilterBar';
import {
  NotificationRowSkeleton,
  NotificationsEmptyState,
  NotificationsErrorState,
} from '../features/notifications/NotificationsListStates';
import { NotificationsPageHeader } from '../features/notifications/NotificationsPageHeader';

function matchesFilters(n: Notification, category: CategoryFilter, read: ReadFilter): boolean {
  if (category !== 'all' && resolveNotificationCategory(n.entity_type) !== category) return false;
  if (read === 'unread' && n.read_at !== null) return false;
  if (read === 'read' && n.read_at === null) return false;
  return true;
}

/** Central de notificações — rota /notificacoes. */
export function NotificationsPage(): React.JSX.Element {
  const [categoryFilter, setCategoryFilter] = React.useState<CategoryFilter>('all');
  const [readFilter, setReadFilter] = React.useState<ReadFilter>('all');
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());

  const { data, isLoading, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotificationsInfinite();
  const markAll = useMarkAllRead();
  const markMany = useMarkManyRead();

  const allItems = React.useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);
  const unreadTotal = data?.pages[0]?.unread_count ?? 0;

  const filtered = React.useMemo(
    () => allItems.filter((n) => matchesFilters(n, categoryFilter, readFilter)),
    [allItems, categoryFilter, readFilter],
  );

  const selectableIds = React.useMemo(
    () => filtered.filter((n) => n.read_at === null).map((n) => n.id),
    [filtered],
  );
  const selectedVisibleCount = selectableIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  function clearSelection(): void {
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(): void {
    setSelectedIds((prev) => {
      if (allSelected) return new Set([...prev].filter((id) => !selectableIds.includes(id)));
      return new Set([...prev, ...selectableIds]);
    });
  }

  const hasFilters = categoryFilter !== 'all' || readFilter !== 'all';

  return (
    <div className="flex flex-col gap-6">
      <NotificationsPageHeader unreadTotal={unreadTotal} />

      <NotificationsFilterBar
        categoryFilter={categoryFilter}
        onCategoryFilterChange={(v) => {
          setCategoryFilter(v);
          clearSelection();
        }}
        readFilter={readFilter}
        onReadFilterChange={(v) => {
          setReadFilter(v);
          clearSelection();
        }}
      />

      {!isLoading && !isError && (
        <NotificationsBulkBar
          selectedCount={selectedVisibleCount}
          selectableCount={selectableIds.length}
          allSelected={allSelected}
          onToggleSelectAll={toggleSelectAll}
          onMarkSelectedRead={() => {
            markMany.mutate(Array.from(selectedIds), { onSuccess: clearSelection });
          }}
          markSelectedPending={markMany.isPending}
          unreadTotal={unreadTotal}
          onMarkAllRead={() => {
            markAll.mutate(undefined, { onSuccess: clearSelection });
          }}
          markAllPending={markAll.isPending}
        />
      )}

      {isLoading && (
        <div
          className="rounded-md overflow-hidden"
          style={{
            background: 'var(--bg-elev-1)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--elev-2)',
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <NotificationRowSkeleton key={String(i)} />
          ))}
        </div>
      )}

      {isError && <NotificationsErrorState onRetry={() => void refetch()} />}

      {!isLoading && !isError && (
        <>
          {filtered.length === 0 ? (
            <NotificationsEmptyState hasFilters={hasFilters} />
          ) : (
            <div
              className="rounded-md overflow-hidden"
              style={{
                background: 'var(--bg-elev-1)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--elev-2)',
              }}
            >
              {filtered.map((n) => (
                <NotificationItem
                  key={n.id}
                  notification={n}
                  selectable={n.read_at === null}
                  selected={selectedIds.has(n.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}

          {hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
