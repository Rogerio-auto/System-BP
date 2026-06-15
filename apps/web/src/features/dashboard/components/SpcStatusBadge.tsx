// =============================================================================
// features/dashboard/components/SpcStatusBadge.tsx — Badge visual de status SPC.
//
// DS §9.5: pill, dot colorido com glow, elev-1, uppercase tracking.
// Usa Badge canônico de components/ui/Badge.tsx.
//
// Variantes por status:
//   none              → sem badge (null)
//   pending_inclusion → warning  "Pendente SPC"
//   included          → danger   "No SPC"
//   removed           → success  "Removido SPC"
// =============================================================================

import type { SpcStatus } from '@elemento/shared-schemas';
import * as React from 'react';

import { Badge, type BadgeVariant } from '../../../components/ui/Badge';

interface SpcStatusBadgeProps {
  status: SpcStatus;
  /** Quando true, exibe badge neutro sutil para status none (padrão: omite) */
  showNone?: boolean;
}

const SPC_CONFIG: Record<Exclude<SpcStatus, 'none'>, { variant: BadgeVariant; label: string }> = {
  pending_inclusion: { variant: 'warning', label: 'Pendente SPC' },
  included: { variant: 'danger', label: 'No SPC' },
  removed: { variant: 'success', label: 'Removido SPC' },
};

/**
 * Badge visual derivado de spc_status.
 * Para status none retorna null (sem badge) a menos que showNone=true.
 */
export function SpcStatusBadge({
  status,
  showNone = false,
}: SpcStatusBadgeProps): React.JSX.Element | null {
  if (status === 'none') {
    if (!showNone) return null;
    return <Badge variant="neutral">Sem SPC</Badge>;
  }

  // status is narrowed to Exclude<SpcStatus, 'none'> here — lookup is always defined.
  // Non-null assertion: exhaustiveness is guaranteed by the discriminated enum above.
  const cfg = SPC_CONFIG[status]!;
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
