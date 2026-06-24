// =============================================================================
// features/relatorios/components/FunnelSection.tsx
// F23-S07 sec.4-D: Funil & CRM (Kanban)
//
// Metricas: leads por estagio, conversao etapa->etapa, tempo por estagio,
// gargalo destacado em vermelho, aging/stale.
// =============================================================================
import type { CommonReportQuery, FunnelResponse } from '@elemento/shared-schemas';
import * as React from 'react';

import { useReportsFunnel } from '../hooks/useReportsFunnel';

function fmtNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}
function fmtPct(n: number): string {
  return (
    (n * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  );
}
function fmtHours(hours: number | null): string {
  if (hours === null) return '--';
  if (hours < 24) return hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'h';
  const days = hours / 24;
  return days.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'd';
}
function FunnelSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="rounded-md border border-border animate-pulse"
          style={{ height: '60px', background: 'var(--surface-muted)' }}
        />
      ))}
    </div>
  );
}
function FunnelError({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-4 rounded-md border px-6 py-10 text-center"
      style={{ borderColor: 'var(--border)', background: 'var(--danger-bg)' }}
    >
      <p className="font-sans text-sm text-ink-2">Nao foi possivel carregar os dados do funil.</p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans text-sm font-semibold rounded-sm px-4 py-2"
        style={{
          background: 'var(--surface-1)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text)',
          boxShadow: 'var(--elev-1)',
        }}
      >
        Tentar novamente
      </button>
    </div>
  );
}
function FunnelEmpty(): React.JSX.Element {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-md border border-dashed px-6 py-10 text-center"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <p className="font-sans text-sm text-ink-3">Nenhum dado de funil no periodo selecionado.</p>
      <p className="font-sans text-xs text-ink-3">Tente ampliar o periodo ou ajustar o escopo.</p>
    </div>
  );
}
interface FunnelContentProps {
  data: FunnelResponse;
}

function FunnelStageRow({
  stage,
  maxCount,
  isBottleneck,
}: {
  stage: FunnelResponse['stages'][number];
  maxCount: number;
  isBottleneck: boolean;
}): React.JSX.Element {
  const barPct = maxCount > 0 ? (stage.cardCount / maxCount) * 100 : 0;
  const bottleneckColor = isBottleneck ? 'var(--danger)' : 'var(--brand)';
  return (
    <div
      className="rounded-md border p-4"
      style={{
        borderColor: isBottleneck ? 'var(--danger)' : 'var(--border)',
        background: 'var(--surface-1)',
        boxShadow: 'var(--elev-1)',
      }}
    >
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-sans text-sm font-semibold text-ink truncate">
            {stage.stageName}
          </span>
          {stage.staleCardCount > 0 && (
            <span
              className="font-sans text-xs font-semibold px-1.5 py-0.5 rounded-sm"
              style={{ background: 'var(--warning-bg)', color: 'var(--warning)' }}
            >
              {fmtNumber(stage.staleCardCount)} antigos
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 flex-shrink-0 font-sans text-xs text-ink-3">
          <span>{fmtNumber(stage.cardCount)} leads</span>
          {stage.avgDwellHours !== null && (
            <span
              style={{
                color: isBottleneck ? 'var(--danger)' : 'inherit',
                fontWeight: isBottleneck ? '600' : '400',
              }}
            >
              {fmtHours(stage.avgDwellHours)} medio
            </span>
          )}
          {stage.conversionToNextRate !== null && (
            <span>{fmtPct(stage.conversionToNextRate)} para prox.</span>
          )}
        </div>
      </div>
      <div
        className="rounded-full overflow-hidden"
        style={{ height: '6px', background: 'var(--surface-muted)' }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: String(barPct) + '%', background: bottleneckColor }}
        />
      </div>
    </div>
  );
}
function FunnelContent({ data }: FunnelContentProps): React.JSX.Element {
  if (data.stages.length === 0) return <FunnelEmpty />;
  const maxCount = Math.max(...data.stages.map((s) => s.cardCount));
  // Gargalo: estagio com maior tempo medio de permanencia
  const bottleneckId =
    data.stages
      .filter((s) => s.avgDwellHours !== null)
      .sort((a, b) => (b.avgDwellHours ?? 0) - (a.avgDwellHours ?? 0))[0]?.stageId ?? null;

  const totalLeads = data.stages.reduce((acc, s) => acc + s.cardCount, 0);
  const totalStale = data.stages.reduce((acc, s) => acc + s.staleCardCount, 0);
  const stagesSorted = data.stages.slice().sort((a, b) => a.stageOrder - b.stageOrder);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-6 font-sans text-xs text-ink-3 px-1">
        <span>
          <strong className="text-ink font-semibold">{fmtNumber(totalLeads)}</strong> leads no funil
        </span>
        {totalStale > 0 && (
          <span style={{ color: 'var(--warning)' }}>
            <strong>{fmtNumber(totalStale)}</strong> antigos sem movimentacao
          </span>
        )}
        {bottleneckId && (
          <span style={{ color: 'var(--danger)' }}>
            Gargalo:{' '}
            <strong>
              {stagesSorted.find((s) => s.stageId === bottleneckId)?.stageName ?? '--'}
            </strong>
          </span>
        )}
      </div>
      <div className="space-y-2">
        {stagesSorted.map((stage) => (
          <FunnelStageRow
            key={stage.stageId}
            stage={stage}
            maxCount={maxCount}
            isBottleneck={stage.stageId === bottleneckId}
          />
        ))}
      </div>
    </div>
  );
}
interface FunnelSectionProps {
  query: Partial<CommonReportQuery>;
}
/** Secao Funil e CRM (paragr 4-D). Gargalo em vermelho. Estados: loading/forbidden/error/empty/success. */
export function FunnelSection({ query }: FunnelSectionProps): React.JSX.Element {
  const { data, isLoading, isError, isForbidden, refetch } = useReportsFunnel(query);
  if (isForbidden) {
    return (
      <div
        className="rounded-md border px-6 py-8 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}
      >
        <p className="font-sans text-sm text-ink-3">
          Voce nao tem permissao para visualizar o funil.
        </p>
      </div>
    );
  }
  if (isLoading) return <FunnelSkeleton />;
  if (isError) return <FunnelError onRetry={refetch} />;
  if (!data) return <FunnelEmpty />;
  return <FunnelContent data={data} />;
}
