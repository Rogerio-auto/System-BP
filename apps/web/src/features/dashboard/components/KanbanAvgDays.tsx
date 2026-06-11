// =============================================================================
// features/dashboard/components/KanbanAvgDays.tsx — Tempo médio (dias) que os
// cards passam em cada estágio do Kanban (F13-S05).
//
// Métrica de gestão interna (gargalos do fluxo). O backend já calcula
// `kanban.avgDaysInStage`; aqui apenas exibimos. SVG manual (sem dep), no mesmo
// padrão visual de KanbanBars / ChannelBars.
// =============================================================================

import * as React from 'react';

export interface KanbanAvgDaysItem {
  stageId: string;
  stageName: string;
  days: number;
}

interface KanbanAvgDaysProps {
  data: KanbanAvgDaysItem[];
}

// Paleta cíclica de tokens DS por estágio (mesma ordem de KanbanBars).
const STAGE_COLORS = [
  'var(--brand-azul)',
  'var(--brand-verde)',
  'var(--brand-amarelo)',
  'var(--info)',
  'var(--danger)',
  'var(--text-3)',
];

/**
 * Barras verticais SVG do tempo médio (dias) por estágio do Kanban.
 * Ordem preservada conforme recebida (ordem dos stages).
 */
export function KanbanAvgDays({ data }: KanbanAvgDaysProps): React.JSX.Element {
  const isEmpty = data.length === 0 || data.every((d) => d.days === 0);
  const max = Math.max(...data.map((d) => d.days), 1);

  function truncate(name: string, maxLen = 10): string {
    return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
  }

  const BAR_HEIGHT = 100;
  const BAR_WIDTH = 28;
  const GAP = 12;
  const totalWidth = data.length * (BAR_WIDTH + GAP);

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <p
        className="font-sans font-semibold uppercase mb-4"
        style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'var(--text-3)' }}
      >
        Tempo médio por estágio (dias)
      </p>

      {isEmpty ? (
        <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-3)' }}>
          <p className="font-sans text-sm">Sem dados de permanência no Kanban ainda.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            width={Math.max(totalWidth, 200)}
            height={BAR_HEIGHT + 52}
            role="img"
            aria-label="Gráfico de barras — tempo médio em dias por estágio do Kanban"
            style={{ display: 'block', margin: '0 auto' }}
          >
            {data.map((stage, idx) => {
              const barH =
                max > 0 ? Math.max((stage.days / max) * BAR_HEIGHT, stage.days > 0 ? 4 : 0) : 0;
              const x = idx * (BAR_WIDTH + GAP);
              const y = BAR_HEIGHT - barH;
              const color = STAGE_COLORS[idx % STAGE_COLORS.length] ?? 'var(--brand-azul)';
              const label = truncate(stage.stageName);

              return (
                <g key={stage.stageId}>
                  <rect
                    x={x}
                    y={y}
                    width={BAR_WIDTH}
                    height={barH}
                    rx={4}
                    fill={color}
                    opacity={0.9}
                    style={{ transition: 'opacity 150ms ease' }}
                  >
                    <title>{`${stage.stageName}: ${stage.days.toLocaleString('pt-BR')} dia${stage.days !== 1 ? 's' : ''} em média`}</title>
                  </rect>

                  {stage.days > 0 && (
                    <text
                      x={x + BAR_WIDTH / 2}
                      y={y - 4}
                      textAnchor="middle"
                      style={{
                        fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                        fontSize: '10px',
                        fontWeight: 600,
                        fill: 'var(--text-2)',
                      }}
                    >
                      {stage.days}d
                    </text>
                  )}

                  <text
                    x={x + BAR_WIDTH / 2}
                    y={BAR_HEIGHT + 14}
                    textAnchor="middle"
                    style={{
                      fontFamily: 'var(--font-sans, Geist, system-ui)',
                      fontSize: '9px',
                      fontWeight: 500,
                      fill: 'var(--text-3)',
                    }}
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            <line
              x1={0}
              y1={BAR_HEIGHT}
              x2={totalWidth}
              y2={BAR_HEIGHT}
              stroke="var(--border-subtle)"
              strokeWidth={1}
            />
          </svg>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function KanbanAvgDaysSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)', minHeight: '200px' }}
    >
      <div
        className="mb-4 h-2.5 w-48 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex items-end justify-center gap-3 px-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div
              className="w-7 rounded-xs animate-pulse"
              style={{ background: 'var(--surface-muted)', height: `${40 + i * 14}px` }}
            />
            <div
              className="h-2 w-10 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
