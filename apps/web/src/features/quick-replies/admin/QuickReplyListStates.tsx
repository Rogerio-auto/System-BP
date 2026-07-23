// =============================================================================
// features/quick-replies/admin/QuickReplyListStates.tsx — Skeleton e empty
// state da tabela de respostas rápidas (F28-S07).
// =============================================================================

import * as React from 'react';

export function TableSkeleton(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} aria-hidden="true">
          <td className="pl-5 pr-4 py-4">
            <div className="flex flex-col gap-1.5">
              <div
                className="h-4 rounded-xs animate-pulse"
                style={{ width: 100 + ((i * 37) % 100), background: 'var(--surface-muted)' }}
              />
              <div
                className="h-3 w-24 rounded-xs animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
          </td>
          <td className="px-4 py-4 hidden md:table-cell">
            <div
              className="h-4 w-20 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4 hidden lg:table-cell">
            <div
              className="h-4 w-12 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 py-4">
            <div
              className="h-5 w-14 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
          <td className="px-4 pr-5 py-4">
            <div
              className="h-7 w-7 rounded-sm animate-pulse ml-auto"
              style={{ background: 'var(--surface-muted)' }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}

interface EmptyStateProps {
  onAdd: () => void;
  canCreate: boolean;
}

export function EmptyState({ onAdd, canCreate }: EmptyStateProps): React.JSX.Element {
  return (
    <tr>
      <td colSpan={5}>
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div
            className="w-16 h-16 rounded-md flex items-center justify-center"
            style={{ background: 'var(--info-bg)' }}
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-8 h-8"
              style={{ color: 'var(--info)' }}
            >
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
            </svg>
          </div>
          <div>
            <p
              className="font-display font-bold text-ink"
              style={{ fontSize: 'var(--text-xl)', letterSpacing: '-0.025em' }}
            >
              Nenhuma resposta rápida
            </p>
            <p className="font-sans text-sm text-ink-3 mt-1 max-w-xs mx-auto">
              Crie modelos de mensagem para agilizar o atendimento no WhatsApp.
            </p>
          </div>
          {canCreate && (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-sm font-sans font-semibold text-sm text-white"
              style={{ background: 'var(--grad-azul)', boxShadow: 'var(--elev-2)' }}
            >
              Criar primeira resposta
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
