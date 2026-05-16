// =============================================================================
// features/dashboard/components/StatusDonut.tsx — Donut chart de leads por status.
//
// SVG manual (sem dep externa — decisão registrada no PR).
// Cores mapeadas por status usando tokens do DS.
// Tooltip e legend acessíveis.
// Funciona em light + dark via CSS variables.
// =============================================================================

import * as React from 'react';

import type { LeadsByStatusItem } from '../../../hooks/dashboard/types';

interface StatusDonutProps {
  data: LeadsByStatusItem[];
}

// ---------------------------------------------------------------------------
// Mapeamento status → label + cor DS
// ---------------------------------------------------------------------------

const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: 'Novo', color: 'var(--info)' },
  qualifying: { label: 'Qualificação', color: 'var(--brand-azul)' },
  simulation: { label: 'Simulação', color: 'var(--brand-amarelo)' },
  closed_won: { label: 'Ganho', color: 'var(--success)' },
  closed_lost: { label: 'Perdido', color: 'var(--danger)' },
  archived: { label: 'Arquivado', color: 'var(--text-4)' },
};

// ---------------------------------------------------------------------------
// Cálculo de arcos SVG
// ---------------------------------------------------------------------------

interface Arc {
  status: string;
  count: number;
  label: string;
  color: string;
  startAngle: number;
  endAngle: number;
  pathD: string;
}

const CX = 80;
const CY = 80;
const R_OUTER = 68;
const R_INNER = 44;

function polarToXY(angle: number, r: number): { x: number; y: number } {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function describeArc(startAngle: number, endAngle: number): string {
  // Garante que arcos de 360° fechem corretamente
  const clampedEnd = endAngle >= 360 ? 359.9999 : endAngle;
  const start = polarToXY(startAngle, R_OUTER);
  const end = polarToXY(clampedEnd, R_OUTER);
  const innerStart = polarToXY(clampedEnd, R_INNER);
  const innerEnd = polarToXY(startAngle, R_INNER);
  const largeArc = clampedEnd - startAngle > 180 ? 1 : 0;

  return [
    `M ${start.x} ${start.y}`,
    `A ${R_OUTER} ${R_OUTER} 0 ${largeArc} 1 ${end.x} ${end.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${R_INNER} ${R_INNER} 0 ${largeArc} 0 ${innerEnd.x} ${innerEnd.y}`,
    'Z',
  ].join(' ');
}

function buildArcs(items: LeadsByStatusItem[]): Arc[] {
  const filtered = items.filter((d) => d.count > 0);
  const total = filtered.reduce((s, d) => s + d.count, 0);
  if (total === 0) return [];

  let angle = 0;
  return filtered.map((item) => {
    const sweep = (item.count / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const meta = STATUS_META[item.status] ?? { label: item.status, color: 'var(--text-3)' };
    return {
      status: item.status,
      count: item.count,
      label: meta.label,
      color: meta.color,
      startAngle: start,
      endAngle: end,
      pathD: describeArc(start, end),
    };
  });
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

/**
 * Donut chart SVG manual de distribuição de leads por status.
 * Tooltip nativo (title) + legend acessível por lista.
 */
export function StatusDonut({ data }: StatusDonutProps): React.JSX.Element {
  const arcs = buildArcs(data);
  const total = data.reduce((s, d) => s + d.count, 0);
  const [hoveredStatus, setHoveredStatus] = React.useState<string | null>(null);

  const isEmpty = total === 0;

  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)' }}
    >
      {/* Título */}
      <p
        className="font-sans font-semibold uppercase mb-4"
        style={{ fontSize: '0.7rem', letterSpacing: '0.12em', color: 'var(--text-3)' }}
      >
        Distribuição por status
      </p>

      {isEmpty ? (
        <div
          className="flex flex-col items-center justify-center py-8 gap-2"
          style={{ color: 'var(--text-3)' }}
        >
          <p className="font-sans text-sm">Sem dados no período selecionado.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
          {/* SVG Donut */}
          <div className="relative shrink-0">
            <svg
              width="160"
              height="160"
              viewBox="0 0 160 160"
              role="img"
              aria-label={`Donut chart de leads por status. Total: ${total}`}
            >
              {arcs.map((arc) => (
                <path
                  key={arc.status}
                  d={arc.pathD}
                  fill={arc.color}
                  opacity={hoveredStatus === null || hoveredStatus === arc.status ? 1 : 0.35}
                  style={{ transition: 'opacity 150ms ease' }}
                  onMouseEnter={() => setHoveredStatus(arc.status)}
                  onMouseLeave={() => setHoveredStatus(null)}
                  aria-label={`${arc.label}: ${arc.count}`}
                >
                  <title>{`${arc.label}: ${arc.count.toLocaleString('pt-BR')}`}</title>
                </path>
              ))}
              {/* Centro: total */}
              <text
                x={CX}
                y={CY - 6}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontFamily: 'var(--font-display, "Bricolage Grotesque", system-ui)',
                  fontWeight: 800,
                  fontSize: '22px',
                  fill: 'var(--text)',
                  letterSpacing: '-0.04em',
                }}
              >
                {total.toLocaleString('pt-BR')}
              </text>
              <text
                x={CX}
                y={CY + 14}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{
                  fontFamily: 'var(--font-sans, Geist, system-ui)',
                  fontWeight: 600,
                  fontSize: '10px',
                  fill: 'var(--text-3)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                total
              </text>
            </svg>
          </div>

          {/* Legend acessível */}
          <ul className="flex flex-col gap-2 w-full" aria-label="Legenda do gráfico de status">
            {arcs.map((arc) => {
              const pct = total > 0 ? Math.round((arc.count / total) * 100) : 0;
              return (
                <li
                  key={arc.status}
                  className="flex items-center justify-between gap-2 text-sm cursor-default"
                  onMouseEnter={() => setHoveredStatus(arc.status)}
                  onMouseLeave={() => setHoveredStatus(null)}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span
                      className="shrink-0 inline-block w-2.5 h-2.5 rounded-pill"
                      style={{ background: arc.color }}
                      aria-hidden="true"
                    />
                    <span className="font-sans truncate" style={{ color: 'var(--text-2)' }}>
                      {arc.label}
                    </span>
                  </span>
                  <span
                    className="font-mono shrink-0 tabular-nums"
                    style={{
                      fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                      color: 'var(--text-3)',
                      fontSize: '0.75rem',
                    }}
                  >
                    {arc.count.toLocaleString('pt-BR')}
                    <span className="ml-1 opacity-60">({pct}%)</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export function StatusDonutSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-border bg-surface-1 p-5"
      style={{ boxShadow: 'var(--elev-2)', minHeight: '200px' }}
    >
      <div
        className="mb-4 h-2.5 w-32 rounded-pill animate-pulse"
        style={{ background: 'var(--surface-muted)' }}
      />
      <div className="flex items-center gap-6">
        <div
          className="shrink-0 w-40 h-40 rounded-pill animate-pulse"
          style={{ background: 'var(--surface-muted)' }}
        />
        <div className="flex flex-col gap-3 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className="w-2.5 h-2.5 rounded-pill animate-pulse shrink-0"
                style={{ background: 'var(--surface-muted)' }}
              />
              <div
                className="h-2.5 flex-1 rounded-pill animate-pulse"
                style={{ background: 'var(--surface-muted)' }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
