// =============================================================================
// features/assistant/blocks/AssistantBlockCard.tsx — Dispatcher: 1 bloco
// (`{ type, ref, value }`) → 1 card tipado (F6-S22).
//
// `type` NÃO é um enum fechado (contrato real —
// apps/api/src/modules/internal-assistant/schemas.ts BlockSchema.type é
// z.string()) — um `type` desconhecido cai no card genérico de fallback
// (forward-compat com F6-S20), nunca quebra o render.
// =============================================================================

import * as React from 'react';

import type { AssistantBlock } from '../../../hooks/assistant/useAssistantQuery';

import { AnalysisStatusCard } from './AnalysisStatusCard';
import { BillingCard } from './BillingCard';
import { FunnelMetricsCard } from './FunnelMetricsCard';
import { LeadCountCard } from './LeadCountCard';
import { LeadSummaryCard } from './LeadSummaryCard';
import { UnknownBlockCard } from './UnknownBlockCard';

interface AssistantBlockCardProps {
  block: AssistantBlock;
}

export function AssistantBlockCard({ block }: AssistantBlockCardProps): React.JSX.Element {
  switch (block.type) {
    case 'funnel_metrics':
      return <FunnelMetricsCard value={block.value} />;
    case 'lead_count':
      return <LeadCountCard value={block.value} />;
    case 'analysis_status':
      return <AnalysisStatusCard value={block.value} />;
    case 'billing':
      return <BillingCard value={block.value} />;
    case 'lead_summary':
      return <LeadSummaryCard value={block.value} />;
    default:
      return <UnknownBlockCard type={block.type} value={block.value} />;
  }
}
