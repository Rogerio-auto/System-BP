// =============================================================================
// features/assistant/blocks/BillingCard.tsx — Card do bloco `billing`
// (F6-S22): snapshot atual da carteira de cobrança (sem dimensão temporal —
// nunca "período", sempre "carteira atual").
// =============================================================================

import * as React from 'react';

import { formatBRL } from '../../../lib/format/money';

import { BlockCardShell } from './BlockCardShell';
import { BlockCardUnavailable } from './BlockCardUnavailable';
import { isBillingValue } from './guards';
import { ReceiptIcon } from './icons';
import { MiniStat } from './MiniStat';

interface BillingCardProps {
  value: unknown;
}

export function BillingCard({ value }: BillingCardProps): React.JSX.Element {
  if (!isBillingValue(value)) {
    return (
      <BlockCardShell icon={<ReceiptIcon className="w-5 h-5" />} title="Cobrança" variant="danger">
        <BlockCardUnavailable />
      </BlockCardShell>
    );
  }

  return (
    <BlockCardShell
      icon={<ReceiptIcon className="w-5 h-5" />}
      title="Cobrança"
      variant="danger"
      badge={value.snapshotLabel}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MiniStat label="Cobranças" value={value.totalDues} />
        <MiniStat label="Vencidas" value={value.overdueCount} tone="danger" />
        <MiniStat label="A vencer" value={value.upcomingCount} />
        <MiniStat label="Valor total" value={formatBRL(value.totalAmountBrl)} />
      </div>
    </BlockCardShell>
  );
}
