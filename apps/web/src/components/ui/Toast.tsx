// =============================================================================
// components/ui/Toast.tsx — Toast de notificação leve.
//
// Usado após ações de mutação (sucesso = verde, erro = danger).
// Animação: fade-up. Auto-dismissal após 4s.
// Portal para body via createPortal.
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../lib/cn';

export type ToastVariant = 'success' | 'danger' | 'info';

interface ToastMessage {
  id: string;
  message: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);

  const toast = React.useCallback((message: string, variant: ToastVariant = 'success') => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, variant }]);

    // Auto-dismiss após 4s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(<ToastStack toasts={toasts} onDismiss={dismiss} />, document.body)}
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider');
  return ctx;
}

// ─── ToastStack ───────────────────────────────────────────────────────────────

const variantStyles: Record<ToastVariant, { bg: string; border: string; icon: React.ReactNode }> = {
  success: {
    bg: 'var(--success-bg)',
    border: 'var(--success)',
    icon: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-4 h-4"
      >
        <path d="M3 8l3.5 3.5 6.5-7" />
      </svg>
    ),
  },
  danger: {
    bg: 'var(--danger-bg)',
    border: 'var(--danger)',
    icon: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-4 h-4"
      >
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    ),
  },
  info: {
    bg: 'var(--info-bg)',
    border: 'var(--info)',
    icon: (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        className="w-4 h-4"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 7v4M8 5.5v.5" />
      </svg>
    ),
  },
};

function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      role="region"
      aria-label="Notificações"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((t) => {
        const style = variantStyles[t.variant];
        return (
          <div
            key={t.id}
            role="alert"
            className={cn(
              'flex items-start gap-3',
              'rounded-md border px-4 py-3',
              'font-sans text-sm font-medium text-ink',
              'animate-[fade-up_250ms_cubic-bezier(0.16,1,0.3,1)_both]',
            )}
            style={{
              background: style.bg,
              borderColor: style.border,
              borderLeftWidth: 3,
              boxShadow: 'var(--elev-3)',
              color: style.border,
            }}
          >
            <span className="shrink-0 mt-0.5">{style.icon}</span>
            <span className="flex-1 text-ink" style={{ color: 'var(--text)' }}>
              {t.message}
            </span>
            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              aria-label="Fechar notificação"
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                className="w-4 h-4"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
