// =============================================================================
// features/dashboard/components/KanbanAvgDays.tsx — Tempo médio (dias) que os
// cards passam em cada estágio do Kanban (F13-S05).
//
// Div-based: responsivo, labels nunca se sobrepõem.
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

const STAGE_COLORS = [
  'var(--brand-azul)',
  'var(--brand-verde)',
  'var(--brand-amarelo)',
  'var(--info)',
  'var(--danger)',
  'var(--text-3)',
];

const MAX_BAR_PX = 148;

/**
 * Barras verticais do tempo médio (dias) por estágio do Kanban.
 * Div-based: responsivo, labels nunca se sobrepõem.
 */
export function KanbanAvgDays({ data }: KanbanAvgDaysProps): React.JSX.Element {
  const isEmpty = data.length === 0 || data.every((d) => d.days === 0);
  const max = Math.max(...data.map((d) => d.days), 1);

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      <p
        className="font-sans font-semibold uppercase mb-5"
        style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'var(--text-3)' }}
      >
        Tempo médio por estágio (dias)
      </p>

      {isEmpty ? (
        <div
          className="flex flex-col items-center justify-center gap-1 py-8 text-center"
          style={{ color: 'var(--text-3)' }}
        >
          <p className="font-sans text-sm">Sem dados de permanência no Kanban ainda.</p>
          <p className="font-sans text-xs" style={{ color: 'var(--text-4)' }}>
            O tempo médio é calculado quando cards saem de um estágio.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className="flex items-end gap-3"
            style={{ minWidth: `${data.length * 64}px`, paddingBottom: '4px' }}
          >
            {data.map((stage, idx) => {
              const barPx =
                max > 0 ? Math.max((stage.days / max) * MAX_BAR_PX, stage.days > 0 ? 4 : 0) : 0;
              const color = STAGE_COLORS[idx % STAGE_COLORS.length] ?? 'var(--brand-azul)';

              return (
                <div
                  key={stage.stageId}
                  className="flex flex-col items-center"
                  style={{ flex: '1 1 52px', minWidth: '52px', maxWidth: '88px' }}
                >
                  {/* Valor acima */}
                  <span
                    className="font-mono font-semibold mb-1 text-center"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      color: 'var(--text-2)',
                      minHeight: '16px',
                      lineHeight: '16px',
                    }}
                  >
                    {stage.days > 0
                      ? `${stage.days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}d`
                      : ''}
                  </span>

                  {/* Container da barra */}
                  <div
                    className="w-full flex items-end"
                    style={{
                      height: `${MAX_BAR_PX}px`,
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                    title={`${stage.stageName}: ${stage.days.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dia${stage.days !== 1 ? 's' : ''} em média`}
                  >
                    <div
                      className="w-full transition-all duration-500"
                      style={{
                        height: `${barPx}px`,
                        background: color,
                        opacity: 0.88,
                        borderRadius: '4px 4px 0 0',
                      }}
                    />
                  </div>

                  {/* Nome do estágio */}
                  <div
                    className="w-full text-center mt-2"
                    style={{
                      fontSize: '11px',
                      color: 'var(--text-3)',
                      lineHeight: '1.35',
                      wordBreak: 'break-word',
                      hyphens: 'auto',
                    }}
                    title={stage.stageName}
                  >
                    {stage.stageName.length > 16
                      ? stage.stageName.slice(0, 15) + '…'
                      : stage.stageName}
                  </div>
                </div>
              );
            })}
          </div>
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
      style={{ boxShadow: 'var(--elev-2)', minHeight: '220px' }}
    >
      <div
        className="mb-5 h-2.5 w-48 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex items-end gap-3 px-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-2 flex-1">
            <div
              className="w-full rounded-xs animate-pulse"
              style={{
                background: 'var(--surface-muted)',
                height: `${48 + i * 22}px`,
                borderRadius: '4px 4px 0 0',
              }}
            />
            <div
              className="h-2.5 rounded-pill animate-pulse"
              style={{ background: 'var(--surface-muted)', width: '80%' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
