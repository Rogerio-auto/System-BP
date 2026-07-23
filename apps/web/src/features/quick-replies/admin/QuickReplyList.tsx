// =============================================================================
// features/quick-replies/admin/QuickReplyList.tsx — Tabela de respostas
// rápidas (F28-S07).
//
// Molde: features/admin/products/ProductList.tsx (elev-2, th caption-style,
// hover de linha, skeleton, empty state, kebab de ações).
//
// Reordenação (doc 25 §11.2) só aparece na aba "Organização" para quem tem
// `manage` — o backend só reordena registros sem owner (repository.ts).
//
// Sub-componentes em arquivos separados (linhas < 200, DS §"anti-padrões"):
// QuickReplyListStates.tsx (skeleton/empty), QuickReplyListRow.tsx (linha),
// QuickReplyRowActions.tsx (kebab de ações).
// =============================================================================

import * as React from 'react';

import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { cn } from '../../../lib/cn';
import type { QuickReplyResponse } from '../types';

import { QuickReplyListRow } from './QuickReplyListRow';
import { EmptyState, TableSkeleton } from './QuickReplyListStates';
import type { QuickReplyTab } from './tabs';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'true', label: 'Ativas' },
  { value: 'false', label: 'Inativas' },
];

const COLUMNS = [
  { label: 'Resposta', className: 'pl-5 pr-4' },
  { label: 'Categoria', className: 'px-4 hidden md:table-cell' },
  { label: 'Uso', className: 'px-4 hidden lg:table-cell' },
  { label: 'Status', className: 'px-4' },
  { label: 'Ações', className: 'px-4 pr-5 text-right' },
];

interface QuickReplyListProps {
  items: QuickReplyResponse[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onAdd: () => void;
  onEdit: (id: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  category: string;
  onCategoryChange: (v: string) => void;
  statusFilter: string;
  onStatusFilterChange: (v: string) => void;
  tab: QuickReplyTab;
  canManage: boolean;
  canWrite: boolean;
  onMoveUp?: ((id: string) => void) | undefined;
  onMoveDown?: ((id: string) => void) | undefined;
}

export function QuickReplyList({
  items,
  isLoading,
  isError,
  onRefetch,
  onAdd,
  onEdit,
  search,
  onSearchChange,
  category,
  onCategoryChange,
  statusFilter,
  onStatusFilterChange,
  tab,
  canManage,
  canWrite,
  onMoveUp,
  onMoveDown,
}: QuickReplyListProps): React.JSX.Element {
  const canReorder =
    tab === 'organization' && canManage && Boolean(onMoveUp) && Boolean(onMoveDown);

  function canEditRow(item: QuickReplyResponse): boolean {
    return item.visibility === 'organization' ? canManage : canWrite;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Input
            id="qr-search"
            placeholder="Buscar por título ou atalho..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-[180px]">
          <Input
            id="qr-category-filter"
            placeholder="Filtrar por categoria"
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
          />
        </div>
        <div className="w-[160px]">
          <Select
            id="qr-status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
          />
        </div>
      </div>

      <div
        className="rounded-md border border-border overflow-hidden"
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-2)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: 'var(--bg-elev-2)' }}>
                {COLUMNS.map((col) => (
                  <th
                    key={col.label}
                    scope="col"
                    className={cn('py-3 font-sans font-bold text-ink-3 text-left', col.className)}
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <TableSkeleton />
              ) : isError ? (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-5 py-12 text-center">
                    <div
                      className="inline-flex flex-col items-center gap-2 px-6 py-4 rounded-md"
                      style={{ background: 'var(--danger-bg)' }}
                    >
                      <p className="font-sans text-sm font-medium text-danger">
                        Erro ao carregar respostas rápidas.
                      </p>
                      <button
                        type="button"
                        onClick={onRefetch}
                        className="font-sans text-xs text-azul hover:underline"
                      >
                        Tentar novamente
                      </button>
                    </div>
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <EmptyState onAdd={onAdd} canCreate={canWrite || canManage} />
              ) : (
                items.map((item, index) => (
                  <QuickReplyListRow
                    key={item.id}
                    item={item}
                    index={index}
                    isLast={index === items.length - 1}
                    editable={canEditRow(item)}
                    canReorder={canReorder}
                    onEdit={onEdit}
                    onMoveUp={onMoveUp}
                    onMoveDown={onMoveDown}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
