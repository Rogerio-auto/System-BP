// =============================================================================
// features/assistant/blocks/AnalysisStatusCard.tsx — Card do bloco
// `analysis_status` (F6-S22): análises de crédito de um lead (nome mascarado
// — LGPD §12.5).
//
// Reusa CreditAnalysisStatusBadge (features/credit-analyses) — não recria
// primitivo já canônico (CLAUDE.md: "não recrie componentes ad-hoc").
// =============================================================================

import * as React from 'react';

import { Badge } from '../../../components/ui/Badge';
import { formatBRL } from '../../../lib/format/money';
import { CreditAnalysisStatusBadge } from '../../credit-analyses';
import { CreditAnalysisStatusSchema } from '../../credit-analyses/schemas';

import { BlockCardShell } from './BlockCardShell';
import { BlockCardUnavailable } from './BlockCardUnavailable';
import { BlockTable } from './BlockTable';
import { formatDateBR } from './format';
import { isAnalysisStatusValue } from './guards';
import { ClipboardCheckIcon } from './icons';

interface AnalysisStatusCardProps {
  value: unknown;
}

function StatusCell({ status }: { status: string }): React.JSX.Element {
  const parsed = CreditAnalysisStatusSchema.safeParse(status);
  if (parsed.success) return <CreditAnalysisStatusBadge status={parsed.data} />;
  return <Badge variant="neutral">{status}</Badge>;
}

export function AnalysisStatusCard({ value }: AnalysisStatusCardProps): React.JSX.Element {
  if (!isAnalysisStatusValue(value)) {
    return (
      <BlockCardShell
        icon={<ClipboardCheckIcon className="w-5 h-5" />}
        title="Status de análise"
        variant="warning"
      >
        <BlockCardUnavailable />
      </BlockCardShell>
    );
  }

  return (
    <BlockCardShell
      icon={<ClipboardCheckIcon className="w-5 h-5" />}
      title="Status de análise"
      variant="warning"
      subtitle={value.leadNameMasked ?? 'Lead sem nome cadastrado'}
    >
      <BlockTable
        columns={['Status', 'Valor aprovado', 'Criada em']}
        emptyMessage="Nenhuma análise encontrada para este lead."
        rows={value.analyses.map((analysis) => [
          <StatusCell key="status" status={analysis.status} />,
          <span key="amount" className="font-mono">
            {analysis.approvedAmountBrl !== null ? formatBRL(analysis.approvedAmountBrl) : '—'}
          </span>,
          <span key="createdAt" className="font-mono">
            {formatDateBR(analysis.createdAt)}
          </span>,
        ])}
      />
    </BlockCardShell>
  );
}
