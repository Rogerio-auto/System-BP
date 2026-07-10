// =============================================================================
// features/assistant/components/AssistantTurnItem.tsx — Um turno de conversa
// do copiloto interno (F6-S09): pergunta + resposta (ou loading/erro).
//
// Estados: pending (skeleton — nunca spinner sozinho), success (resposta +
// fontes citadas via sources[]), error (alerta + retry).
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../lib/cn';
import type { AssistantTurn } from '../types';

interface AssistantTurnItemProps {
  turn: AssistantTurn;
  onRetry: (turn: AssistantTurn) => void;
}

// ── Bolha da pergunta do usuário ──────────────────────────────────────────────

function QuestionBubble({ question }: { question: string }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] rounded-md px-[14px] py-[10px]"
        style={{
          background: 'var(--grad-azul)',
          color: 'var(--text-on-brand)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        <p className="font-sans text-sm font-medium whitespace-pre-wrap break-words">{question}</p>
      </div>
    </div>
  );
}

// ── Skeleton "consultando dados" (nunca spinner sozinho — DS §13) ────────────

function AnswerSkeleton(): React.JSX.Element {
  return (
    <div
      className="max-w-[85%] rounded-md border px-[14px] py-3 animate-pulse"
      style={{
        background: 'var(--bg-elev-1)',
        borderColor: 'var(--border-subtle)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <p className="font-sans text-xs text-ink-3 mb-2">Consultando seus dados…</p>
      <div className="flex flex-col gap-1.5">
        <div className="h-3 w-56 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
        <div className="h-3 w-40 rounded-xs" style={{ background: 'var(--surface-muted)' }} />
      </div>
    </div>
  );
}

// ── Resposta com fontes citadas ───────────────────────────────────────────────

function AnswerBubble({
  answer,
  sources,
}: {
  answer: string;
  sources: string[];
}): React.JSX.Element {
  return (
    <div
      className="max-w-[85%] rounded-md border px-[14px] py-3"
      style={{
        background: 'var(--bg-elev-1)',
        borderColor: 'var(--border-subtle)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <p className="font-sans text-sm text-ink leading-relaxed whitespace-pre-wrap break-words">
        {answer}
      </p>

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3 border-t border-border-subtle">
          <span className="font-sans text-xs text-ink-4 mr-0.5">Fontes:</span>
          {sources.map((source, i) => (
            <Badge key={`${source}-${i}`} variant="info">
              {source}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Erro com retry ────────────────────────────────────────────────────────────

function ErrorBubble({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div
      className="max-w-[85%] rounded-md px-[14px] py-3"
      style={{
        background: 'var(--danger-bg)',
        borderLeft: '3px solid var(--danger)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <p className="font-sans text-sm font-medium" style={{ color: 'var(--danger)' }}>
        {message}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className={cn(
          'mt-2 font-sans text-xs font-semibold underline underline-offset-2',
          'transition-opacity duration-fast ease hover:opacity-70',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-azul/40 rounded-xs',
        )}
        style={{ color: 'var(--danger)' }}
      >
        Tentar novamente
      </button>
    </div>
  );
}

// ── Turno completo ─────────────────────────────────────────────────────────────

export function AssistantTurnItem({ turn, onRetry }: AssistantTurnItemProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <QuestionBubble question={turn.question} />

      <div className="flex justify-start">
        {turn.status === 'pending' && <AnswerSkeleton />}
        {turn.status === 'success' && (
          <AnswerBubble answer={turn.answer ?? ''} sources={turn.sources ?? []} />
        )}
        {turn.status === 'error' && (
          <ErrorBubble
            message={turn.errorMessage ?? 'Não foi possível obter resposta.'}
            onRetry={() => onRetry(turn)}
          />
        )}
      </div>
    </div>
  );
}
