// =============================================================================
// features/quick-replies/admin/QuickReplyDrawer.tsx — Drawer create/edit de
// resposta rápida (F28-S07).
//
// Molde: features/admin/products/ProductDrawer.tsx — portal, backdrop
// z-[150], painel z-[160], Escape fecha, scroll lock, elev-5.
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../../lib/cn';

import { QuickReplyForm } from './QuickReplyForm';

interface QuickReplyDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Sem quickReplyId → create; com → edit */
  quickReplyId?: string | undefined;
  /** Se o ator tem `livechat:quick_reply:manage` (habilita visibilidade "Organização"). */
  canManage: boolean;
}

/**
 * Drawer lateral de criação / edição de resposta rápida.
 * Entra da direita com slide + fade. Backdrop fecha ao clicar fora.
 */
export function QuickReplyDrawer({
  open,
  onClose,
  quickReplyId,
  canManage,
}: QuickReplyDrawerProps): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  React.useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const title = quickReplyId ? 'Editar resposta rápida' : 'Nova resposta rápida';

  return createPortal(
    <>
      <div
        role="presentation"
        aria-hidden="true"
        className="fixed inset-0 z-[150] bg-[var(--text)]/20 backdrop-blur-[2px]"
        onClick={onClose}
        style={{ animation: 'fade-in 200ms ease both' }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-reply-drawer-title"
        className={cn(
          'fixed right-0 top-0 bottom-0 z-[160]',
          'w-full sm:max-w-[480px]',
          'flex flex-col',
          'bg-surface-1 border-l border-border',
          'overflow-y-auto',
        )}
        style={{
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right 300ms cubic-bezier(0.16,1,0.3,1) both',
        }}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <h2
            id="quick-reply-drawer-title"
            className="font-display font-bold text-ink"
            style={{
              fontSize: 'var(--text-xl)',
              letterSpacing: '-0.03em',
              fontVariationSettings: "'opsz' 24",
            }}
          >
            {title}
          </h2>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              'w-8 h-8 flex items-center justify-center',
              'rounded-sm text-ink-3',
              'hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:ring-2 focus-visible:ring-azul/20',
            )}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-5 h-5"
              aria-hidden="true"
            >
              <path d="M5 5l10 10M15 5l-10 10" />
            </svg>
          </button>
        </div>

        <div className="flex-1">
          <QuickReplyForm quickReplyId={quickReplyId} canManage={canManage} onClose={onClose} />
        </div>
      </div>
    </>,
    document.body,
  );
}
