// =============================================================================
// features/quick-replies/admin/QuickReplyActiveToggle.tsx — Switch de
// ativo/inativo do formulário (F28-S07). Mesmo padrão de
// features/admin/products/ProductDrawer.tsx (switch customizado via
// Controller, não input nativo).
// =============================================================================

import * as React from 'react';

import { cn } from '../../../lib/cn';

interface QuickReplyActiveToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function QuickReplyActiveToggle({
  checked,
  onChange,
  disabled = false,
}: QuickReplyActiveToggleProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        role="switch"
        id="qr-active"
        aria-checked={checked}
        aria-label="Resposta ativa"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
          'border-2 border-transparent transition-colors duration-fast ease',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
          'focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
        style={{ backgroundColor: checked ? 'var(--brand-azul)' : 'var(--surface-muted)' }}
      >
        <span
          className="pointer-events-none block h-4 w-4 rounded-full bg-white transition-transform duration-fast ease"
          style={{
            boxShadow: 'var(--elev-1)',
            transform: checked ? 'translateX(16px)' : 'translateX(0)',
          }}
          aria-hidden="true"
        />
      </button>
      <label
        htmlFor="qr-active"
        className="font-sans text-sm font-medium text-ink-2 cursor-pointer select-none"
      >
        {checked ? 'Resposta ativa' : 'Resposta inativa'}
      </label>
    </div>
  );
}
