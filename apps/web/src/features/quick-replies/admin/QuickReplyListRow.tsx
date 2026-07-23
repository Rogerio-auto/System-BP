// =============================================================================
// features/quick-replies/admin/QuickReplyListRow.tsx — Uma linha da tabela
// (F28-S07): setas de reordenação, título/atalho, categoria, uso, status,
// ações.
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import type { QuickReplyResponse } from '../types';

import { QuickReplyRowActions } from './QuickReplyRowActions';

interface QuickReplyListRowProps {
  item: QuickReplyResponse;
  index: number;
  isLast: boolean;
  editable: boolean;
  canReorder: boolean;
  onEdit: (id: string) => void;
  onMoveUp?: ((id: string) => void) | undefined;
  onMoveDown?: ((id: string) => void) | undefined;
}

export function QuickReplyListRow({
  item,
  index,
  isLast,
  editable,
  canReorder,
  onEdit,
  onMoveUp,
  onMoveDown,
}: QuickReplyListRowProps): React.JSX.Element {
  return (
    <tr className="group border-t border-border-subtle hover:bg-surface-hover transition-colors duration-fast">
      <td className="pl-5 pr-4 py-4">
        <div className="flex items-center gap-2">
          {canReorder && (
            <div className="flex flex-col shrink-0">
              <button
                type="button"
                disabled={index === 0}
                aria-label={`Mover "${item.title}" para cima`}
                onClick={() => onMoveUp?.(item.id)}
                className="w-4 h-3.5 flex items-center justify-center text-ink-3 hover:text-azul disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg
                  viewBox="0 0 12 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="w-3 h-3"
                >
                  <path d="M2 6l4-4 4 4" />
                </svg>
              </button>
              <button
                type="button"
                disabled={isLast}
                aria-label={`Mover "${item.title}" para baixo`}
                onClick={() => onMoveDown?.(item.id)}
                className="w-4 h-3.5 flex items-center justify-center text-ink-3 hover:text-azul disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <svg
                  viewBox="0 0 12 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  className="w-3 h-3"
                >
                  <path d="M2 2l4 4 4-4" />
                </svg>
              </button>
            </div>
          )}
          <div>
            {editable ? (
              <button
                type="button"
                onClick={() => onEdit(item.id)}
                className="block font-sans text-sm font-semibold text-ink hover:text-azul transition-colors duration-fast text-left focus-visible:outline-none focus-visible:underline"
              >
                {item.title}
              </button>
            ) : (
              <span className="block font-sans text-sm font-semibold text-ink">{item.title}</span>
            )}
            <div className="flex items-center gap-2 mt-0.5">
              <code
                className="font-mono text-xs"
                style={{ color: 'var(--text-3)', letterSpacing: '-0.01em' }}
              >
                /{item.shortcut}
              </code>
              {item.visibility === 'personal' && <Badge variant="info">Pessoal</Badge>}
              {item.mediaUrl && (
                <span className="font-sans text-xs text-ink-4" title="Com mídia">
                  📎
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 hidden md:table-cell">
        <span className="font-sans text-xs text-ink-2">{item.category ?? '—'}</span>
      </td>
      <td className="px-4 py-4 hidden lg:table-cell">
        <span className="font-mono text-xs text-ink-2">{item.usageCount}×</span>
      </td>
      <td className="px-4 py-4">
        <Badge variant={item.isActive ? 'success' : 'neutral'}>
          {item.isActive ? 'Ativa' : 'Inativa'}
        </Badge>
      </td>
      <td className="px-4 pr-5 py-4 text-right">
        <QuickReplyRowActions item={item} canEdit={editable} onEdit={() => onEdit(item.id)} />
      </td>
    </tr>
  );
}
