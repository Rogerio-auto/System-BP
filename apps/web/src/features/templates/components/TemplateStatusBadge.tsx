// =============================================================================
// features/templates/components/TemplateStatusBadge.tsx
//
// Badge semântico para status de template WhatsApp.
// DS §9.5: verde aprovado, amarelo pending, vermelho rejected, cinza paused.
// Sem hex hardcoded — apenas tokens do Design System.
// =============================================================================
import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import type { BadgeVariant } from '../../../components/ui/Badge';
import type { TemplateStatus } from '../schemas';

const STATUS_CONFIG: Record<TemplateStatus, { variant: BadgeVariant; label: string }> = {
  approved: { variant: 'success', label: 'Aprovado' },
  pending: { variant: 'warning', label: 'Pendente' },
  rejected: { variant: 'danger', label: 'Rejeitado' },
  paused: { variant: 'neutral', label: 'Pausado' },
};

interface TemplateStatusBadgeProps {
  status: TemplateStatus;
  className?: string;
}

export function TemplateStatusBadge({
  status,
  className,
}: TemplateStatusBadgeProps): React.JSX.Element {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant={config.variant} {...(className ? { className } : {})}>
      {config.label}
    </Badge>
  );
}
