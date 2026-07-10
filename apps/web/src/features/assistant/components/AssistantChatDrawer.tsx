// =============================================================================
// features/assistant/components/AssistantChatDrawer.tsx — Painel de chat do
// copiloto interno (F6-S09).
//
// Renderizado via portal (document.body) para não herdar nenhum containing
// block de ancestral com transform/filter na Topbar — fixed sempre relativo
// ao viewport. Drawer lateral direito, DS §7 elev-5 (máximo na hierarquia).
//
// Histórico de turnos vive só em React state (useState) — desmonta ao fechar
// (o caller condiciona a renderização), então nunca sobrevive em
// localStorage/sessionStorage (LGPD doc 17).
// =============================================================================

import * as React from 'react';
import { createPortal } from 'react-dom';

import {
  classifyAssistantError,
  useAssistantQuery,
  type AssistantErrorKind,
} from '../../../hooks/assistant/useAssistantQuery';
import { cn } from '../../../lib/cn';
import type { AssistantTurn } from '../types';

import { AssistantComposer } from './AssistantComposer';
import { AssistantTurnItem } from './AssistantTurnItem';

interface AssistantChatDrawerProps {
  onClose: () => void;
}

function SparkleIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 2.5l1.6 4.1 4.1 1.6-4.1 1.6L10 14l-1.6-4.2L4.3 8.2l4.1-1.6L10 2.5z" />
      <path d="M15.5 12.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  );
}

function EmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-3">
      <span
        className="inline-flex items-center justify-center"
        style={{
          width: 44,
          height: 44,
          borderRadius: 'var(--radius-sm)',
          color: 'var(--brand-azul)',
          background: 'color-mix(in srgb, var(--brand-azul) 12%, transparent)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        <SparkleIcon className="w-5 h-5" />
      </span>
      <p className="font-sans text-sm text-ink-2 max-w-[260px]">
        Pergunte sobre seus dados operacionais — leads, cobranças, simulações — e receba respostas
        com as fontes consultadas, respeitando suas permissões e escopo de cidade.
      </p>
    </div>
  );
}

export function AssistantChatDrawer({ onClose }: AssistantChatDrawerProps): React.JSX.Element {
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
    ask(question)
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

  function handleSubmit(): void {
    const question = draft.trim();
    if (!question || isPending) return;

    const id = crypto.randomUUID();
    setTurns((prev) => [...prev, { id, question, status: 'pending' }]);
    setDraft('');
    runTurn(id, question);
  }

  function handleRetry(turn: AssistantTurn): void {
    if (isPending) return;
    setTurns((prev) => prev.map((t) => (t.id === turn.id ? { ...t, status: 'pending' } : t)));
    runTurn(turn.id, turn.question);
  }

  return createPortal(
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(10, 18, 40, 0.40)' }}
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Painel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Assistente interno"
        className={cn(
          'fixed inset-y-0 right-0 z-50',
          'w-full max-w-[420px]',
          'flex flex-col',
          'border-l border-border',
        )}
        style={{
          background: 'var(--bg)',
          boxShadow: 'var(--elev-5)',
          animation: 'slide-in-right var(--dur) var(--ease-out) both',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elev-2)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className="inline-flex items-center justify-center shrink-0"
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-sm)',
                color: 'var(--brand-azul)',
                background: 'color-mix(in srgb, var(--brand-azul) 12%, transparent)',
              }}
            >
              <SparkleIcon className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-sans font-semibold text-ink text-sm leading-tight truncate">
                Assistente interno
              </h2>
              <p className="font-sans text-xs text-ink-3">Copiloto sobre seus dados</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar assistente"
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-sm shrink-0',
              'text-ink-3 hover:text-ink hover:bg-surface-hover',
              'transition-all duration-fast ease',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/20',
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

        {/* Conversa */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {turns.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-4">
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
    </>,
    document.body,
  );
}
