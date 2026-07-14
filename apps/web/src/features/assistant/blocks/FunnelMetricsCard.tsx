// =============================================================================
// features/assistant/blocks/FunnelMetricsCard.tsx — Card do bloco
// `funnel_metrics` (F6-S22): overview do funil + tabela de estágios.
// =============================================================================

import * as React from 'react';

import { BlockCardShell } from './BlockCardShell';
import { BlockCardUnavailable } from './BlockCardUnavailable';
import { BlockTable } from './BlockTable';
import { formatDwellHours, formatPercent } from './format';
import { isFunnelMetricsValue } from './guards';
import { FunnelIcon } from './icons';
import { MiniStat } from './MiniStat';

interface FunnelMetricsCardProps {
  value: unknown;
}

export function FunnelMetricsCard({ value }: FunnelMetricsCardProps): React.JSX.Element {
  if (!isFunnelMetricsValue(value)) {
    return (
      <BlockCardShell
        icon={<FunnelIcon className="w-5 h-5" />}
        title="Métricas do funil"
        variant="info"
      >
        <BlockCardUnavailable />
      </BlockCardShell>
    );
  }

  const { overview, stages } = value;
  const sortedStages = [...stages].sort((a, b) => a.stageOrder - b.stageOrder);

  return (
    <BlockCardShell
      icon={<FunnelIcon className="w-5 h-5" />}
      title="Métricas do funil"
      variant="info"
      badge={overview.rangeLabel}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Total" value={overview.total} />
        <MiniStat label="Novos" value={overview.newInPeriod} />
        <MiniStat label="Ganhos" value={overview.closedWon} />
        <MiniStat label="Perdidos" value={overview.closedLost} tone="danger" />
      </div>

      <MiniStat label="Conversão" value={formatPercent(overview.conversionRate)} />

      <BlockTable
        columns={['Estágio', 'Cards', 'Estagnados', 'Permanência média']}
        emptyMessage="Nenhum estágio configurado."
        rows={sortedStages.map((stage) => [
          stage.stageName,
          <span key="cardCount" className="font-mono">
            {stage.cardCount}
          </span>,
          <span key="staleCardCount" className="font-mono">
            {stage.staleCardCount}
          </span>,
          <span key="avgDwellHours" className="font-mono">
            {formatDwellHours(stage.avgDwellHours)}
          </span>,
        ])}
      />
    </BlockCardShell>
  );
}
