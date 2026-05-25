// =============================================================================
// features/credit-analyses/components/CreditAnalysisStatusBadge.tsx
//
// Badge de status para análise de crédito.
// 5 estados visuais com cores do DS (tokens — sem hex hardcoded):
//   em_analise → info (azul)
//   pendente   → warning (âmbar)
//   aprovado   → success (verde Rondônia)
//   recusado   → danger (vermelho)
//   cancelado  → neutral (cinza muted)
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import type { CreditAnalysisStatus } from '../schemas';
import { ANALYSIS_STATUS_META } from '../schemas';

interface CreditAnalysisStatusBadgeProps {
  status: CreditAnalysisStatus;
  className?: string | undefined;
}

/**
 * Badge canônico de status de análise de crédito.
 * Usa variantes do DS Badge (§9.5) — tokens, não hex.
 */
export function CreditAnalysisStatusBadge({
  status,
  className,
}: CreditAnalysisStatusBadgeProps): React.JSX.Element {
  const meta = ANALYSIS_STATUS_META[status];
  return (
    <Badge variant={meta.variant} {...(className !== undefined ? { className } : {})}>
      {meta.label}
    </Badge>
  );
}
