// =============================================================================
// features/assistant/components/AssistantWorkspaceModal.tsx — Workspace
// fullscreen do copiloto interno (F6-S12).
//
// Substitui o drawer lateral de F6-S09 por um modal flutuante fullscreen
// (~85% da viewport), chat-centric: backdrop escurecido, fecha em Esc /
// clique fora / botão X. Renderizado via portal (document.body) para não
// herdar containing block de ancestral com transform/filter na Topbar.
//
// Estado inicial (sem turnos): AssistantWorkspaceEmptyState mostra chips de
// sugestão por permissão — clicar num chip envia a pergunta pronta.
//
// Histórico de turnos vive só em React state (useState) — desmonta ao
// fechar (o caller condiciona a renderização), então nunca sobrevive em
// localStorage/sessionStorage (LGPD doc 17).
//
// Memória de conversa (F6-S19): cada pergunta enviada ao backend carrega os
// turnos anteriores bem-sucedidos (buildAssistantHistory), para o copiloto
// ter continuidade — sem persistir nada além do useState acima.
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import {
  classifyAssistantError,
  useAssistantQuery,
  type AssistantErrorKind,
} from '../../../hooks/assistant/useAssistantQuery';
import { cn } from '../../../lib/cn';
import { buildAssistantHistory } from '../history';
import type { AssistantTurn } from '../types';

import { AssistantComposer } from './AssistantComposer';
import { AssistantTurnItem } from './AssistantTurnItem';
import { AssistantWorkspaceEmptyState } from './AssistantWorkspaceEmptyState';
import { AssistantWorkspaceHeader } from './AssistantWorkspaceHeader';

interface AssistantWorkspaceModalProps {
  onClose: () => void;
  hasPermission: (permission: string) => boolean;
}

export function AssistantWorkspaceModal({
  onClose,
  hasPermission,
}: AssistantWorkspaceModalProps): React.JSX.Element {
  const [turns, setTurns] = React.useState<AssistantTurn[]>([]);
  const [draft, setDraft] = React.useState('');
  const { ask, isPending } = useAssistantQuery();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const isMountedRef = React.useRef(true);

  React.useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function runTurn(id: string, question: string): void {
    // `turns` aqui é o estado ANTES deste turno ser adicionado (sendQuestion)
    // ou o estado com este turno ainda em 'error'/'pending' (handleRetry) —
    // em ambos os casos buildAssistantHistory exclui o turno atual e
    // qualquer turno que não tenha terminado com sucesso.
    const history = buildAssistantHistory(turns, id);
    ask(question, history)
      .then((res) => {
        if (!isMountedRef.current) return;
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, status: 'success', answer: res.answer, sources: res.sources } : t,
          ),
        );
      })
      .catch((err: unknown) => {
        if (!isMountedRef.current) return;
        const classified = classifyAssistantError(err);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status: 'error',
                  errorKind: classified.kind as AssistantErrorKind,
                  errorMessage: classified.message,
                }
              : t,
          ),
        );
      });
  }

  function sendQuestion(question: string): void {
    const trimmed = question.trim();
    if (!trimmed || isPending) return;

    const id = crypto.randomUUID();
    setTurns((prev) => [...prev, { id, question: trimmed, status: 'pending' }]);
    runTurn(id, trimmed);
  }

  function handleSubmit(): void {
    if (!draft.trim() || isPending) return;
    sendQuestion(draft);
    setDraft('');
  }

  function handleRetry(turn: AssistantTurn): void {
    if (isPending) return;
    setTurns((prev) => prev.map((t) => (t.id === turn.id ? { ...t, status: 'pending' } : t)));
    runTurn(turn.id, turn.question);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-8"
      style={{ background: 'rgba(10, 18, 40, 0.5)', backdropFilter: 'blur(3px)' }}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistente interno"
        className={cn(
          'relative z-50 flex flex-col',
          'w-[92vw] sm:w-[85vw] h-[88vh] sm:h-[85vh]',
          'max-w-[1200px] max-h-[880px] min-h-[420px]',
          'rounded-lg border border-border overflow-hidden',
        )}
        style={{
          background: 'var(--bg)',
          boxShadow: 'var(--elev-5)',
          animation: 'fade-up var(--dur-slow) var(--ease-out) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <AssistantWorkspaceHeader onClose={onClose} />

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-5 min-h-0">
          {turns.length === 0 ? (
            <AssistantWorkspaceEmptyState
              hasPermission={hasPermission}
              onSelectChip={sendQuestion}
              disabled={isPending}
            />
          ) : (
            <div className="flex flex-col gap-4 max-w-[860px] mx-auto">
              {turns.map((turn) => (
                <AssistantTurnItem key={turn.id} turn={turn} onRetry={handleRetry} />
              ))}
            </div>
          )}
        </div>

        <AssistantComposer
          value={draft}
          onChange={setDraft}
          onSubmit={handleSubmit}
          disabled={isPending}
        />
      </div>
    </div>,
    document.body,
  );
}
