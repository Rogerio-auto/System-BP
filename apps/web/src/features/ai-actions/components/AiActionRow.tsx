// =============================================================================
// features/ai-actions/components/AiActionRow.tsx
//
// Linha de uma ação autônoma da IA no painel "IA no funil".
//
// DS (doc 18):
//   - Badge por tipo de ação (success/warning/danger)
//   - Timestamp + lead em Mono (dado tabular)
//   - Botão Reverter só quando revertible && !reverted && ai_actions:revert
//   - Hover de linha sutil (bg-surface-hover) — densidade respirável (linha ~60px)
//
// LGPD (doc 17 §8.5): lead_name_masked já vem mascarado do backend — nunca
// tentar de-mask ou logar o valor bruto.
// =============================================================================

import * as React from 'react';

import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { type AiActionItem, type AiActionName } from '../../../hooks/ai-actions/useAiActions';
import { cn } from '../../../lib/cn';

// ─── Formatador de timestamp ──────────────────────────────────────────────────

export function formatOccurredAt(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

// ─── Rótulos + variantes por tipo de ação ────────────────────────────────────

const ACTION_LABELS: Record<AiActionName, string> = {
  'leads.qualified': 'Lead qualificado',
  'leads.stagnant': 'Marcado como estagnado',
  'leads.abandoned': 'Lead abandonado',
};

const ACTION_VARIANTS: Record<AiActionName, BadgeVariant> = {
  'leads.qualified': 'success',
  'leads.stagnant': 'warning',
  'leads.abandoned': 'danger',
};

export function actionLabel(action: AiActionName): string {
  return ACTION_LABELS[action];
}

export function actionVariant(action: AiActionName): BadgeVariant {
  return ACTION_VARIANTS[action];
}

// ─── Componente ────────────────────────────────────────────────────────────

interface AiActionRowProps {
  item: AiActionItem;
  /** true quando o usuário possui ai_actions:revert */
  canRevert: boolean;
  onRevertClick: (item: AiActionItem) => void;
  /** true enquanto ESTE item está com a mutation de revert em curso */
  isReverting: boolean;
}

export function AiActionRow({
  item,
  canRevert,
  onRevertClick,
  isReverting,
}: AiActionRowProps): React.JSX.Element {
  const showRevertButton = canRevert && item.revertible;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-b-0',
        'transition-colors duration-[150ms] ease-out hover:bg-surface-hover',
      )}
    >
      {/* Timestamp */}
      <span className="font-mono text-xs text-ink-3 shrink-0 w-36" title={item.occurred_at}>
        {formatOccurredAt(item.occurred_at)}
      </span>

      {/* Tipo de ação */}
      <div className="shrink-0 w-44">
        <Badge variant={actionVariant(item.action)}>{actionLabel(item.action)}</Badge>
      </div>

      {/* Lead (mascarado — LGPD) */}
      <span className="font-mono text-sm text-ink flex-1 min-w-0 truncate">
        {item.lead_name_masked ?? '— lead removido —'}
      </span>

      {/* Status de reversão */}
      <div className="shrink-0 w-40 flex justify-end items-center gap-2">
        {item.reverted ? (
          <Badge variant="neutral">Revertida</Badge>
        ) : showRevertButton ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRevertClick(item)}
            disabled={isReverting}
            aria-label={`Reverter ação: ${actionLabel(item.action)} — ${item.lead_name_masked ?? 'lead'}`}
          >
            {isReverting ? 'Revertendo...' : 'Reverter'}
          </Button>
        ) : !item.revertible ? (
          <span className="font-sans text-xs text-ink-4">Informativa</span>
        ) : null}
      </div>
    </div>
  );
}
