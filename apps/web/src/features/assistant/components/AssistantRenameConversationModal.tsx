// =============================================================================
// features/assistant/components/AssistantRenameConversationModal.tsx — Modal
// de renomear uma conversa salva do histórico do copiloto interno (F6-S29).
//
// Mesma chrome de modal de confirmação já usada no app (RevertConfirmModal.tsx
// / EscalateToCreditModal.tsx): overlay + elev-5 + Escape bloqueado durante a
// mutation + foco no diálogo ao montar.
//
// PATCH /api/assistant/conversations/:id (F6-S25) — o backend higieniza o
// título (DLP + mascaramento de nome) antes de gravar; nada é feito aqui
// além de validar o comprimento no cliente (defesa em profundidade — a
// fonte de verdade é o backend, que rejeita com 400 acima do limite).
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type { AssistantConversationSummary } from '../../../hooks/assistant/useAssistantConversations';
import {
  ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH,
  classifyRenameConversationError,
  useRenameAssistantConversation,
} from '../../../hooks/assistant/useRenameAssistantConversation';
import { cn } from '../../../lib/cn';

interface AssistantRenameConversationModalProps {
  conversation: AssistantConversationSummary;
  onClose: () => void;
}

export function AssistantRenameConversationModal({
  conversation,
  onClose,
}: AssistantRenameConversationModalProps): React.JSX.Element {
  const { rename, isPending } = useRenameAssistantConversation();
  const [title, setTitle] = React.useState(conversation.title);
  const [inlineError, setInlineError] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  React.useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !isPending) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isPending, onClose]);

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH;

  async function handleConfirm(): Promise<void> {
    if (!canSubmit || isPending) return;
    setInlineError(null);
    try {
      await rename({ id: conversation.id, title: trimmed });
      onClose();
    } catch (err) {
      setInlineError(classifyRenameConversationError(err).message);
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-conversation-title"
        className={cn(
          'fixed z-50 inset-4 md:inset-auto',
          'md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2',
          'md:w-[min(420px,90vw)]',
          'flex flex-col rounded-md border border-border overflow-hidden',
        )}
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-5)' }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <h2
            id="rename-conversation-title"
            className="font-display font-bold text-ink truncate"
            style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.03em' }}
          >
            Renomear conversa
          </h2>
        </div>

        <form
          className="p-5 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void handleConfirm();
          }}
        >
          <Input
            ref={inputRef}
            id="rename-conversation-input"
            label="Título"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={ASSISTANT_CONVERSATION_TITLE_MAX_LENGTH}
            disabled={isPending}
            error={inlineError ?? undefined}
            required
          />

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={!canSubmit || isPending}>
              {isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </div>
    </>,
    document.body,
  );
}
