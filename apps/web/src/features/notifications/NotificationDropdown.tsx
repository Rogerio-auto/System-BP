// =============================================================================
// features/notifications/NotificationDropdown.tsx — Sino no header + dropdown.
//
// DS §7: dropdown usa elev-3 (modals/popovers). Badge warning para não-lidas.
// Fecha ao clicar fora (handleClickOutside via useEffect no document).
// Posição: canto superior direito do ícone, alinhado à direita.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

import { useMarkAllRead, useNotifications } from './hooks';
import { NotificationItem } from './NotificationItem';

const DROPDOWN_PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Ícone de sino
// ---------------------------------------------------------------------------

function BellIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Badge de contagem
// ---------------------------------------------------------------------------

interface UnreadBadgeProps {
  count: number;
}

function UnreadBadge({ count }: UnreadBadgeProps): React.JSX.Element | null {
  if (count <= 0) return null;

  return (
    <span
      className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full font-mono font-semibold leading-none pointer-events-none"
      aria-label={`${count} notificações não lidas`}
      style={{
        minWidth: 18,
        height: 18,
        padding: '0 4px',
        fontSize: '0.6rem',
        background: 'var(--warning)',
        color: 'var(--brand-azul-deep)',
        boxShadow: '0 0 0 2px var(--bg-elev-1)',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// NotificationDropdown
// ---------------------------------------------------------------------------

/**
 * Dropdown de notificações — sino com badge de não-lidas.
 * Fecha ao clicar fora ou pressionar Escape.
 */
export function NotificationDropdown(): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const { data, isLoading } = useNotifications({ page: 1, per_page: DROPDOWN_PAGE_SIZE });
  const markAll = useMarkAllRead();

  const unreadCount = data?.unread_count ?? 0;

  // Fecha ao clicar fora
  React.useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current !== null && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleMarkAll = (): void => {
    markAll.mutate();
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Botão sino */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unreadCount > 0 ? `${unreadCount} notificações não lidas` : 'Notificações'}
        className={cn(
          'relative inline-flex items-center justify-center rounded-sm',
          'min-w-[40px] min-h-[40px]',
          'outline-none focus-visible:ring-2 focus-visible:ring-azul/40',
          'transition-[background,color] duration-[150ms]',
          'hover:bg-surface-hover',
        )}
        style={{ color: 'var(--text-2)' }}
      >
        <BellIcon />
        <UnreadBadge count={unreadCount} />
      </button>

      {/* Dropdown panel — elev-3 (DS §7) */}
      {open && (
        <div
          role="dialog"
          aria-label="Central de notificações"
          className="absolute right-0 top-full mt-2 z-50 rounded-md overflow-hidden flex flex-col"
          style={{
            width: 360,
            maxHeight: 480,
            background: 'var(--bg-elev-1)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--elev-3)',
          }}
        >
          {/* Header do dropdown */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ borderBottom: '1px solid var(--border-subtle)' }}
          >
            <span
              className="font-sans font-semibold"
              style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}
            >
              Notificações
              {unreadCount > 0 && (
                <span
                  className="ml-2 font-mono"
                  style={{
                    fontSize: '0.65rem',
                    color: 'var(--warning)',
                    fontWeight: 700,
                  }}
                >
                  {unreadCount} nova{unreadCount !== 1 ? 's' : ''}
                </span>
              )}
            </span>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={markAll.isPending}
                className={cn(
                  'font-sans font-medium',
                  'outline-none focus-visible:ring-2 focus-visible:ring-azul/40 rounded-sm px-1',
                  'transition-colors duration-[150ms]',
                  'hover:text-azul',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}
              >
                {markAll.isPending ? 'Marcando…' : 'Marcar todas como lidas'}
              </button>
            )}
          </div>

          {/* Lista de notificações */}
          <div className="overflow-y-auto flex-1">
            {isLoading && (
              <div className="flex flex-col">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={String(i)}
                    className="px-4 py-3 flex gap-3 animate-pulse border-b last:border-b-0"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <div
                      className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                      style={{ background: 'var(--surface-muted)' }}
                    />
                    <div className="flex-1 flex flex-col gap-2">
                      <div
                        className="h-3.5 rounded w-3/4"
                        style={{ background: 'var(--surface-muted)' }}
                      />
                      <div
                        className="h-3 rounded w-full"
                        style={{ background: 'var(--surface-muted)' }}
                      />
                      <div
                        className="h-2.5 rounded w-1/4"
                        style={{ background: 'var(--surface-muted)' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isLoading && (data === undefined || data.data.length === 0) && (
              <div
                className="flex flex-col items-center justify-center gap-2 py-12"
                style={{ color: 'var(--text-3)' }}
              >
                <BellIcon className="opacity-40" />
                <p className="font-sans" style={{ fontSize: 'var(--text-sm)' }}>
                  Nenhuma notificação
                </p>
              </div>
            )}

            {!isLoading && data !== undefined && data.data.length > 0 && (
              <>
                {data.data.map((n) => (
                  <NotificationItem key={n.id} notification={n} />
                ))}
              </>
            )}
          </div>

          {/* Footer */}
          {data !== undefined && data.total > DROPDOWN_PAGE_SIZE && (
            <div
              className="px-4 py-2.5 shrink-0 text-center"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              <span
                className="font-sans"
                style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}
              >
                Mostrando {DROPDOWN_PAGE_SIZE} de {data.total} notificações
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
