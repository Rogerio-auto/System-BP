// =============================================================================
// features/dashboard/AvgDaysInStageChart.tsx — Gráfico de barras horizontais
// do tempo médio (dias) por estágio do Kanban no dashboard (F18-S07).
//
// SVG com viewBox para responsividade total — escala com o container.
// Indica gargalo (maior valor) em var(--danger).
// =============================================================================

import * as React from 'react';

import type { KanbanAvgDaysInStageItem, KanbanCardsByStageItem } from '../../hooks/dashboard/types';

export interface AvgDaysInStageItem {
  stageId: string;
  stageName: string;
  days: number;
}

interface AvgDaysInStageChartProps {
  avgDays: KanbanAvgDaysInStageItem[];
  cardsByStage: KanbanCardsByStageItem[];
}

function formatDays(days: number): string {
  return days === 1
    ? '1 dia'
    : `${days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

/**
 * Barras horizontais SVG responsivas — tempo médio (dias) por estágio.
 * Usa viewBox + width="100%" para escalar com o container sem overflow.
 */
export function AvgDaysInStageChart({
  avgDays,
  cardsByStage,
}: AvgDaysInStageChartProps): React.JSX.Element {
  const data: AvgDaysInStageItem[] = avgDays.map((a) => ({
    stageId: a.stageId,
    stageName: cardsByStage.find((c) => c.stageId === a.stageId)?.stageName ?? '—',
    days: a.days,
  }));

  const isEmpty = data.length === 0 || data.every((d) => d.days === 0);
  const max = Math.max(...data.map((d) => d.days), 1);
  const maxDays = Math.max(...data.map((d) => d.days));

  // Dimensões internas (viewBox) — não são pixels reais, são unidades de escala
  const LABEL_W = 130;
  const BAR_MAX_W = 260;
  const VALUE_W = 52;
  const BAR_H = 26;
  const BAR_GAP = 12;
  const PAD_RIGHT = 8;
  const VB_W = LABEL_W + BAR_MAX_W + VALUE_W + PAD_RIGHT;
  const VB_H = data.length * (BAR_H + BAR_GAP) + BAR_GAP;

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <div className="flex items-center justify-between mb-4">
        <p
          className="font-sans font-semibold uppercase"
          style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'var(--text-3)' }}
        >
          Tempo médio por estágio
        </p>
        {!isEmpty && (
          <span
            className="font-sans text-xs"
            style={{ color: 'var(--text-4)', fontSize: '0.65rem' }}
            title="A barra em vermelho indica o estágio com maior tempo médio (possível gargalo)"
          >
            vermelho = gargalo
          </span>
        )}
      </div>

      {isEmpty ? (
        <div
          className="flex flex-col items-center justify-center gap-1 py-8 text-center"
          style={{ color: 'var(--text-3)' }}
        >
          <p className="font-sans text-sm">Sem dados suficientes para calcular tempo médio.</p>
          <p className="font-sans text-xs" style={{ color: 'var(--text-4)' }}>
            O tempo médio é calculado quando cards saem de um estágio.
          </p>
        </div>
      ) : (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="100%"
          role="img"
          aria-label="Gráfico de barras horizontais — tempo médio em dias por estágio do Kanban"
          style={{ display: 'block', overflow: 'visible' }}
        >
          {data.map((stage, idx) => {
            const barW =
              max > 0 ? Math.max((stage.days / max) * BAR_MAX_W, stage.days > 0 ? 6 : 0) : 0;
            const y = BAR_GAP + idx * (BAR_H + BAR_GAP);
            const isBottleneck = data.length > 1 && stage.days === maxDays && maxDays > 0;
            const barColor = isBottleneck ? 'var(--danger)' : 'var(--brand-azul)';

            const labelText =
              stage.stageName.length > 16 ? stage.stageName.slice(0, 15) + '…' : stage.stageName;

            return (
              <g key={stage.stageId}>
                {/* Label do estágio */}
                <text
                  x={LABEL_W - 10}
                  y={y + BAR_H / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                  style={{
                    fontFamily: 'var(--font-sans, Geist, system-ui)',
                    fontSize: '12px',
                    fontWeight: 500,
                    fill: 'var(--text-3)',
                  }}
                >
                  <title>{stage.stageName}</title>
                  {labelText}
                </text>

                {/* Trilho de fundo */}
                <rect
                  x={LABEL_W}
                  y={y}
                  width={BAR_MAX_W}
                  height={BAR_H}
                  rx={5}
                  fill="var(--surface-muted)"
                  opacity={0.5}
                />

                {/* Barra de valor */}
                {stage.days > 0 && (
                  <rect
                    x={LABEL_W}
                    y={y}
                    width={barW}
                    height={BAR_H}
                    rx={5}
                    fill={barColor}
                    opacity={0.85}
                  >
                    <title>{`${stage.stageName}: ${formatDays(stage.days)} em média`}</title>
                  </rect>
                )}

                {/* Valor em dias */}
                <text
                  x={LABEL_W + BAR_MAX_W + 10}
                  y={y + BAR_H / 2}
                  textAnchor="start"
                  dominantBaseline="middle"
                  style={{
                    fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                    fontSize: '11px',
                    fontWeight: 600,
                    fill: isBottleneck ? 'var(--danger)' : 'var(--text-2)',
                  }}
                >
                  {stage.days > 0
                    ? `${stage.days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d`
                    : '—'}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function AvgDaysInStageChartSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)', minHeight: '200px' }}
    >
      <div
        className="mb-4 h-2.5 w-48 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex flex-col gap-3 px-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="h-2.5 rounded-pill animate-pulse shrink-0"
              style={{ background: 'var(--surface-muted)', width: `${70 + i * 12}px` }}
            />
            <div
              className="h-6 flex-1 rounded-xs animate-pulse"
              style={{
                background: 'var(--surface-muted)',
                maxWidth: `${100 + i * 40}px`,
              }}
            />
            <div
              className="h-2.5 w-8 rounded-pill animate-pulse shrink-0"
              style={{ background: 'var(--surface-muted)' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
