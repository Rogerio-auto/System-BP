// =============================================================================
// components/kanban/KanbanToast.tsx — Toast de feedback do Kanban.
//
// Posição: inferior direita, elev-5, animação fade-up.
// Variantes: error (transição inválida), warning (erro genérico), success.
// Fecha automaticamente após 4s ou ao clicar.
// Respeita prefers-reduced-motion.
// =============================================================================

import * as React from 'react';

import { cn } from '../../lib/cn';

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type ToastVariant = 'error' | 'warning' | 'success';

export interface ToastMessage {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string | undefined;
}

interface KanbanToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

interface KanbanToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

// ── Ícones inline (SVG 16×16, stroke-width 2) ─────────────────────────────────

function IconError(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconSuccess(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconWarning(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ── Estilos por variante ───────────────────────────────────────────────────────

const variantStyles: Record<
  ToastVariant,
  { container: string; icon: React.ReactNode; iconColor: string }
> = {
  error: {
    container: 'border-l-4 border-danger bg-[var(--danger-bg)]',
    icon: <IconError />,
    iconColor: 'text-danger',
  },
  warning: {
    container: 'border-l-4 border-warning bg-[var(--warning-bg)]',
    icon: <IconWarning />,
    iconColor: 'text-warning',
  },
  success: {
    container: 'border-l-4 border-success bg-[var(--success-bg)]',
    icon: <IconSuccess />,
    iconColor: 'text-success',
  },
};

// ── Toast individual ──────────────────────────────────────────────────────────

function KanbanToastItem({ toast, onDismiss }: KanbanToastItemProps): React.JSX.Element {
  const { container, icon, iconColor } = variantStyles[toast.variant];

  React.useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 4_000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-md min-w-[280px] max-w-[380px] cursor-pointer',
        'border border-border',
        container,
      )}
      style={{ boxShadow: 'var(--elev-5)' }}
      onClick={() => onDismiss(toast.id)}
    >
      <span className={cn('mt-0.5 shrink-0', iconColor)} aria-hidden="true">
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-sans font-semibold text-sm text-ink leading-tight">{toast.title}</p>
        {toast.description && (
          <p className="font-sans text-xs text-ink-2 mt-0.5 leading-relaxed">{toast.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        aria-label="Fechar notificação"
        className={cn(
          'shrink-0 text-ink-3 hover:text-ink transition-colors duration-fast',
          'rounded-xs focus-visible:ring-2 focus-visible:ring-azul/40',
          'min-w-[24px] min-h-[24px] flex items-center justify-center',
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

// ── Container de toasts ───────────────────────────────────────────────────────

/**
 * Container posicionado no canto inferior direito.
 * Renderiza uma pilha de toasts com animação fade-up.
 * z-index: 200 (acima do grain body::before z-100).
 */
export function KanbanToastContainer({
  toasts,
  onDismiss,
}: KanbanToastContainerProps): React.JSX.Element | null {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notificações"
      className="fixed bottom-6 right-6 flex flex-col gap-2"
      style={{ zIndex: 200 }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="animate-[fade-up_var(--dur-slow)_var(--ease-out)_both]">
          <KanbanToastItem toast={toast} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}

// ── Hook de gerenciamento de toasts ──────────────────────────────────────────

/**
 * Hook para gerenciar a fila de toasts do Kanban.
 * Uso: const { toasts, addToast, dismissToast } = useKanbanToasts();
 */
export function useKanbanToasts(): {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
} {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);

  const addToast = React.useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
