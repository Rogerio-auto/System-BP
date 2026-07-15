// =============================================================================
// features/assistant/components/AssistantDeleteConversationModal.tsx — Modal
// de confirmação antes de excluir (soft-delete) uma conversa salva do
// histórico do copiloto interno (F6-S29).
//
// Mesma chrome de modal de confirmação já usada no app (RevertConfirmModal.tsx
// / EscalateToCreditModal.tsx): overlay + elev-5 + Escape bloqueado durante a
// mutation + foco no diálogo ao montar.
//
// DELETE /api/assistant/conversations/:id (F6-S25) — soft-delete: a
// conversa some da listagem, mas o registro é preservado no banco (auditoria/
// retenção, doc 17).
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../../components/ui/Button';
import type { AssistantConversationSummary } from '../../../hooks/assistant/useAssistantConversations';
import {
  classifyDeleteConversationError,
  useDeleteAssistantConversation,
} from '../../../hooks/assistant/useDeleteAssistantConversation';
import { cn } from '../../../lib/cn';

interface AssistantDeleteConversationModalProps {
  conversation: AssistantConversationSummary;
  onClose: () => void;
  /** Chamado após a exclusão confirmada — o caller decide se precisa
   * limpar a seleção atual do workspace. */
  onDeleted: (id: string) => void;
}

export function AssistantDeleteConversationModal({
  conversation,
  onClose,
  onDeleted,
}: AssistantDeleteConversationModalProps): React.JSX.Element {
  const { remove, isPending } = useDeleteAssistantConversation();
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  const dialogRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  React.useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !isPending) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPending, onClose]);

  async function handleConfirm(): Promise<void> {
    setInlineError(null);
    try {
      await remove(conversation.id);
      onDeleted(conversation.id);
    } catch (err) {
      const classified = classifyDeleteConversationError(err);
      // 404 = já não existe (removida em outro lugar/expirada) — mesmo
      // resultado prático do que pedir, então trata como sucesso silencioso.
      if (classified.kind === 'not_found') {
        onDeleted(conversation.id);
        return;
      }
      setInlineError(classified.message);
    }
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(10, 18, 40, 0.50)' }}
        aria-hidden="true"
        onClick={() => {
          if (!isPending) onClose();
        }}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-conversation-title"
        aria-describedby="delete-conversation-desc"
        tabIndex={-1}
        className={cn(
          'fixed z-50 inset-4 md:inset-auto',
          'md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2',
          'md:w-[min(420px,90vw)]',
          'flex flex-col rounded-md border border-border overflow-hidden',
          'focus:outline-none',
        )}
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-5)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <h2
            id="delete-conversation-title"
            className="font-display font-bold text-ink truncate"
            style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.03em' }}
          >
            Excluir conversa?
          </h2>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <p
            id="delete-conversation-desc"
            className="font-sans text-sm text-ink"
            style={{ lineHeight: 1.5 }}
          >
            A conversa <strong className="font-semibold">&ldquo;{conversation.title}&rdquo;</strong>{' '}
            será removida do seu histórico. Essa ação não pode ser desfeita pela interface.
          </p>

          {inlineError && (
            <div className="px-3 py-2 rounded-md bg-danger-bg border border-danger/30" role="alert">
              <p className="font-sans text-xs text-danger">{inlineError}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border-subtle shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={isPending}
          >
            {isPending ? 'Excluindo...' : 'Excluir conversa'}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
