// =============================================================================
// features/quick-replies/admin/QuickReplyRowActions.tsx — Kebab de ações de
// uma linha da tabela (F28-S07): editar, ativar/desativar, remover.
// =============================================================================

import * as React from 'react';

import { useToast } from '../../../components/ui/Toast';
import { useDeleteQuickReply, useUpdateQuickReply } from '../index';
import type { QuickReplyResponse } from '../types';

interface QuickReplyRowActionsProps {
  item: QuickReplyResponse;
  canEdit: boolean;
  onEdit: () => void;
}

export function QuickReplyRowActions({
  item,
  canEdit,
  onEdit,
}: QuickReplyRowActionsProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const updateMutation = useUpdateQuickReply();
  const deleteMutation = useDeleteQuickReply();

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!canEdit) {
    return <span className="font-sans text-xs text-ink-4 italic pr-5">Somente leitura</span>;
  }

  const handleToggleActive = (): void => {
    setOpen(false);
    updateMutation.mutate(
      { id: item.id, body: { isActive: !item.isActive } },
      { onError: () => toast('Erro ao atualizar status.', 'danger') },
    );
  };

  const handleDelete = (): void => {
    setOpen(false);
    if (!window.confirm(`Remover "${item.title}"? Esta ação não pode ser desfeita.`)) return;
    deleteMutation.mutate(item.id, {
      onSuccess: () => toast('Resposta rápida removida.', 'success'),
      onError: () => toast('Erro ao remover resposta rápida.', 'danger'),
    });
  };

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Ações para ${item.title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        className="w-8 h-8 flex items-center justify-center rounded-sm text-ink-3 hover:text-ink hover:bg-surface-hover transition-all duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-44 rounded-sm border border-border z-10"
          style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-3)' }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 font-sans text-sm text-ink-2 hover:text-ink hover:bg-surface-hover transition-colors duration-fast"
          >
            Editar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleToggleActive}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 font-sans text-sm text-ink-2 hover:text-ink hover:bg-surface-hover transition-colors duration-fast"
          >
            {item.isActive ? 'Desativar' : 'Ativar'}
          </button>
          <div className="border-t border-border-subtle" />
          <button
            type="button"
            role="menuitem"
            disabled={deleteMutation.isPending}
            onClick={handleDelete}
            className="flex items-center gap-2.5 w-full px-4 py-2.5 font-sans text-sm text-danger hover:bg-danger/10 transition-colors duration-fast disabled:opacity-40"
          >
            {deleteMutation.isPending ? 'Removendo...' : 'Remover'}
          </button>
        </div>
      )}
    </div>
  );
}
