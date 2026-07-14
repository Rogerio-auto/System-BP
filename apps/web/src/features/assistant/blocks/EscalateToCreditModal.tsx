// =============================================================================
// features/assistant/blocks/EscalateToCreditModal.tsx — Modal de confirmação
// humana da escalação de um lead ao Departamento de Crédito (F6-S31).
//
// Eixo de segurança (doc 22 §12): a IA nunca escala sozinha — só dispara
// POST /api/assistant/escalate após o operador clicar "Confirmar
// notificação" aqui. Mesma chrome de modal de confirmação já usado no app
// (RevertConfirmModal.tsx / LawFirmReferralButton.tsx): overlay + elev-5 +
// Escape bloqueado durante a mutation.
//
// LGPD: `note` é texto livre do operador — nunca persistido em
// localStorage/sessionStorage, vive só em memória enquanto o modal está
// aberto (descartada ao fechar/desmontar).
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../../components/ui/Button';
import {
  classifyEscalateError,
  useEscalateLead,
  type EscalateLeadResponse,
} from '../../../hooks/assistant/useEscalateLead';
import { cn } from '../../../lib/cn';

import { EscalateModalBody } from './EscalateModalBody';
import { SendToIcon } from './icons';

interface EscalateToCreditModalProps {
  leadId: string;
  onClose: () => void;
  onSuccess: (result: EscalateLeadResponse) => void;
}

export function EscalateToCreditModal({
  leadId,
  onClose,
  onSuccess,
}: EscalateToCreditModalProps): React.JSX.Element {
  const { escalate, isPending } = useEscalateLead();
  const [note, setNote] = React.useState('');
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

  const handleConfirm = async (): Promise<void> => {
    setInlineError(null);
    try {
      const trimmed = note.trim();
      const result = await escalate(
        trimmed ? { lead_id: leadId, note: trimmed } : { lead_id: leadId },
      );
      onSuccess(result);
    } catch (err) {
      setInlineError(classifyEscalateError(err).message);
    }
  };

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(10, 18, 40, 0.50)' }}
        aria-hidden="true"
        onClick={() => {
          if (!isPending) onClose();
        }}
      />

      {/* Modal panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="escalate-modal-title"
        aria-describedby="escalate-modal-desc"
        tabIndex={-1}
        className={cn(
          'fixed z-50 inset-4 md:inset-auto',
          'md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2',
          'md:w-[min(480px,90vw)]',
          'flex flex-col rounded-md border border-border overflow-hidden',
          'focus:outline-none',
        )}
        style={{ background: 'var(--bg-elev-1)', boxShadow: 'var(--elev-5)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0"
          style={{ background: 'var(--bg-elev-2)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <SendToIcon className="w-5 h-5 shrink-0 text-azul" />
            <h2
              id="escalate-modal-title"
              className="font-display font-bold text-ink truncate"
              style={{ fontSize: 'var(--text-lg)', letterSpacing: '-0.03em' }}
            >
              Escalar ao Crédito
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Fechar modal"
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-sm shrink-0',
              'text-ink-3 hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
              'disabled:opacity-40 disabled:pointer-events-none',
            )}
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              className="w-4 h-4"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <EscalateModalBody
          note={note}
          onNoteChange={setNote}
          disabled={isPending}
          inlineError={inlineError}
        />

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border-subtle shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={isPending}
          >
            {isPending ? 'Notificando...' : 'Confirmar notificação'}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
