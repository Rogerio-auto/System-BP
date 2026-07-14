// =============================================================================
// features/assistant/blocks/LeadCountCard.tsx — Card do bloco `lead_count`
// (F6-S22): total/novos/conversão de leads no período.
// =============================================================================

import * as React from 'react';

import { BlockCardShell } from './BlockCardShell';
import { BlockCardUnavailable } from './BlockCardUnavailable';
import { formatPercent } from './format';
import { isLeadCountValue } from './guards';
import { UsersIcon } from './icons';
import { MiniStat } from './MiniStat';

interface LeadCountCardProps {
  value: unknown;
}

export function LeadCountCard({ value }: LeadCountCardProps): React.JSX.Element {
  if (!isLeadCountValue(value)) {
    return (
      <BlockCardShell
        icon={<UsersIcon className="w-5 h-5" />}
        title="Contagem de leads"
        variant="success"
      >
        <BlockCardUnavailable />
      </BlockCardShell>
    );
  }

  return (
    <BlockCardShell
      icon={<UsersIcon className="w-5 h-5" />}
      title="Contagem de leads"
      variant="success"
      badge={value.rangeLabel}
    >
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Total" value={value.total} />
        <MiniStat label="Novos" value={value.newInPeriod} />
        <MiniStat label="Conversão" value={formatPercent(value.conversionRate)} />
      </div>
    </BlockCardShell>
  );
}
