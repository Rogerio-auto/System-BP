// =============================================================================
// features/contracts/WinbackTaskCard.tsx — Card de oportunidade win-back (F17-S10).
//
// Renderiza uma tarefa com type = 'winback' e exibe CTA de nova simulação
// pré-preenchida com o customerId (via metadata.customer_id quando disponível).
//
// Variantes de win-back mapeadas pelo entity_type da tarefa:
//   contract  → "Contrato perto do fim"    (winback_renovation)
//   lead      → "Lead recuperável" ou "Lead estagnado" (winback_lost / winback_stagnant)
//
// DS §9.3: bg-elev-1, elev-2, hover Spotlight, border var(--border).
// Hover: Spotlight (halo verde segue cursor via --mx/--my) — DS §8.5.
// CTA: Button primary "Nova simulação" + Button ghost "Marcar como visto".
// Máx ~185 linhas.
// =============================================================================

import type { Task } from '@elemento/shared-schemas';
import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/cn';
import { useCompleteTask } from '../tasks/hooks';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface WinbackTaskCardProps {
  task: Task;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mapeia entity_type + título para badge legível e variante DS. */
function resolveBadge(task: Task): { label: string; variant: 'info' | 'warning' | 'neutral' } {
  if (task.entity_type === 'contract') {
    return { label: 'Contrato perto do fim', variant: 'info' };
  }
  // entity_type === 'lead' — distingue por título injetado pelo worker F17-S09
  const titleLower = task.title.toLowerCase();
  if (titleLower.includes('perdid') || titleLower.includes('lost')) {
    return { label: 'Lead recuperável', variant: 'warning' };
  }
  return { label: 'Lead estagnado', variant: 'neutral' };
}

/** Extrai customerId dos metadados da tarefa (quando disponível). */
function resolveCustomerId(task: Task): string | null {
  if (task.metadata === null) return null;
  const raw = task.metadata['customer_id'];
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return null;
}

// ---------------------------------------------------------------------------
// Ícone inline (RefreshCw — lucide-react sem dependência adicional)
// ---------------------------------------------------------------------------

function RefreshCwIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * Card de oportunidade win-back.
 * Apresenta a tarefa winback ao agente com CTA de nova simulação pré-preenchida.
 * Hover: Spotlight DS §8.5 (halo verde segue cursor via --mx/--my).
 */
export function WinbackTaskCard({ task }: WinbackTaskCardProps): React.JSX.Element {
  const navigate = useNavigate();
  const complete = useCompleteTask();

  const badge = resolveBadge(task);
  const customerId = resolveCustomerId(task);

  const simulacaoHref =
    customerId !== null
      ? `/simulacoes/nova?customerId=${encodeURIComponent(customerId)}`
      : '/simulacoes/nova';

  const isPending = complete.isPending;

  // Spotlight: halo verde segue cursor via CSS custom props --mx / --my
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`);
  };

  const handleSimulacao = (): void => {
    void navigate(simulacaoHref);
  };

  const handleMarkSeen = (): void => {
    if (!isPending) complete.mutate(task.id);
  };

  return (
    <div
      role="article"
      aria-label={`Oportunidade win-back: ${task.title}`}
      onMouseMove={handleMouseMove}
      className={cn(
        // Base card DS §9.3
        'relative overflow-hidden rounded-md',
        'p-5 flex flex-col gap-4',
        'transition-[transform,box-shadow,border-color] duration-[200ms]',
        // Spotlight Lift DS §8.5
        'hover:-translate-y-[3px]',
        'hover:[border-color:var(--border-strong)]',
        // Spotlight pseudo-element — halo verde segue cursor
        'before:absolute before:inset-0 before:pointer-events-none before:rounded-md',
        'before:opacity-0 hover:before:opacity-100',
        'before:transition-opacity before:duration-300',
        'before:[background:radial-gradient(220px_circle_at_var(--mx,50%)_var(--my,50%),rgba(46,155,62,0.09),transparent_70%)]',
      )}
      style={{
        background: 'var(--bg-elev-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--elev-2)',
        // @ts-expect-error -- CSS custom props não existem em CSSProperties
        '--mx': '50%',
        '--my': '50%',
      }}
    >
      {/* Cabeçalho: ícone de reativação + badge de tipo */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <span
          className="inline-flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 36,
            height: 36,
            background: 'var(--info-bg)',
            color: 'var(--info)',
            boxShadow: 'var(--elev-1)',
          }}
          aria-hidden="true"
        >
          <RefreshCwIcon />
        </span>

        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {/* Título da tarefa */}
      <h3
        className="font-display font-bold leading-snug"
        style={{
          fontSize: 'var(--text-lg)',
          letterSpacing: '-0.028em',
          color: 'var(--text)',
        }}
      >
        {task.title}
      </h3>

      {/* Descrição opcional */}
      {task.description !== null && (
        <p
          className="font-sans"
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-2)',
            lineHeight: 1.55,
          }}
        >
          {task.description}
        </p>
      )}

      {/* Ações */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {/* CTA principal: abre simulação pré-preenchida */}
        <Button
          variant="primary"
          size="sm"
          onClick={handleSimulacao}
          aria-label="Abrir nova simulação pré-preenchida para este cliente"
        >
          Nova simulação
        </Button>

        {/* Ação secundária: marca a tarefa como concluída/vista */}
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={handleMarkSeen}
          aria-label="Marcar oportunidade como vista e concluída"
        >
          {isPending ? 'Salvando…' : 'Marcar como visto'}
        </Button>
      </div>
    </div>
  );
}
