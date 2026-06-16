// =============================================================================
// features/dashboard/AvgDaysInStageChart.tsx — Gráfico de barras horizontais
// do tempo médio (dias) por estágio do Kanban no dashboard (F18-S07).
//
// Complementa KanbanBars (volume de cards): aqui a métrica é duração média no
// estágio — útil para identificar gargalos de fluxo (ex: "Documentação: 8.1d").
//
// Dados: useDashboardMetrics().data.kanban.avgDaysInStage (array de items com
//   stageId e days) cruzado com cardsByStage (para obter stageName).
//
// DS:
//   - Barras horizontais com var(--brand-azul) como cor base.
//   - Indicador de gargalo (barra com mais dias): var(--danger).
//   - Labels: Geist/sans var(--text-3).
//   - Valores: JetBrains Mono var(--text-2).
//   - Tooltip nativo via <title> na SVG.
//   - boxShadow: var(--elev-2).
//   - Sem hex hardcoded.
// =============================================================================

import * as React from 'react';

import type { KanbanAvgDaysInStageItem, KanbanCardsByStageItem } from '../../hooks/dashboard/types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface AvgDaysInStageItem {
  stageId: string;
  stageName: string;
  days: number;
}

interface AvgDaysInStageChartProps {
  /** Lista de {stageId, days} do dashboard metrics. */
  avgDays: KanbanAvgDaysInStageItem[];
  /** Lista de {stageId, stageName, count} para resolver os nomes dos estágios. */
  cardsByStage: KanbanCardsByStageItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDays(days: number): string {
  return days === 1
    ? '1 dia'
    : `${days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * Barras horizontais SVG com o tempo médio (dias) por estágio do Kanban.
 * A barra com maior valor recebe destaque de "gargalo" com cor de alerta.
 */
export function AvgDaysInStageChart({
  avgDays,
  cardsByStage,
}: AvgDaysInStageChartProps): React.JSX.Element {
  // Cruza avgDays com cardsByStage para obter stageName
  const data: AvgDaysInStageItem[] = avgDays.map((a) => ({
    stageId: a.stageId,
    stageName: cardsByStage.find((c) => c.stageId === a.stageId)?.stageName ?? '—',
    days: a.days,
  }));

  const isEmpty = data.length === 0 || data.every((d) => d.days === 0);
  const max = Math.max(...data.map((d) => d.days), 1);
  const maxDays = Math.max(...data.map((d) => d.days));

  // Dimensões das barras horizontais
  const BAR_HEIGHT = 20;
  const BAR_GAP = 10;
  const LABEL_WIDTH = 120; // espaço para o label do estágio
  const VALUE_WIDTH = 50; // espaço para o valor em dias
  const BAR_MAX_WIDTH = 200; // largura máxima da barra
  const SVG_WIDTH = LABEL_WIDTH + BAR_MAX_WIDTH + VALUE_WIDTH + 16;
  const SVG_HEIGHT = data.length * (BAR_HEIGHT + BAR_GAP) + 4;

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      {/* Cabeçalho */}
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

      {/* Estado vazio */}
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
        <div className="overflow-x-auto">
          <svg
            width={SVG_WIDTH}
            height={SVG_HEIGHT}
            role="img"
            aria-label="Gráfico de barras horizontais — tempo médio em dias por estágio do Kanban"
            style={{ display: 'block', maxWidth: '100%' }}
          >
            {data.map((stage, idx) => {
              const barW =
                max > 0 ? Math.max((stage.days / max) * BAR_MAX_WIDTH, stage.days > 0 ? 6 : 0) : 0;
              const y = idx * (BAR_HEIGHT + BAR_GAP);
              // Gargalo: estágio com maior tempo (só destacar se houver diferença real)
              const isBottleneck = data.length > 1 && stage.days === maxDays && maxDays > 0;
              const barColor = isBottleneck ? 'var(--danger)' : 'var(--brand-azul)';

              return (
                <g key={stage.stageId}>
                  {/* Label do estágio */}
                  <text
                    x={LABEL_WIDTH - 8}
                    y={y + BAR_HEIGHT / 2 + 1}
                    textAnchor="end"
                    dominantBaseline="middle"
                    style={{
                      fontFamily: 'var(--font-sans, Geist, system-ui)',
                      fontSize: '11px',
                      fontWeight: 500,
                      fill: 'var(--text-3)',
                    }}
                  >
                    {stage.stageName.length > 14
                      ? stage.stageName.slice(0, 13) + '…'
                      : stage.stageName}
                  </text>

                  {/* Trilho de fundo (track) */}
                  <rect
                    x={LABEL_WIDTH}
                    y={y}
                    width={BAR_MAX_WIDTH}
                    height={BAR_HEIGHT}
                    rx={4}
                    fill="var(--surface-muted)"
                    opacity={0.5}
                  />

                  {/* Barra de valor */}
                  {stage.days > 0 && (
                    <rect
                      x={LABEL_WIDTH}
                      y={y}
                      width={barW}
                      height={BAR_HEIGHT}
                      rx={4}
                      fill={barColor}
                      opacity={0.85}
                      style={{
                        transition: 'width 300ms var(--ease-out, cubic-bezier(0.16,1,0.3,1))',
                      }}
                    >
                      <title>{`${stage.stageName}: ${formatDays(stage.days)} em média`}</title>
                    </rect>
                  )}

                  {/* Valor em dias */}
                  <text
                    x={LABEL_WIDTH + BAR_MAX_WIDTH + 8}
                    y={y + BAR_HEIGHT / 2 + 1}
                    textAnchor="start"
                    dominantBaseline="middle"
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      fontSize: '10px',
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
        </div>
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
      style={{ boxShadow: 'var(--elev-2)', minHeight: '180px' }}
    >
      <div
        className="mb-4 h-2.5 w-48 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex flex-col gap-3 px-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="h-2 rounded-pill animate-pulse shrink-0"
              style={{ background: 'var(--surface-muted)', width: `${60 + i * 10}px` }}
            />
            <div
              className="h-5 flex-1 rounded-xs animate-pulse"
              style={{
                background: 'var(--surface-muted)',
                width: `${80 + i * 20}px`,
                maxWidth: '200px',
              }}
            />
            <div
              className="h-2 w-8 rounded-pill animate-pulse shrink-0"
              style={{ background: 'var(--surface-muted)' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
