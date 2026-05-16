// =============================================================================
// features/dashboard/components/KanbanBars.tsx — Barras verticais de cards
// no Kanban por estágio.
//
// SVG manual (sem dep). Barras verticais com labels abaixo.
// Cores tokens DS por índice. Tooltip nativo via <title>.
// =============================================================================

import * as React from 'react';

import type { KanbanCardsByStageItem } from '../../../hooks/dashboard/types';

interface KanbanBarsProps {
  data: KanbanCardsByStageItem[];
}

// Paleta cíclica de tokens DS para os stages
const STAGE_COLORS = [
  'var(--brand-azul)',
  'var(--brand-verde)',
  'var(--brand-amarelo)',
  'var(--info)',
  'var(--danger)',
  'var(--text-3)',
];

/**
 * Barras verticais SVG de cards por estágio do Kanban.
 * Ordenado pela ordem de entrada (preserva ordem dos stages).
 */
export function KanbanBars({ data }: KanbanBarsProps): React.JSX.Element {
  const isEmpty = data.length === 0 || data.every((d) => d.count === 0);
  const max = Math.max(...data.map((d) => d.count), 1);

  // Trunca nome do stage para caber no label
  function truncate(name: string, maxLen = 10): string {
    return name.length > maxLen ? name.slice(0, maxLen - 1) + '…' : name;
  }

  const BAR_HEIGHT = 100; // altura máxima das barras em px (proporcional)
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
        Cards no kanban por estágio
      </p>

      {isEmpty ? (
        <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-3)' }}>
          <p className="font-sans text-sm">Sem cards no Kanban.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <svg
            width={Math.max(totalWidth, 200)}
            height={BAR_HEIGHT + 52}
            role="img"
            aria-label="Gráfico de barras verticais — cards por estágio do Kanban"
            style={{ display: 'block', margin: '0 auto' }}
          >
            {data.map((stage, idx) => {
              const barH =
                max > 0 ? Math.max((stage.count / max) * BAR_HEIGHT, stage.count > 0 ? 4 : 0) : 0;
              const x = idx * (BAR_WIDTH + GAP);
              const y = BAR_HEIGHT - barH;
              const color = STAGE_COLORS[idx % STAGE_COLORS.length] ?? 'var(--brand-azul)';
              const label = truncate(stage.stageName);

              return (
                <g key={stage.stageId}>
                  {/* Barra */}
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
                    <title>{`${stage.stageName}: ${stage.count.toLocaleString('pt-BR')} card${stage.count !== 1 ? 's' : ''}`}</title>
                  </rect>

                  {/* Valor acima da barra */}
                  {stage.count > 0 && (
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
                      {stage.count}
                    </text>
                  )}

                  {/* Label abaixo */}
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

            {/* Linha de base */}
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

export function KanbanBarsSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)', minHeight: '200px' }}
    >
      <div
        className="mb-4 h-2.5 w-44 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex items-end justify-center gap-3 px-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div
              className="w-7 rounded-xs animate-pulse"
              style={{
                background: 'var(--surface-muted)',
                height: `${50 + i * 12}px`,
              }}
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
