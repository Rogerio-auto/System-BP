// =============================================================================
// features/assistant/blocks/MiniStat.tsx — Par label/valor compacto usado nos
// cards de bloco (grid de KPIs pequenos) — valor em JetBrains Mono (DS §4.2:
// dados tabulares/numéricos).
// =============================================================================

import * as React from 'react';

interface MiniStatProps {
  label: string;
  value: string | number;
  tone?: 'default' | 'danger';
}

export function MiniStat({ label, value, tone = 'default' }: MiniStatProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span
        className="font-sans text-xs font-semibold uppercase text-ink-3 truncate"
        style={{ letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <span
        className="font-mono text-sm font-bold truncate"
        style={{ color: tone === 'danger' ? 'var(--danger)' : 'var(--text)' }}
      >
        {value}
      </span>
    </div>
  );
}
